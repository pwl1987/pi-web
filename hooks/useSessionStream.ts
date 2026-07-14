"use client";

import { useState, useCallback, useRef, useEffect, useReducer } from "react";
import type {
  AgentMessage,
  AssistantMessage,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionWidgetItem,
  SessionInfo,
  SessionTreeNode,
} from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { localizeExtensionUiRequest, resolveSelectValue } from "@/lib/plugin-ui-i18n";
import type { ContextUsage, SessionStatsInfo } from "@/lib/pi-types";
import {
  streamReducer,
  normalizeQueuedMessages,
  noticeReducer,
  createNoticeId,
  userMessageKey,
  readCompactResult,
  NOTICE_VISIBLE_MS,
  NOTICE_EXIT_ANIMATION_MS,
  type StreamingState,
  type StreamAction,
  type NoticeState,
  type NoticeAction,
  type NoticeType,
  type NoticeItem,
  type QueuedMessages,
  type CompactResultInfo,
  type CompactCommandResult,
} from "@/lib/agent-session-helpers";
// Re-export types that are part of this hook's public API but now live in the
// helpers module, so existing importers (`import { QueuedMessages } from ...`)
// keep compiling.
export type {
  QueuedMessages,
  NoticeType,
  NoticeItem,
  CompactResultInfo,
} from "@/lib/agent-session-helpers";
import { sendAgentCommand } from "@/lib/agent-client";
import { toolsToToolNames, defaultToolEntries, type ToolEntry } from "@/lib/tool-presets";
import { getAgentRuntimeStore } from "@/lib/agent-runtime-store";
import { reportUserStatus } from "@/lib/constraints";
import { getAgentEventBus } from "@/lib/extensions/event-bus";
import { csrfHeaders } from "@/lib/csrf-client";
import type {
  UseAgentSessionOptions,
  SessionData,
  AgentEvent,
  AgentStateResponse,
  ExtensionUiDialogRequest,
  ExtensionUiCustomRequest,
  AgentPhase,
  SlashCommandInfo,
  ThinkingLevelOption,
} from "./useAgentSession";

type SelectedModel = { provider: string; modelId: string };

type SlashCommandsResponse = {
  commands?: SlashCommandInfo[];
};

type EventStreamConnectionStatus = "connected" | "timeout" | "closed";

type EventStreamConnectionResult = {
  status: EventStreamConnectionStatus;
  source: EventSource;
};

