"use client";

import { useState, useCallback, useRef, useEffect, useReducer } from "react";
import type {
  AgentMessage,
  AssistantMessage,
  AttachedImage,
  ChatInputHandle,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionWidgetItem,
  SessionInfo,
  SessionTreeNode,
} from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { localizeExtensionUiRequest, resolveSelectValue } from "@/lib/plugin-ui-i18n";
import type { ContextUsage } from "@/lib/pi-types";
import {
  streamReducer,
  normalizeQueuedMessages,
  noticeReducer,
  createNoticeId,
  fillPendingNotices,
  extractMessageText,
  userMessageKey,
  readCompactResult,
  MAX_NOTICES,
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
import {
  getToolNamesForPreset,
  getPresetFromTools,
  toolsToToolNames,
  defaultToolEntries,
  type ToolEntry,
} from "@/lib/tool-presets";
import { getAgentRuntimeStore } from "@/lib/agent-runtime-store";
import { reportUserStatus } from "@/lib/constraints";
import { getAgentEventBus } from "@/lib/extensions/event-bus";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { csrfHeaders } from "@/lib/csrf-client";

export interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

interface LastAssistantTextResponse {
  text?: string;
}

type AgentStateResponse = {
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  systemPrompt?: string;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isPromptRunning?: boolean;
  isCompacting?: boolean;
  extensionStatuses?: ExtensionStatusItem[];
  extensionWidgets?: ExtensionWidgetItem[];
  // Pending extension UI requests (dialogs/custom panels/widgets/status) the
  // server is still awaiting a response for. Surfaced so a missed SSE event
  // can be recovered by the reconcile poll instead of requiring a refresh.
  pendingUiRequests?: ExtensionUiRequest[];
  queuedMessages?: { steering?: string[]; followUp?: string[] } | null;
};

type ExtensionUiDialogRequest = Extract<
  ExtensionUiRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;
type ExtensionUiCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_command" }
  | { kind: "running_tools"; tools: Array<{ id: string; name: string }> }
  | null;

export interface SlashCommandInfo {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
  sourceInfo?: {
    path: string;
    source: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
}

export type BuiltinSlashCommandResult =
  | { handled: false }
  | { handled: true; message?: string; error?: string; action?: "openSessionStats" };

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  /** Bumped after PluginsConfig reloads plugins. Triggers a tool-list
   *  re-fetch without unmounting the chat subtree. */
  pluginsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (
    tree: SessionTreeNode[],
    activeLeafId: string | null,
    onLeafChange: (leafId: string | null) => void,
  ) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsPanelOpen?: () => void;
  setToolPreset?: (preset: "none" | "default" | "full") => void;
}

export type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const PROGRAMMATIC_SCROLL_IGNORE_MS = 700;
const USER_SCROLL_INTENT_MS = 1200;
/** Distance from the bottom (px) within which we consider the view "at bottom". */
const BOTTOM_DISTANCE_PX = 80;
const PROMPT_SETTLE_INITIAL_DELAY_MS = 800;
const PROMPT_SETTLE_POLL_MS = 600;
const PROMPT_SETTLE_MAX_MS = 20_000;
const AGENT_STATE_RECONCILE_MS = 15_000;
const EVENT_STREAM_CONNECT_TIMEOUT_MS = 5_000;
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Space",
  "Spacebar",
]);

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

type SelectedModel = { provider: string; modelId: string };
type ModelEntry = { id: string; name: string; provider: string };
type ModelsResponse = {
  models: Record<string, string>;
  modelList?: ModelEntry[];
  defaultModel?: SelectedModel | null;
  thinkingLevels?: Record<string, string[]>;
  thinkingLevelMaps?: Record<string, Record<string, string | null>>;
};