class EventStreamConnectionError extends Error {
  constructor(public readonly status: Exclude<EventStreamConnectionStatus, "connected">) {
    super(
      status === "timeout" ? "连接智能体事件流超时，请重试。" : "连接智能体事件流失败，请重试。",
    );
    this.name = "EventStreamConnectionError";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const EVENT_STREAM_CONNECT_TIMEOUT_MS = 5_000;
const AGENT_STATE_RECONCILE_MS = 15_000;
const PROMPT_SETTLE_INITIAL_DELAY_MS = 800;
const PROMPT_SETTLE_POLL_MS = 600;
const PROMPT_SETTLE_MAX_MS = 20_000;

export type SessionStreamApi = {
  addNotice: (notice: { id?: string; message: string; type?: NoticeType }) => void;
  loadSession: (
    sid: string,
    showLoading?: boolean,
    includeState?: boolean,
  ) => Promise<
    | (SessionData & {
        agentState?: { running: boolean; state?: AgentStateResponse; timedOut?: boolean };
      })["agentState"]
    | null
  >;
  loadContext: (sid: string, leafId: string | null) => Promise<void>;
  promoteNewSession: (messageCount?: number, firstMessage?: string) => void;
  ensureNewSession: () => Promise<string | null>;
  loadSlashCommands: () => Promise<SlashCommandInfo[]>;
  connectEvents: (sid: string) => Promise<EventStreamConnectionResult>;
  ensureEventsConnected: (sid: string) => Promise<void>;
  respondToExtensionUi: (
    request: ExtensionUiDialogRequest,
    response: { value: string } | { confirmed: boolean } | { cancelled: true },
  ) => Promise<void>;
  sendExtensionCustomInput: (request: ExtensionUiCustomRequest, data: string) => Promise<void>;
  handleExtensionUiRequest: (request: ExtensionUiRequest) => void;
  recoverExtensionUiRequest: (request: ExtensionUiRequest) => void;
  finishPromptWithoutStream: (sid?: string | null, runId?: number) => Promise<void>;
  waitForPromptSettlement: (sid: string, runId?: number) => Promise<void>;
  reconcileAgentState: (sid: string) => Promise<void>;
  handleAgentEvent: (event: AgentEvent) => void;
  ensuringNewSessionRef: React.RefObject<Promise<string | null> | null>;
  mountedRef: React.RefObject<boolean>;
  reconnectTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  setCurrentModelOverride: React.Dispatch<
    React.SetStateAction<{ provider: string; modelId: string } | null>
  >;
  setPendingModel: React.Dispatch<
    React.SetStateAction<{ provider: string; modelId: string } | null>
  >;
  setThinkingLevel: React.Dispatch<React.SetStateAction<ThinkingLevelOption>>;
  modelStateRef: React.MutableRefObject<{
    tools: ToolEntry[];
    newSessionModel: SelectedModel | null;
    newSessionDefaultModel: SelectedModel | null;
  }>;
  // Setters consumed by useSessionModels / useSessionActions (not part of the
  // public return shape, so they live on the internal API).
  setData: React.Dispatch<React.SetStateAction<SessionData | null>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setEntryIds: React.Dispatch<React.SetStateAction<string[]>>;
  dispatch: React.Dispatch<StreamAction>;
  setAgentRunning: React.Dispatch<React.SetStateAction<boolean>>;
  setRetryInfo: React.Dispatch<
    React.SetStateAction<{
      attempt: number;
      maxAttempts: number;
      errorMessage?: string;
    } | null>
  >;
  setContextUsage: React.Dispatch<React.SetStateAction<ContextUsage | null>>;
  setSystemPrompt: React.Dispatch<React.SetStateAction<string | null>>;
  setIsCompacting: React.Dispatch<React.SetStateAction<boolean>>;
  setCompactError: React.Dispatch<React.SetStateAction<string | null>>;
  setCompactResult: React.Dispatch<React.SetStateAction<CompactResultInfo | null>>;
  setAgentPhase: React.Dispatch<React.SetStateAction<AgentPhase>>;
  setSlashCommands: React.Dispatch<React.SetStateAction<SlashCommandInfo[]>>;
  setSlashCommandsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  dispatchNotice: React.Dispatch<NoticeAction>;
  setSessionStatsOverride: React.Dispatch<React.SetStateAction<SessionStatsInfo | null>>;
  setExtensionDialog: React.Dispatch<React.SetStateAction<ExtensionUiDialogRequest | null>>;
  setExtensionCustomUi: React.Dispatch<React.SetStateAction<ExtensionUiCustomRequest | null>>;
  setExtensionStatuses: React.Dispatch<React.SetStateAction<ExtensionStatusItem[]>>;
  setExtensionWidgets: React.Dispatch<React.SetStateAction<ExtensionWidgetItem[]>>;
  setQueuedMessages: React.Dispatch<React.SetStateAction<QueuedMessages>>;
  setIsAtBottom: React.Dispatch<React.SetStateAction<boolean>>;
  // Refs consumed by useSessionActions (not part of the public return shape).
  agentRunningRef: React.RefObject<boolean>;
  pendingScrollToUserRef: React.RefObject<boolean>;
  completionScrollAllowedRef: React.RefObject<boolean>;
  optimisticUserMessageKeyRef: React.RefObject<string | null>;
  promptRunIdRef: React.RefObject<number>;
  userScrollIntentUntilRef: React.RefObject<number>;
  ignoreProgrammaticScrollUntilRef: React.RefObject<number>;
};

export function useSessionStream(opts: UseAgentSessionOptions) {
  const { session, newSessionCwd, onAgentEnd, onSessionCreated } = opts;

  const isNew = session === null && newSessionCwd !== null;

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, {
    isStreaming: false,
    streamingMessage: null,
  });
  const [agentRunning, setAgentRunning] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  const [retryInfo, setRetryInfo] = useState<{
    attempt: number;
    maxAttempts: number;
    errorMessage?: string;
  } | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [compactResult, setCompactResult] = useState<CompactResultInfo | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [slashCommandsLoading, setSlashCommandsLoading] = useState(false);
  const [noticeState, dispatchNotice] = useReducer(noticeReducer, { visible: [], pending: [] });
  const [sessionStatsOverride, setSessionStatsOverride] = useState<SessionStatsInfo | null>(null);
  const [extensionDialog, setExtensionDialog] = useState<ExtensionUiDialogRequest | null>(null);
  const [extensionCustomUi, setExtensionCustomUi] = useState<ExtensionUiCustomRequest | null>(null);
  // Refs mirror the displayed dialog/custom-UI id so the reconcile recovery can
  // skip requests already on screen (re-applying would reset an in-progress
  // input/editor dialog). Updated alongside the state in the effects below.
  const extensionDialogRef = useRef<ExtensionUiDialogRequest | null>(null);
  const extensionCustomUiRef = useRef<ExtensionUiCustomRequest | null>(null);
  useEffect(() => {
    extensionDialogRef.current = extensionDialog;
  }, [extensionDialog]);
  useEffect(() => {
    extensionCustomUiRef.current = extensionCustomUi;
  }, [extensionCustomUi]);
  const [extensionStatuses, setExtensionStatuses] = useState<ExtensionStatusItem[]>([]);
  const [extensionWidgets, setExtensionWidgets] = useState<ExtensionWidgetItem[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessages>({
    steering: [],
    followUp: [],
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  // Tracked so a pending SSE reconnect scheduled by onerror can be cancelled on
  // unmount — otherwise a 1s timer could open a new EventSource after teardown.
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const agentRunningRef = useRef(false);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);
  const initialScrollDoneRef = useRef(false);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const completionScrollAllowedRef = useRef(true);
  const userScrollIntentUntilRef = useRef(0);
  const ignoreProgrammaticScrollUntilRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const ensuringNewSessionRef = useRef<Promise<string | null> | null>(null);
  const newSessionPromotedRef = useRef(false);
  const promptRunIdRef = useRef(0);
  const optimisticUserMessageKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  // Bridge so stream helpers that must read model state (e.g. ensureNewSession)
  // can do so without a reverse dependency on useSessionModels. Populated by
  // useSessionModels each render; read at call time, exactly like a closure.
  const modelStateRef = useRef<{
    tools: ToolEntry[];
    newSessionModel: SelectedModel | null;
    newSessionDefaultModel: SelectedModel | null;
  }>({
    tools: defaultToolEntries(),
    newSessionModel: null,
    newSessionDefaultModel: null,
  });

  const [currentModelOverride, setCurrentModelOverride] = useState<{
    provider: string;
    modelId: string;
  } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(
    null,
  );

  const currentModel = currentModelOverride ?? data?.context.model ?? pendingModel ?? null;

  const sessionStats = (() => {
    if (sessionStatsOverride) return sessionStatsOverride;
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    let cost = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    let toolResults = 0;
    let toolCalls = 0;
    for (const msg of messages) {
      if (msg.role === "user") userMessages += 1;
      if (msg.role === "toolResult") toolResults += 1;
      if (msg.role !== "assistant") continue;
      assistantMessages += 1;
      const u = (msg as AssistantMessage).usage;
      toolCalls += (msg as AssistantMessage).content.filter((c) => c.type === "toolCall").length;
      if (!u) continue;
      tokens.input += u.input ?? 0;
      tokens.output += u.output ?? 0;
      tokens.cacheRead += u.cacheRead ?? 0;
      tokens.cacheWrite += u.cacheWrite ?? 0;
      cost += u.cost?.total ?? 0;
    }
    tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    if (tokens.total === 0 && messages.length === 0) return null;
    return {
      sessionFile: data?.filePath || undefined,
      sessionId: sessionIdRef.current ?? session?.id ?? "",
      sessionName: session?.name,
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages: messages.length,
      tokens,
      cost,
      ...(contextUsage ? { contextUsage } : {}),
    } satisfies SessionStatsInfo;
  })();

  const loadSession = useCallback(
    async (sid: string, showLoading = false, includeState = false) => {
      try {
        if (showLoading) setLoading(true);
        const url = includeState
          ? `/api/sessions/${encodeURIComponent(sid)}?includeState`
          : `/api/sessions/${encodeURIComponent(sid)}`;
        const res = await fetch(url);
        if (res.status === 404) {
          if (showLoading) {
            setData(null);
            setActiveLeafId(null);
            setMessages([]);
            setError(null);
          }
          return null;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as SessionData & {
          agentState?: { running: boolean; state?: AgentStateResponse; timedOut?: boolean };
        };
        setData(d);
        setActiveLeafId(d.leafId);
        setMessages(d.context.messages);
        setEntryIds(d.context.entryIds ?? []);
        setCurrentModelOverride(null);
        setError(null);
        const liveState = d.agentState?.state;
        if (liveState) {
          if (liveState.contextUsage !== undefined) setContextUsage(liveState.contextUsage ?? null);
          if (liveState.systemPrompt !== undefined) setSystemPrompt(liveState.systemPrompt ?? null);
          if (liveState.thinkingLevel !== undefined)
            setThinkingLevel((liveState.thinkingLevel as ThinkingLevelOption) ?? "auto");
          if (liveState.extensionStatuses !== undefined)
            setExtensionStatuses(liveState.extensionStatuses ?? []);
          if (liveState.extensionWidgets !== undefined)
            setExtensionWidgets(liveState.extensionWidgets ?? []);
          if (liveState.queuedMessages !== undefined)
            setQueuedMessages(normalizeQueuedMessages(liveState.queuedMessages));
        } else if (d.agentState && !d.agentState.running)
          setQueuedMessages({ steering: [], followUp: [] });
        // If no live agent state, fall back to thinking level from session file
        if (
          !liveState?.thinkingLevel &&
          d.context.thinkingLevel &&
          d.context.thinkingLevel !== "off"
        ) {
          setThinkingLevel(d.context.thinkingLevel as ThinkingLevelOption);
        }
        return d.agentState ?? null;
      } catch (e) {
        setError(String(e));
        return null;
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [],
  );

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    try {
      const url = leafId
        ? `/api/sessions/${encodeURIComponent(sid)}/context?leafId=${encodeURIComponent(leafId)}`
        : `/api/sessions/${encodeURIComponent(sid)}/context`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { context: { messages: AgentMessage[]; entryIds: string[] } };
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
    } catch (e) {
      console.error("Failed to load context:", e);
    }
  }, []);

  const promoteNewSession = useCallback(
    (messageCount = 0, firstMessage = "(no messages)") => {
      const sid = sessionIdRef.current;
      if (!isNew || !newSessionCwd || !sid || newSessionPromotedRef.current) return;
      newSessionPromotedRef.current = true;
      onSessionCreated?.({
        id: sid,
        path: "",
        cwd: newSessionCwd,
        name: undefined,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        messageCount,
        firstMessage,
      });
    },
    [isNew, newSessionCwd, onSessionCreated],
  );

  const ensureNewSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!isNew || !newSessionCwd) return sessionIdRef.current;
    if (ensuringNewSessionRef.current) return ensuringNewSessionRef.current;

    const promise = (async () => {
      const { newSessionModel, newSessionDefaultModel, tools } = modelStateRef.current;
      const selectedModel = newSessionModel ?? newSessionDefaultModel;
      if (selectedModel) setPendingModel(selectedModel);
      const toolNames = toolsToToolNames(tools);
      const res = await fetch("/api/agent/new", {
        method: "POST",
        headers: csrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          cwd: newSessionCwd,
          type: "ensure_session",
          toolNames,
          ...(selectedModel
            ? { provider: selectedModel.provider, modelId: selectedModel.modelId }
            : {}),
          ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = (await res.json()) as { sessionId: string };
      const realId = result.sessionId;
      sessionIdRef.current = realId;
      return realId;
    })();

    ensuringNewSessionRef.current = promise;
    try {
      return await promise;
    } finally {
      ensuringNewSessionRef.current = null;
    }
  }, [isNew, newSessionCwd, thinkingLevel]);

  const loadSlashCommands = useCallback(async () => {
    const sid = sessionIdRef.current ?? (await ensureNewSession());
    if (!sid) {
      setSlashCommands([]);
      return [] as SlashCommandInfo[];
    }
    setSlashCommandsLoading(true);
    try {
      const data = await sendAgentCommand<SlashCommandsResponse>(sid, { type: "get_commands" });
      const commands = data?.commands ?? [];
      setSlashCommands(commands);
      return commands;
    } catch (e) {
      console.error("Failed to load slash commands:", e);
      setSlashCommands([]);
      return [] as SlashCommandInfo[];
    } finally {
      setSlashCommandsLoading(false);
    }
  }, [ensureNewSession]);

  const connectEvents = useCallback((sid: string): Promise<EventStreamConnectionResult> => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    const es = new EventSource(`/api/agent/${encodeURIComponent(sid)}/events`);
    eventSourceRef.current = es;

    return new Promise((resolve) => {
      let settled = false;
      const settle = (status: EventStreamConnectionStatus) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ status, source: es });
      };
      const timeout = setTimeout(() => settle("timeout"), EVENT_STREAM_CONNECT_TIMEOUT_MS);

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as AgentEvent;
          if (event.type === "connected") settle("connected");
          handleAgentEventRef.current?.(event);
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          // Fatal error (404/500/content-type mismatch): browser won't
          // auto-reconnect. Settle the Promise and manually reconnect for
          // already-running sessions.
          settle("closed");
          if (eventSourceRef.current === es && agentRunningRef.current) {
            eventSourceRef.current = null;
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = setTimeout(() => {
              reconnectTimerRef.current = null;
              if (agentRunningRef.current) void connectEvents(sid);
            }, 1000);
          }
        }
        // Recoverable errors (CONNECTING): let EventSource auto-reconnect.
        // The timeout above resolves only to let callers decide whether this
        // connection must be ready before they continue.
      };
    });
  }, []);

  const ensureEventsConnected = useCallback(
    async (sid: string) => {
      const result = await connectEvents(sid);
      if (result.status === "connected" || result.source.readyState === EventSource.OPEN) return;

      // Fatal: the server returned a non-recoverable error (e.g. 404/500 or a
      // Content-Type mismatch) and the EventSource will NOT auto-reconnect.
      // Close it and surface the error so the caller can react.
      if (result.status === "closed") {
        if (eventSourceRef.current === result.source) eventSourceRef.current = null;
        result.source.close();
        // 把这条用户可见状态文案上报给约束系统（业务状态 → 约束 联动）。
        reportUserStatus("事件流连接失败");
        throw new EventStreamConnectionError(result.status);
      }

      // "timeout": the stream hadn't confirmed a `connected` event within the
      // window, but the EventSource is still alive and will auto-reconnect (and
      // reconnect again via the onerror handler while the agent is running).
      // Don't discard the user's message over a transient connect delay —
      // proceed to send the prompt and let the 15s reconciliation poll (plus
      // visibilitychange/online) recover any events we may have missed.
      reportUserStatus("事件流在超时时间内未确认");
      console.warn(
        "Event stream not confirmed within timeout; proceeding with send and relying on SSE reconnect + state reconciliation.",
      );
    },
    [connectEvents],
  );

  const respondToExtensionUi = useCallback(
    async (
      request: ExtensionUiDialogRequest,
      response: { value: string } | { confirmed: boolean } | { cancelled: true },
    ) => {
      const sid = sessionIdRef.current;
      setExtensionDialog((current) => (current?.id === request.id ? null : current));
      if (!sid) return;
      // select 响应：把汉化显示值还原成插件期待的英文原值。
      // permission-system 的 select 用 === 比对英文常量，汉化值会误判 deny。
      const payload =
        "value" in response ? { value: resolveSelectValue(request.id, response.value) } : response;
      try {
        await sendAgentCommand(sid, {
          type: "extension_ui_response",
          id: request.id,
          ...payload,
        });
      } catch (e) {
        console.error("Failed to send extension UI response:", e);
      }
    },
    [],
  );

  const sendExtensionCustomInput = useCallback(
    async (request: ExtensionUiCustomRequest, data: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        await sendAgentCommand(sid, {
          type: "extension_ui_input",
          id: request.id,
          data,
        });
      } catch (e) {
        console.error("Failed to send extension custom UI input:", e);
      }
    },
    [],
  );

  const addNotice = useCallback((notice: { id?: string; message: string; type?: NoticeType }) => {
    const message = notice.message.trim();
    if (!message) return;
    dispatchNotice({
      type: "add",
      notice: {
        id: notice.id ?? createNoticeId(),
        message,
        type: notice.type ?? "info",
      },
    });
  }, []);

  const handleExtensionUiRequest = useCallback(
    (request: ExtensionUiRequest) => {
      // External localization override for the @juicesharp/rpiv-* plugins:
      // force Chinese chrome without touching plugin source. Pure + idempotent
      // (already-Chinese text is unaffected). This is the single choke point
      // for both live SSE events and reconcile recovery.
      const req = localizeExtensionUiRequest(request);
      switch (req.method) {
        case "select":
        case "confirm":
        case "input":
        case "editor":
          setExtensionDialog(req);
          break;
        case "notify": {
          addNotice({
            id: req.id,
            message: req.message,
            type: req.notifyType ?? "info",
          });
          break;
        }
        case "setStatus":
          setExtensionStatuses((prev) => {
            const existing = prev.find((item) => item.key === req.statusKey);
            if (existing && existing.text === req.statusText) return prev;
            const rest = prev.filter((item) => item.key !== req.statusKey);
            return req.statusText ? [...rest, { key: req.statusKey, text: req.statusText }] : rest;
          });
          break;
        case "setWidget":
          setExtensionWidgets((prev) => {
            const placement = req.widgetPlacement ?? "aboveEditor";
            const lines = req.widgetLines ?? [];
            const existing = prev.find((item) => item.key === req.widgetKey);
            // Identical content → keep the same array reference so the reconcile
            // poll (and live re-apply) doesn't trigger needless re-renders.
            if (
              existing &&
              existing.placement === placement &&
              existing.lines.length === lines.length &&
              existing.lines.every((l, i) => l === lines[i])
            ) {
              return prev;
            }
            const rest = prev.filter((item) => item.key !== req.widgetKey);
            return lines.length ? [...rest, { key: req.widgetKey, lines, placement }] : rest;
          });
          break;
        case "setTitle":
          if (req.title) document.title = req.title;
          break;
        case "set_editor_text":
          opts.chatInputRef?.current?.insertText(req.text);
          break;
        case "custom":
          setExtensionCustomUi((current) => {
            if (req.closed) return current?.id === req.id ? null : current;
            return req;
          });
          break;
      }
    },
    [addNotice, opts.chatInputRef],
  );

  /**
   * Recovery path for missed `extension_ui_request` events. The server keeps
   * every pending UI request in `pendingUiRequests` (replayed to new SSE
   * listeners on connect). If an event was dropped between the client and the
   * server while the stream stayed OPEN, the reconcile poll re-applies it here
   * so the questionnaire / todo overlay pops without a manual page refresh.
   *
   * Dialogs/custom panels are deduped against what's already on screen — a
   * re-apply would reset an in-progress `input`/`editor` dialog. Transient
   * requests (`notify`/`setTitle`) are skipped; `setWidget`/`setStatus` are
   * idempotent re-applies.
   */
  const recoverExtensionUiRequest = useCallback(
    (request: ExtensionUiRequest) => {
      const req = localizeExtensionUiRequest(request);
      switch (req.method) {
        case "notify":
        case "setTitle":
          return;
        case "select":
        case "confirm":
        case "input":
        case "editor":
          if (extensionDialogRef.current?.id === req.id) return;
          setExtensionDialog(req);
          return;
        case "custom":
          if (extensionCustomUiRef.current?.id === req.id) return;
          setExtensionCustomUi(req);
          return;
        default:
          // setWidget / setStatus — idempotent re-apply.
          handleExtensionUiRequest(req);
      }
    },
    [handleExtensionUiRequest],
  );

  const finishPromptWithoutStream = useCallback(
    async (sid: string | null = sessionIdRef.current, runId?: number) => {
      // Bail out before loadSession too: a stale finish for a previous run
      // must not overwrite the messages of the run currently streaming.
      if (runId !== undefined && promptRunIdRef.current !== runId) return;
      try {
        if (sid) await loadSession(sid);
      } finally {
        if (runId !== undefined && promptRunIdRef.current !== runId) return;
        optimisticUserMessageKeyRef.current = null;
        if (!agentRunningRef.current) return;
        agentRunningRef.current = false;
        setAgentRunning(false);
        setAgentPhase(null);
        setRetryInfo(null);
        dispatch({ type: "end" });
        onAgentEnd?.();
      }
    },
    [loadSession, onAgentEnd],
  );

  const waitForPromptSettlement = useCallback(
    async (sid: string, runId?: number) => {
      await delay(PROMPT_SETTLE_INITIAL_DELAY_MS);
      const startedAt = Date.now();

      while (agentRunningRef.current && Date.now() - startedAt < PROMPT_SETTLE_MAX_MS) {
        if (runId !== undefined && promptRunIdRef.current !== runId) return;
        try {
          const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
          if (res.ok) {
            const data = (await res.json()) as { running?: boolean; state?: AgentStateResponse };
            const state = data.state;
            if (!data.running || !state || (!state.isStreaming && !state.isPromptRunning)) {
              await finishPromptWithoutStream(sid, runId);
              return;
            }
          }
        } catch {
          // SSE remains the primary completion path.
        }
        await delay(PROMPT_SETTLE_POLL_MS);
      }
    },
    [finishPromptWithoutStream],
  );

  // Reconcile client streaming state with the server. When SSE events are
  // missed (network drop, mobile tab backgrounded, half-open connection),
  // agent_end never arrives and the UI stays in streaming state forever.
  // If the server reports idle while we still think it's running, finish
  // through the same path as prompt_done.
  const reconcileAgentState = useCallback(
    async (sid: string) => {
      if (!agentRunningRef.current) return;
      const runId = promptRunIdRef.current;
      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          running?: boolean;
          state?: AgentStateResponse;
          timedOut?: boolean;
        };
        // A slow response can straddle a run boundary (previous run finished
        // and the user already started the next one while this request was in
        // flight) — everything in it is stale, drop it.
        if (promptRunIdRef.current !== runId) return;
        // The server couldn't fetch state within its 5s budget (agent mid-
        // construction, blocking extension) and reported running with no state.
        // We can't tell whether the run actually ended, so keep the current UI
        // and let the next poll retry instead of finishing a run prematurely.
        if (data.timedOut) return;
        const state = data.state;
        // Mirror compaction state unconditionally: a missed compaction_end
        // would otherwise leave the "Stop compaction" UI stuck. No state
        // (wrapper destroyed) means nothing is compacting.
        setIsCompacting(state?.isCompacting ?? false);
        setQueuedMessages(normalizeQueuedMessages(state?.queuedMessages));
        // Recover extension UI that may have been missed by the SSE stream
        // (network drop, half-open connection). This MUST run regardless of
        // whether the agent is busy, because interactive UIs — the
        // rpiv-ask-user-question questionnaire and the rpiv-todo overlay — are
        // live *while* the agent is blocked awaiting the user's answer. Without
        // this, a dropped event leaves the questionnaire/overlay hidden until a
        // manual page refresh. Widgets/statuses are idempotent re-applies; the
        // dialog/custom panel recovery dedupes against what's already on screen.
        if (state) {
          if (state.contextUsage !== undefined) setContextUsage(state.contextUsage ?? null);
          if (state.systemPrompt !== undefined) setSystemPrompt(state.systemPrompt ?? null);
          if (state.extensionStatuses !== undefined)
            setExtensionStatuses((prev) => {
              const next = state.extensionStatuses ?? [];
              if (
                prev.length === next.length &&
                prev.every((p, i) => p.key === next[i].key && p.text === next[i].text)
              ) {
                return prev;
              }
              return next;
            });
          if (state.extensionWidgets !== undefined)
            setExtensionWidgets((prev) => {
              const next = state.extensionWidgets ?? [];
              const same =
                prev.length === next.length &&
                prev.every(
                  (p, i) =>
                    p.key === next[i].key &&
                    p.placement === next[i].placement &&
                    p.lines.length === next[i].lines.length &&
                    p.lines.every((l, j) => l === next[i].lines[j]),
                );
              return same ? prev : next;
            });
          if (state.pendingUiRequests) {
            for (const r of state.pendingUiRequests) recoverExtensionUiRequest(r);
          }
        }
        const busy =
          data.running &&
          state &&
          (state.isStreaming || state.isPromptRunning || state.isCompacting);
        if (busy || !agentRunningRef.current) return;
        await finishPromptWithoutStream(sid, runId);
      } catch {
        // Network still down — the next poll / visibility / online tick retries.
      }
    },
    [finishPromptWithoutStream, recoverExtensionUiRequest],
  );

  // Recovery net for missed SSE events: while the agent is running, verify
  // against the server periodically and whenever the tab returns to the
  // foreground or the network comes back. Skip periodic polling when the SSE
  // connection is healthy (EventSource.OPEN) — network transitions and tab
  // visibility still trigger a one-off check.
  useEffect(() => {
    if (!agentRunning) return;
    // Debounce so that near-simultaneous triggers (tab foregrounded AND network
    // restored AND interval tick) coalesce into a single GET instead of 2-3.
    const RECONCILE_DEBOUNCE_MS = 300;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const reconcile = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        // Read the ref on every tick: for brand-new sessions the id is
        // assigned only after ensure_session returns.
        const sid = sessionIdRef.current;
        if (sid) void reconcileAgentState(sid);
      }, RECONCILE_DEBOUNCE_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    const interval = setInterval(() => {
      // Always reconcile while the agent is running. Skipping the poll while the
      // SSE is OPEN used to save one HTTP round-trip, but it caused the chat to
      // freeze: when the EventSource silently dropped and reconnected, a run that
      // finished during the gap never re-delivered `agent_end`, and a healthy
      // OPEN connection suppressed the only recovery path. Polling the server
      // state every tick catches the missed completion (reconcileAgentState is a
      // no-op while the agent is genuinely busy), so input + streaming always
      // recover within one interval without a manual page refresh.
      reconcile();
    }, AGENT_STATE_RECONCILE_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", reconcile);
    return () => {
      if (debounce) clearTimeout(debounce);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", reconcile);
    };
  }, [agentRunning, reconcileAgentState]);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

  const handleAgentEvent = useCallback(
    (event: AgentEvent) => {
      // Emit to the extension event bus so panels/labels can react in real-time.
      const busTypes = new Set([
        "agent_start",
        "agent_end",
        "tool_execution_start",
        "tool_execution_end",
        "message_end",
        "compaction_start",
        "compaction_end",
        "auto_compaction_start",
        "auto_compaction_end",
      ]);
      if (busTypes.has(event.type)) {
        const et =
          event.type === "auto_compaction_start"
            ? "compaction_start"
            : event.type === "auto_compaction_end"
              ? "compaction_end"
              : event.type;
        getAgentEventBus().emit({
          type: et as "agent_start",
          sessionId: sessionIdRef.current ?? undefined,
          toolName: event.toolName as string | undefined,
          toolCallId: event.toolCallId as string | undefined,
          role: (event.message as { role?: string } | undefined)?.role,
          aborted: event.aborted as boolean | undefined,
          timestamp: Date.now(),
        });
      }
      switch (event.type) {
        case "agent_start":
          agentRunningRef.current = true;
          setAgentRunning(true);
          setAgentPhase({ kind: "waiting_model" });
          dispatch({ type: "start" });
          break;
        case "agent_end":
          // A late agent_end can arrive over SSE after reconcileAgentState
          // already finished this run — don't re-trigger completion.
          if (!agentRunningRef.current) break;
          agentRunningRef.current = false;
          setAgentRunning(false);
          setAgentPhase(null);
          setRetryInfo(null);
          dispatch({ type: "end" });
          if (sessionIdRef.current) {
            loadSession(sessionIdRef.current);
            fetch(`/api/agent/${encodeURIComponent(sessionIdRef.current)}`)
              .then((r) => r.json())
              .then((d: { state?: AgentStateResponse }) => {
                if (!mountedRef.current) return;
                if (d.state?.contextUsage !== undefined)
                  setContextUsage(d.state.contextUsage ?? null);
                if (d.state?.systemPrompt !== undefined)
                  setSystemPrompt(d.state.systemPrompt ?? null);
                if (d.state?.extensionStatuses !== undefined)
                  setExtensionStatuses(d.state.extensionStatuses ?? []);
                if (d.state?.extensionWidgets !== undefined)
                  setExtensionWidgets(d.state.extensionWidgets ?? []);
                // Aborted turns can leave messages queued in pi (delivered with the
                // next turn); dead wrapper (no state) means the queue is gone.
                setQueuedMessages(normalizeQueuedMessages(d.state?.queuedMessages));
              })
              .catch(() => {});
          }
          onAgentEnd?.();
          break;
        case "prompt_done":
          if (!agentRunningRef.current) break;
          void finishPromptWithoutStream(sessionIdRef.current);
          break;
        case "prompt_error":
          addNotice({
            type: "error",
            message: (event.errorMessage as string | undefined) ?? "命令执行失败",
          });
          break;
        case "extension_error":
          addNotice({
            type: "error",
            message: (event.error as string | undefined) ?? "扩展命令失败",
          });
          break;
        case "message_start":
        case "message_update": {
          // Ignore streaming events arriving after this run already finished
          // (e.g. SSE data buffered while the tab was frozen, flushed after
          // reconcile) — they would resurrect a ghost streaming bubble.
          if (!agentRunningRef.current) break;
          const msg = event.message as Partial<AgentMessage> | undefined;
          if (msg?.role === "user") {
            break;
          }
          if (msg) {
            dispatch({ type: "update", message: normalizeToolCalls(msg as AgentMessage) });
          }
          // Avoid a state update (and therefore a full ChatWindow re-render) on
          // every streaming tick: only clear the phase when it isn't already
          // cleared. Object.is bails out of the re-render when the value is
          // unchanged.
          setAgentPhase((prev) => (prev === null ? prev : null));
          break;
        }
        case "message_end": {
          // Same late-event guard: after reconcile finished this run,
          // loadSession already loaded this message from the session file —
          // appending it again would duplicate it.
          if (!agentRunningRef.current) break;
          const completed = event.message as AgentMessage | undefined;
          if (completed && completed.role === "user") {
            // Delivered steering/follow-up messages surface here as user
            // messages. The run's initial prompt also emits one, but handleSend
            // already appended it optimistically. Consume only the still-adjacent
            // optimistic bubble; later same-text queue deliveries must render.
            const delivered = normalizeToolCalls(completed);
            const deliveredKey = userMessageKey(delivered);
            const optimisticKey = optimisticUserMessageKeyRef.current;
            optimisticUserMessageKeyRef.current = null;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (
                optimisticKey &&
                last?.role === "user" &&
                userMessageKey(last) === optimisticKey
              ) {
                return optimisticKey === deliveredKey ? prev : [...prev.slice(0, -1), delivered];
              }
              return [...prev, delivered];
            });
          } else if (completed) {
            setMessages((prev) => [...prev, normalizeToolCalls(completed)]);
          }
          dispatch({ type: "reset" });
          setAgentPhase({ kind: "waiting_model" });
          break;
        }
        case "tool_execution_start": {
          const id = event.toolCallId as string;
          const name = event.toolName as string;
          setAgentPhase((prev) => {
            const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
            if (!tools.some((t) => t.id === id)) tools.push({ id, name });
            return { kind: "running_tools", tools };
          });
          break;
        }
        case "tool_execution_end": {
          const id = event.toolCallId as string;
          setAgentPhase((prev) => {
            if (prev?.kind !== "running_tools") return prev;
            const tools = prev.tools.filter((t) => t.id !== id);
            if (tools.length === 0) return { kind: "waiting_model" };
            return { kind: "running_tools", tools };
          });
          break;
        }
        case "queue_update":
          setQueuedMessages({
            steering: [...((event.steering as string[] | undefined) ?? [])],
            followUp: [...((event.followUp as string[] | undefined) ?? [])],
          });
          break;
        case "auto_retry_start":
          setRetryInfo({
            attempt: event.attempt as number,
            maxAttempts: event.maxAttempts as number,
            errorMessage: event.errorMessage as string | undefined,
          });
          break;
        case "auto_retry_end":
          setRetryInfo(null);
          break;
        case "auto_compaction_start":
        case "compaction_start":
          setIsCompacting(true);
          setCompactError(null);
          setCompactResult(null);
          break;
        case "auto_compaction_end":
        case "compaction_end":
          setIsCompacting(false);
          if (event.errorMessage) {
            let errorMessage = event.errorMessage as string;
            // Improve error messages for common compact failures
            if (errorMessage.includes("model_context") || errorMessage.includes("finish_reason")) {
              errorMessage = "压缩失败：模型上下文超出上限，请尝试切换到上下文窗口更大的模型。";
            } else if (errorMessage.includes("Summarization failed")) {
              errorMessage = "压缩失败：无法生成摘要，当前模型可能无法处理过大的会话。";
            }
            setCompactError(errorMessage);
            setCompactResult(null);
          } else if (!event.aborted) {
            setCompactResult(
              readCompactResult(event.result, (event.reason as string | undefined) ?? "auto"),
            );
            if (sessionIdRef.current) loadSession(sessionIdRef.current);
          }
          break;
        case "extension_ui_request":
          handleExtensionUiRequest(event as ExtensionUiRequest);
          break;
      }
    },
    [addNotice, finishPromptWithoutStream, handleExtensionUiRequest, loadSession, onAgentEnd],
  );
  handleAgentEventRef.current = handleAgentEvent;

  useEffect(() => {
    if (!opts.onSystemPromptChange) return;
    opts.onSystemPromptChange(systemPrompt);
  }, [systemPrompt, opts.onSystemPromptChange]);

  // Compact error auto-dismiss
  useEffect(() => {
    if (!compactError) return;
    const t = setTimeout(() => setCompactError(null), 3000);
    return () => clearTimeout(t);
  }, [compactError]);

  useEffect(() => {
    if (!compactResult) return;
    const t = setTimeout(() => setCompactResult(null), 6000);
    return () => clearTimeout(t);
  }, [compactResult]);

  useEffect(() => {
    if (noticeState.visible.length === 0) return;
    const exiting = noticeState.visible.find((notice) => notice.exiting);
    if (exiting) {
      const t = setTimeout(() => {
        dispatchNotice({ type: "remove", id: exiting.id });
      }, NOTICE_EXIT_ANIMATION_MS);
      return () => clearTimeout(t);
    }
    const oldest = noticeState.visible[0];
    if (!oldest) return;
    const t = setTimeout(() => {
      dispatchNotice({ type: "mark_oldest_exiting" });
    }, NOTICE_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [noticeState.visible]);

  useEffect(() => {
    setSessionStatsOverride(null);
  }, [messages.length, contextUsage?.tokens, contextUsage?.percent, contextUsage?.contextWindow]);

  const streamApi: SessionStreamApi = {
    addNotice,
    loadSession,
    loadContext,
    promoteNewSession,
    ensureNewSession,
    loadSlashCommands,
    connectEvents,
    ensureEventsConnected,
    respondToExtensionUi,
    sendExtensionCustomInput,
    handleExtensionUiRequest,
    recoverExtensionUiRequest,
    finishPromptWithoutStream,
    waitForPromptSettlement,
    reconcileAgentState,
    handleAgentEvent,
    ensuringNewSessionRef,
    mountedRef,
    reconnectTimerRef,
    setCurrentModelOverride,
    setPendingModel,
    setThinkingLevel,
    modelStateRef,
    setData,
    setLoading,
    setError,
    setEntryIds,
    dispatch,
    setAgentRunning,
    setRetryInfo,
    setContextUsage,
    setSystemPrompt,
    setIsCompacting,
    setCompactError,
    setCompactResult,
    setAgentPhase,
    setSlashCommands,
    setSlashCommandsLoading,
    dispatchNotice,
    setSessionStatsOverride,
    setExtensionDialog,
    setExtensionCustomUi,
    setExtensionStatuses,
    setExtensionWidgets,
    setQueuedMessages,
    setIsAtBottom,
    agentRunningRef,
    pendingScrollToUserRef,
    completionScrollAllowedRef,
    optimisticUserMessageKeyRef,
    promptRunIdRef,
    userScrollIntentUntilRef,
    ignoreProgrammaticScrollUntilRef,
  };

  const publicSlice = {
    // State
    data,
    loading,
    error,
    activeLeafId,
    messages,
    entryIds,
    streamState,
    agentRunning,
    thinkingLevel,
    retryInfo,
    contextUsage,
    systemPrompt,
    forkingEntryId,
    isCompacting,
    compactError,
    compactResult,
    currentModel,
    sessionStats,
    slashCommands,
    slashCommandsLoading,
    queuedMessages,
    notices: noticeState.visible,
    extensionDialog,
    extensionCustomUi,
    extensionStatuses,
    extensionWidgets,
    respondToExtensionUi,
    sendExtensionCustomInput,
    agentPhase,
    isNew,
    isAtBottom,
    // Refs
    sessionIdRef,
    eventSourceRef,
    messagesEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    pendingScrollToUserRef,
    initialScrollDoneRef,
    // Setters / raw
    setActiveLeafId,
    setData,
    setMessages,
    dispatch,
    setAgentRunning,
    setForkingEntryId,
    handleAgentEventRef,
    // Functions also needed by the facade (returned in original monolithic API)
    loadSlashCommands,
  };

  return [publicSlice, streamApi] as const;
}

export type SessionStreamSlice = ReturnType<typeof useSessionStream>[0];