type SlashCommandsResponse = {
  commands?: SlashCommandInfo[];
};

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session,
    newSessionCwd,
    onAgentEnd,
    onSessionCreated,
    onSessionForked,
    modelsRefreshKey,
    pluginsRefreshKey,
    onBranchDataChange,
    onSystemPromptChange,
    onSessionStatsPanelOpen,
  } = opts;

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
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelEntry[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<
    Record<string, Record<string, string | null>>
  >({});
  const [newSessionModel, setNewSessionModel] = useState<SelectedModel | null>(null);
  const [newSessionDefaultModel, setNewSessionDefaultModel] = useState<SelectedModel | null>(null);
  const [toolPreset, setToolPreset] = useState<"none" | "default" | "full">("default");
  // Per-tool granularity (replaces the three-tier preset in the UI). Seeded from
  // the DEFAULT preset so a brand-new session has a sensible starting set; an
  // existing session is refreshed from get_tools on mount.
  const [tools, setTools] = useState<ToolEntry[]>(() => defaultToolEntries());
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  const [retryInfo, setRetryInfo] = useState<{
    attempt: number;
    maxAttempts: number;
    errorMessage?: string;
  } | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<{
    provider: string;
    modelId: string;
  } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(
    null,
  );
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

  const setToolPresetState = opts.setToolPreset ?? setToolPreset;

  const currentModel = currentModelOverride ?? data?.context.model ?? pendingModel ?? null;
  const displayModel = isNew ? (newSessionModel ?? newSessionDefaultModel) : currentModel;

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

  // Sync runtime state to the global store so AppShell, extension panels, and
  // other consumers outside ChatWindow's render tree can observe agent state.
  // sessionStats is recomputed as a fresh object every render (IIFE), so we
  // read it from a ref to avoid re-triggering this effect on every render.
  const runtimeStore = getAgentRuntimeStore();
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    runtimeStore.update({
      sessionId: sessionIdRef.current,
      agentRunning,
      agentPhase,
      tools,
      sessionStats: sessionStatsRef.current,
      contextUsage,
    });
  }, [runtimeStore, agentRunning, agentPhase, tools, contextUsage]);

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

  const loadTools = useCallback(
    async (sid: string) => {
      try {
        const toolList = await sendAgentCommand<ToolEntry[]>(sid, { type: "get_tools" });
        if (toolList) {
          setTools(toolList);
          setToolPresetState(getPresetFromTools(toolList));
        }
      } catch (e) {
        console.error("Failed to load tools:", e);
      }
    },
    [setToolPresetState],
  );

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
  }, [isNew, newSessionCwd, newSessionModel, newSessionDefaultModel, tools, thinkingLevel]);

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

  const handleSend = useCallback(
    async (message: string, images?: AttachedImage[]) => {
      const trimmedMessage = message.trim();
      if (!trimmedMessage && !images?.length) return;
      if (agentRunning) return;
      const isSlashCommandPrompt = !images?.length && trimmedMessage.startsWith("/");
      const promptRunId = promptRunIdRef.current + 1;

      const imageBlocks = images?.map((img) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: img.mimeType, data: img.data },
      }));
      const userMsg: AgentMessage = {
        role: "user",
        content: imageBlocks?.length
          ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
          : message,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      optimisticUserMessageKeyRef.current = userMessageKey(userMsg);
      promptRunIdRef.current = promptRunId;
      agentRunningRef.current = true;
      setAgentRunning(true);
      setAgentPhase(isSlashCommandPrompt ? { kind: "running_command" } : { kind: "waiting_model" });
      dispatch({ type: "start" });
      pendingScrollToUserRef.current = true;
      completionScrollAllowedRef.current = true;

      const piImages = images?.map((img) => ({
        type: "image" as const,
        data: img.data,
        mimeType: img.mimeType,
      }));

      try {
        let sentSessionId: string | null = null;
        if (isNew && newSessionCwd) {
          const selectedModel = newSessionModel;
          const existingSid = sessionIdRef.current ?? (await ensuringNewSessionRef.current);
          const sid = existingSid ?? (await ensureNewSession());

          if (sid) {
            sentSessionId = sid;
            if (selectedModel) {
              setPendingModel(selectedModel);
              if (existingSid) {
                await sendAgentCommand(sid, {
                  type: "set_model",
                  provider: selectedModel.provider,
                  modelId: selectedModel.modelId,
                });
              }
            }
            await ensureEventsConnected(sid);
            await sendAgentCommand(sid, {
              type: "prompt",
              message,
              ...(piImages?.length ? { images: piImages } : {}),
            });
            promoteNewSession(1, message);
          }
        } else if (session) {
          sentSessionId = session.id;
          await ensureEventsConnected(session.id);
          await sendAgentCommand(session.id, {
            type: "prompt",
            message,
            ...(piImages?.length ? { images: piImages } : {}),
          });
        }
        if (isSlashCommandPrompt && sentSessionId) {
          void waitForPromptSettlement(sentSessionId, promptRunId);
        }
      } catch (e) {
        console.error("Failed to send message:", e);
        if (e instanceof EventStreamConnectionError) {
          const optimisticKey = optimisticUserMessageKeyRef.current;
          if (optimisticKey) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              return last?.role === "user" && userMessageKey(last) === optimisticKey
                ? prev.slice(0, -1)
                : prev;
            });
          }
          addNotice({ type: "error", message: e.message });
        }
        optimisticUserMessageKeyRef.current = null;
        agentRunningRef.current = false;
        setAgentRunning(false);
        setAgentPhase(null);
        dispatch({ type: "end" });
      }
    },
    [
      isNew,
      newSessionCwd,
      newSessionModel,
      session,
      agentRunning,
      ensureNewSession,
      ensureEventsConnected,
      promoteNewSession,
      waitForPromptSettlement,
      addNotice,
    ],
  );

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, []);

  const handleFork = useCallback(
    async (entryId: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      setForkingEntryId(entryId);
      try {
        const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, {
          type: "fork",
          entryId,
        });
        const { cancelled, newSessionId } = result ?? {};
        if (!cancelled && newSessionId) {
          onSessionForked?.(newSessionId);
        }
      } catch (e) {
        console.error("Fork failed:", e);
      } finally {
        setForkingEntryId(null);
      }
    },
    [onSessionForked],
  );

  const handleNavigate = useCallback(
    async (entryId: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId }).catch(() => {});
      setActiveLeafId(entryId);
      await loadContext(sid, entryId);
    },
    [loadContext],
  );

  const handleLeafChange = useCallback(
    async (leafId: string | null) => {
      setActiveLeafId(leafId);
      const sid = sessionIdRef.current;
      if (!sid) return;
      await loadContext(sid, leafId);
      if (leafId) {
        sendAgentCommand(sid, { type: "navigate_tree", targetId: leafId }).catch(() => {});
      }
    },
    [loadContext],
  );

  const handleModelChange = useCallback(
    async (provider: string, modelId: string) => {
      if (isNew) {
        setNewSessionModel({ provider, modelId });
        setPendingModel({ provider, modelId });
        const sid = sessionIdRef.current ?? (await ensuringNewSessionRef.current);
        if (!sid) return;
        try {
          await sendAgentCommand(sid, { type: "set_model", provider, modelId });
        } catch (e) {
          console.error("Failed to set model:", e);
        }
        return;
      }
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_model", provider, modelId });
        setCurrentModelOverride({ provider, modelId });
      } catch (e) {
        console.error("Failed to set model:", e);
      }
    },
    [isNew, setNewSessionModel],
  );

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return;
    setIsCompacting(true);
    setCompactError(null);
    setCompactResult(null);
    try {
      const result = await sendAgentCommand<CompactCommandResult>(sid, { type: "compact" });
      setCompactResult(readCompactResult(result, "manual"));
      await loadSession(sid, true);
    } catch (e) {
      let errorMessage = e instanceof Error ? e.message : String(e);
      // Improve error messages for common compact failures
      if (errorMessage.includes("model_context") || errorMessage.includes("finish_reason")) {
        errorMessage = "压缩失败：模型上下文超出上限，请尝试切换到上下文窗口更大的模型。";
      } else if (errorMessage.includes("Summarization failed")) {
        errorMessage = "压缩失败：无法生成摘要，当前模型可能无法处理过大的会话。";
      }
      setCompactError(errorMessage);
      setCompactResult(null);
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, loadSession]);

  const loadModels = useCallback(
    async (signal?: AbortSignal) => {
      const modelCwd = newSessionCwd ?? session?.cwd ?? "";
      const modelsUrl = modelCwd
        ? `/api/models?cwd=${encodeURIComponent(modelCwd)}`
        : "/api/models";
      const res = await fetch(modelsUrl, signal ? { signal } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as ModelsResponse;
      setModelNames(d.models);
      setModelThinkingLevels(d.thinkingLevels ?? {});
      setModelThinkingLevelMaps(d.thinkingLevelMaps ?? {});
      const nextModelList = d.modelList ?? [];
      setModelList(nextModelList);
      if (isNew) {
        const match = d.defaultModel
          ? nextModelList.find(
              (m) => m.id === d.defaultModel?.modelId && m.provider === d.defaultModel?.provider,
            )
          : undefined;
        const displayModel = match ?? nextModelList[0];
        setNewSessionDefaultModel(
          displayModel ? { provider: displayModel.provider, modelId: displayModel.id } : null,
        );
      }
    },
    [isNew, newSessionCwd, session?.cwd],
  );

  const handleBuiltinSlashCommand = useCallback(
    async (text: string): Promise<BuiltinSlashCommandResult> => {
      if (!text.startsWith("/")) return { handled: false };
      const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
      if (!match) return { handled: false };

      const [, commandName, rawArgs = ""] = match;
      const args = rawArgs.trim();
      const sid = sessionIdRef.current ?? (await ensureNewSession());
      const complete = (result: BuiltinSlashCommandResult): BuiltinSlashCommandResult => {
        if (!result.handled) return result;
        if (result.error) {
          addNotice({ type: "error", message: result.error });
        } else if (result.action !== "openSessionStats") {
          addNotice({ type: "success", message: result.message ?? "命令已完成" });
        }
        return result;
      };

      try {
        switch (commandName) {
          case "compact": {
            if (!sid || isCompacting)
              return complete({ handled: true, error: "没有可压缩的活动会话" });
            setIsCompacting(true);
            setCompactError(null);
            setCompactResult(null);
            try {
              const result = await sendAgentCommand<CompactCommandResult>(sid, {
                type: "compact",
                ...(args ? { customInstructions: args } : {}),
              });
              setCompactResult(readCompactResult(result, "manual"));
              if (await loadSession(sid, true)) promoteNewSession();
              return complete({ handled: true, message: "Compacted context" });
            } catch (e) {
              let errorMessage = e instanceof Error ? e.message : String(e);
              // Improve error messages for common compact failures
              if (
                errorMessage.includes("model_context") ||
                errorMessage.includes("finish_reason")
              ) {
                errorMessage = "压缩失败：模型上下文超出上限，请尝试切换到上下文窗口更大的模型。";
              } else if (errorMessage.includes("Summarization failed")) {
                errorMessage = "压缩失败：无法生成摘要，当前模型可能无法处理过大的会话。";
              }
              setCompactError(errorMessage);
              return complete({ handled: true, error: errorMessage });
            }
          }

          case "reload": {
            if (!sid) return complete({ handled: true, error: "没有可重新加载的活动会话" });
            await sendAgentCommand(sid, { type: "reload" });
            await Promise.all([
              loadSession(sid, false, true),
              loadTools(sid),
              loadSlashCommands(),
              loadModels(),
            ]);
            return complete({ handled: true, message: "Reloaded session resources" });
          }

          case "name": {
            if (!sid) return complete({ handled: true, error: "没有可命名的活动会话" });
            if (!args) return complete({ handled: true, error: "用法：/name <名称>" });
            await sendAgentCommand(sid, { type: "set_session_name", name: args });
            if (await loadSession(sid)) promoteNewSession();
            return complete({ handled: true, message: `Session renamed to ${args}` });
          }

          case "session": {
            if (!sid) return complete({ handled: true, error: "没有活动会话" });
            const stats = await sendAgentCommand<SessionStatsInfo>(sid, {
              type: "get_session_stats",
            });
            if (stats) {
              setSessionStatsOverride(stats);
            }
            onSessionStatsPanelOpen?.();
            return complete({ handled: true, action: "openSessionStats" });
          }

          case "copy": {
            if (!sid) return complete({ handled: true, error: "No active session" });
            const data = await sendAgentCommand<LastAssistantTextResponse>(sid, {
              type: "get_last_assistant_text",
            });
            const textToCopy = data?.text ?? "";
            if (!textToCopy) return complete({ handled: true, error: "没有可复制的助手消息" });
            await navigator.clipboard.writeText(textToCopy);
            return complete({ handled: true, message: "Copied last assistant message" });
          }

          default:
            return { handled: false };
        }
      } catch (e) {
        return complete({ handled: true, error: e instanceof Error ? e.message : String(e) });
      } finally {
        if (commandName === "compact") setIsCompacting(false);
      }
    },
    [
      addNotice,
      ensureNewSession,
      isCompacting,
      loadModels,
      loadSession,
      loadSlashCommands,
      loadTools,
      promoteNewSession,
      onSessionStatsPanelOpen,
    ],
  );

  // Queued (undelivered) messages live in the queue panel only; the chat gets
  // the real user message when pi delivers it (user message_end event). An
  // optimistic chat bubble here would duplicate the queue panel and turn into
  // a ghost message if the queue is recalled.
  const handleSteer = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({
      type: "image" as const,
      data: img.data,
      mimeType: img.mimeType,
    }));
    try {
      await sendAgentCommand(sid, {
        type: "steer",
        message,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to steer:", e);
    }
  }, []);

  const handlePromptWithStreamingBehavior = useCallback(
    async (message: string, behavior: "steer" | "followUp", images?: AttachedImage[]) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const piImages = images?.map((img) => ({
        type: "image" as const,
        data: img.data,
        mimeType: img.mimeType,
      }));
      try {
        await sendAgentCommand(sid, {
          type: "prompt",
          message,
          streamingBehavior: behavior,
          ...(piImages?.length ? { images: piImages } : {}),
        });
      } catch (e) {
        console.error("Failed to queue prompt:", e);
      }
    },
    [],
  );

  const handleFollowUp = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({
      type: "image" as const,
      data: img.data,
      mimeType: img.mimeType,
    }));
    try {
      await sendAgentCommand(sid, {
        type: "follow_up",
        message,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to follow up:", e);
    }
  }, []);

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, []);

  const handleRecallQueue = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const result = await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, {
        type: "clear_queue",
      });
      // clearQueue also emits an empty queue_update, but that only reaches us
      // while SSE is connected — clear locally so idle recalls update the UI.
      setQueuedMessages({ steering: [], followUp: [] });
      const texts = [...(result?.steering ?? []), ...(result?.followUp ?? [])];
      if (texts.length > 0) {
        opts.chatInputRef?.current?.prependText(texts.join("\n\n"));
      }
    } catch (e) {
      console.error("Failed to recall queued messages:", e);
      addNotice({ type: "error", message: "撤回排队消息失败" });
    }
  }, [opts.chatInputRef, addNotice]);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    setThinkingLevel(level);
    if (level === "auto") return; // "auto" leaves pi's current setting untouched
    const sid = sessionIdRef.current ?? (await ensuringNewSessionRef.current);
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
    }
  }, []);

  const handleToolPresetChange = useCallback(
    async (preset: "none" | "default" | "full") => {
      const toolNames = getToolNamesForPreset(preset);
      setToolPresetState(preset);
      const sid = sessionIdRef.current ?? (await ensuringNewSessionRef.current);
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_tools", toolNames });
      } catch (e) {
        console.error("Failed to set tools:", e);
      }
    },
    [setToolPresetState],
  );

  // Per-tool granularity: toggle individual tools on/off. The UI passes the
  // updated full list; we persist it to the SDK and update local state. The
  // server's set_tools applies the list verbatim (no extension-tool union).
  const handleToolsChange = useCallback(
    async (nextTools: ToolEntry[]) => {
      setTools(nextTools);
      const toolNames = toolsToToolNames(nextTools);
      setToolPresetState(getPresetFromTools(nextTools));
      const sid = sessionIdRef.current ?? (await ensuringNewSessionRef.current);
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_tools", toolNames });
      } catch (e) {
        console.error("Failed to set tools:", e);
      }
    },
    [setToolPresetState],
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const scrollUserMsgToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const el = lastUserMsgRef.current;
    if (!container || !el) return;
    const elAbsTop =
      el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    container.scrollTo({ top: elAbsTop - 16, behavior: "smooth" });
  }, []);

  const markUserScrollIntent = useCallback((event: Event) => {
    if (event instanceof KeyboardEvent) {
      if (!SCROLL_KEYS.has(event.key)) return;
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, [contenteditable='true']")
      )
        return;
    }
    userScrollIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
  }, []);

  const handleScrollPositionChange = useCallback(() => {
    // Track whether the viewport is pinned near the bottom — always, regardless
    // of agent running state, so the floating "scroll to bottom" button shows.
    const container = scrollContainerRef.current;
    if (container) {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      setIsAtBottom(distance < BOTTOM_DISTANCE_PX);
    }
    // Suppress completion auto-scroll only when the user actively scrolled away
    // during a run.
    if (!agentRunningRef.current) return;
    if (Date.now() < ignoreProgrammaticScrollUntilRef.current) return;
    if (Date.now() > userScrollIntentUntilRef.current) return;
    completionScrollAllowedRef.current = false;
  }, []);

  // Manual "scroll to bottom" invoked by the floating button: jumps to the
  // bottom and re-enables completion auto-scroll so future runs follow.
  const scrollToBottomAction = useCallback(() => {
    completionScrollAllowedRef.current = true;
    scrollToBottom("smooth");
    setIsAtBottom(true);
  }, [scrollToBottom]);

  // Load session on mount
  useEffect(() => {
    if (session) {
      sessionIdRef.current = session.id;
      loadSession(session.id, true, true).then((agentState) => {
        // Always load the real tool list so the per-tool panel reflects the
        // session's persisted state — not just when the agent is running.
        loadTools(session.id);
        if (agentState?.running) {
          const state = agentState.state;
          // `streaming` means we got a real state with an active run. `timedOut`
          // means the server reported the agent as running but get_state exceeded
          // the 5s budget and returned no state — the session is alive but its
          // exact phase is unknown. In that case we still connect SSE so we don't
          // leave a running session stuck/disconnected; the next reconcile will
          // settle the phase once state becomes available.
          const streaming = state?.isStreaming || state?.isPromptRunning;
          if (streaming || agentState.timedOut) {
            agentRunningRef.current = true;
            setAgentRunning(true);
            setAgentPhase(
              streaming
                ? state?.isStreaming
                  ? { kind: "waiting_model" }
                  : { kind: "running_command" }
                : { kind: "waiting_model" },
            );
            dispatch({ type: "start" });
            void connectEvents(session.id);
            if (streaming && !state?.isStreaming && state?.isPromptRunning) {
              void waitForPromptSettlement(session.id);
            }
          }
        }
        if (agentState?.state) {
          if (agentState.state.isCompacting !== undefined)
            setIsCompacting(agentState.state.isCompacting);
          if (agentState.state.contextUsage !== undefined)
            setContextUsage(agentState.state.contextUsage ?? null);
          if (agentState.state.systemPrompt !== undefined)
            setSystemPrompt(agentState.state.systemPrompt ?? null);
          if (agentState.state.thinkingLevel !== undefined)
            setThinkingLevel((agentState.state.thinkingLevel as ThinkingLevelOption) ?? "auto");
          if (agentState.state.extensionStatuses !== undefined)
            setExtensionStatuses(agentState.state.extensionStatuses ?? []);
          if (agentState.state.extensionWidgets !== undefined)
            setExtensionWidgets(agentState.state.extensionWidgets ?? []);
          if (agentState.state.queuedMessages !== undefined)
            setQueuedMessages(normalizeQueuedMessages(agentState.state.queuedMessages));
        }
      });
    }
    return () => {
      mountedRef.current = false;
      // Cancel any pending SSE reconnect so it can't open a new EventSource on
      // an unmounted hook, and signal running=false so a timer that already
      // fired its callback guards out via agentRunningRef.
      agentRunningRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onSystemPromptChange?.(systemPrompt);
  }, [systemPrompt, onSystemPromptChange]);

  useEffect(() => {
    if (!onBranchDataChange) return;
    onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange);
  }, [data?.tree, activeLeafId, handleLeafChange, onBranchDataChange]);

  useEffect(() => {
    window.addEventListener("keydown", markUserScrollIntent);
    window.addEventListener("pointerdown", markUserScrollIntent, { passive: true });
    return () => {
      window.removeEventListener("keydown", markUserScrollIntent);
      window.removeEventListener("pointerdown", markUserScrollIntent);
    };
  }, [markUserScrollIntent]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener("wheel", markUserScrollIntent, { passive: true });
    container.addEventListener("touchstart", markUserScrollIntent, { passive: true });
    container.addEventListener("scroll", handleScrollPositionChange, { passive: true });
    return () => {
      container.removeEventListener("wheel", markUserScrollIntent);
      container.removeEventListener("touchstart", markUserScrollIntent);
      container.removeEventListener("scroll", handleScrollPositionChange);
    };
  }, [messages.length, loading, handleScrollPositionChange, markUserScrollIntent]);

  useEffect(() => {
    if (messages.length > 0) {
      if (pendingScrollToUserRef.current) {
        pendingScrollToUserRef.current = false;
        initialScrollDoneRef.current = true;
        scrollUserMsgToTop();
      } else if (!initialScrollDoneRef.current) {
        initialScrollDoneRef.current = true;
        scrollToBottom("instant");
      } else if (!agentRunningRef.current && completionScrollAllowedRef.current) {
        scrollToBottom("smooth");
      }
    }
  }, [messages.length, agentRunning, scrollToBottom, scrollUserMsgToTop]);

  // Load model list
  useEffect(() => {
    const controller = new AbortController();
    loadModels(controller.signal).catch((e) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
    });
    return () => controller.abort();
  }, [loadModels, modelsRefreshKey]);

  // Re-fetch tool list when plugins are reloaded. Mirrors the
  // modelsRefreshKey pattern: a counter bump from AppShell triggers a
  // lightweight in-place refresh instead of a full ChatWindow remount.
  useEffect(() => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    void loadTools(sid).catch((e) => {
      console.error("Failed to refresh tools after plugin reload:", e);
    });
  }, [loadTools, pluginsRefreshKey]);

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

  const reloadSession = useCallback(async () => {
    if (sessionIdRef.current) {
      await loadSession(sessionIdRef.current, true);
    }
  }, [loadSession]);

  return {
    // State
    data,
    loading,
    error,
    activeLeafId,
    messages,
    entryIds,
    streamState,
    agentRunning,
    modelNames,
    modelList,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    newSessionModel,
    toolPreset,
    tools,
    thinkingLevel,
    retryInfo,
    contextUsage,
    systemPrompt,
    forkingEntryId,
    isCompacting,
    compactError,
    compactResult,
    currentModel,
    displayModel,
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
    isAutoModelSelection: isNew && newSessionModel === null,
    agentPhase,
    isNew,
    // Refs
    sessionIdRef,
    eventSourceRef,
    messagesEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    pendingScrollToUserRef,
    initialScrollDoneRef,
    // Actions
    handleSend,
    handleAbort,
    handleFork,
    handleNavigate,
    handleModelChange,
    handleCompact,
    handleSteer,
    handleFollowUp,
    handlePromptWithStreamingBehavior,
    handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    reloadSession,
    handleToolPresetChange,
    handleToolsChange,
    handleThinkingLevelChange,
    loadTools,
    loadSlashCommands,
    setActiveLeafId,
    setData,
    setMessages,
    dispatch,
    setAgentRunning,
    setForkingEntryId,
    // Scroll-to-bottom
    isAtBottom,
    scrollToBottomAction,
    // Subscriptions
    handleAgentEventRef,
  };
}
