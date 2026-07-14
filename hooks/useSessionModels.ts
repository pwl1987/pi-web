"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { SessionInfo } from "@/lib/types";
import { sendAgentCommand } from "@/lib/agent-client";
import {
  getToolNamesForPreset,
  getPresetFromTools,
  toolsToToolNames,
  defaultToolEntries,
  type ToolEntry,
} from "@/lib/tool-presets";
import { getAgentRuntimeStore } from "@/lib/agent-runtime-store";
import {
  readCompactResult,
  normalizeQueuedMessages,
  type CompactResultInfo,
  type CompactCommandResult,
} from "@/lib/agent-session-helpers";
import { csrfHeaders } from "@/lib/csrf-client";
import type {
  UseAgentSessionOptions,
  AgentStateResponse,
  SlashCommandInfo,
  ThinkingLevelOption,
} from "./useAgentSession";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { SessionStreamApi, SessionStreamSlice } from "./useSessionStream";

type SelectedModel = { provider: string; modelId: string };
type ModelEntry = { id: string; name: string; provider: string };
type ModelsResponse = {
  models: Record<string, string>;
  modelList?: ModelEntry[];
  defaultModel?: SelectedModel | null;
  thinkingLevels?: Record<string, string[]>;
  thinkingLevelMaps?: Record<string, Record<string, string | null>>;
};

export type SessionModelsApi = {
  loadTools: (sid: string) => Promise<void>;
  loadModels: (signal?: AbortSignal) => Promise<void>;
  setToolPresetState: (preset: "none" | "default" | "full") => void;
  handleModelChange: (provider: string, modelId: string) => Promise<void>;
  handleToolPresetChange: (preset: "none" | "default" | "full") => Promise<void>;
  handleToolsChange: (nextTools: ToolEntry[]) => Promise<void>;
  handleThinkingLevelChange: (level: ThinkingLevelOption) => Promise<void>;
};

export function useSessionModels(
  opts: UseAgentSessionOptions,
  streamApi: SessionStreamApi,
  stream: SessionStreamSlice,
) {
  const { session, newSessionCwd, modelsRefreshKey } = opts;
  const { isNew, currentModel } = stream;

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
  const setToolPresetState = opts.setToolPreset ?? setToolPreset;

  const displayModel = isNew ? (newSessionModel ?? newSessionDefaultModel) : currentModel;
  const isAutoModelSelection = isNew && newSessionModel === null;

  // Keep the stream's model-state bridge in sync so ensureNewSession (which runs
  // before this hook can return a value) reads the latest model selection.
  streamApi.modelStateRef.current = { tools, newSessionModel, newSessionDefaultModel };

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

  const handleModelChange = useCallback(
    async (provider: string, modelId: string) => {
      if (isNew) {
        setNewSessionModel({ provider, modelId });
        streamApi.setPendingModel({ provider, modelId });
        const sid = stream.sessionIdRef.current ?? (await streamApi.ensureNewSession());
        if (!sid) return;
        try {
          await sendAgentCommand(sid, {
            type: "set_model",
            provider,
            modelId,
          });
        } catch (e) {
          console.error("Failed to set model:", e);
        }
        return;
      }
      const sid = stream.sessionIdRef.current;
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_model", provider, modelId });
        streamApi.setCurrentModelOverride({ provider, modelId });
      } catch (e) {
        console.error("Failed to set model:", e);
      }
    },
    [isNew, setNewSessionModel],
  );

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    streamApi.setThinkingLevel(level);
    if (level === "auto") return; // "auto" leaves pi's current setting untouched
    const sid = await streamApi.ensureNewSession();
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
      const sid = await streamApi.ensureNewSession();
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
      const sid = await streamApi.ensureNewSession();
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_tools", toolNames });
      } catch (e) {
        console.error("Failed to set tools:", e);
      }
    },
    [setToolPresetState],
  );

  // Sync runtime state to the global store so AppShell, extension panels, and
  // other consumers outside ChatWindow's render tree can observe agent state.
  // sessionStats is recomputed as a fresh object every render (IIFE), so we
  // read it from a ref to avoid re-triggering this effect on every render.
  const runtimeStore = getAgentRuntimeStore();
  const sessionStatsRef = useRef(stream.sessionStats);
  sessionStatsRef.current = stream.sessionStats;
  useEffect(() => {
    runtimeStore.update({
      sessionId: stream.sessionIdRef.current,
      agentRunning: stream.agentRunning,
      agentPhase: stream.agentPhase,
      tools,
      sessionStats: sessionStatsRef.current,
      contextUsage: stream.contextUsage,
    });
  }, [runtimeStore, stream.agentRunning, stream.agentPhase, tools, stream.contextUsage]);

  // Load model list
  useEffect(() => {
    const controller = new AbortController();
    loadModels(controller.signal).catch((e) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
    });
    return () => controller.abort();
  }, [loadModels, modelsRefreshKey]);

  // Load session on mount
  useEffect(() => {
    if (session) {
      stream.sessionIdRef.current = session.id;
      void streamApi.loadSession(session.id, true, true).then((agentState) => {
        // Always load the real tool list so the per-tool panel reflects the
        // session's persisted state — not just when the agent is running.
        void loadTools(session.id);
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
            streamApi.agentRunningRef.current = true;
            streamApi.setAgentRunning(true);
            streamApi.setAgentPhase(
              streaming
                ? state?.isStreaming
                  ? { kind: "waiting_model" }
                  : { kind: "running_command" }
                : { kind: "waiting_model" },
            );
            streamApi.dispatch({ type: "start" });
            void streamApi.connectEvents(session.id);
            if (streaming && !state?.isStreaming && state?.isPromptRunning) {
              void streamApi.waitForPromptSettlement(session.id);
            }
          }
        }
        if (agentState?.state) {
          if (agentState.state.isCompacting !== undefined)
            streamApi.setIsCompacting(agentState.state.isCompacting);
          if (agentState.state.contextUsage !== undefined)
            streamApi.setContextUsage(agentState.state.contextUsage ?? null);
          if (agentState.state.systemPrompt !== undefined)
            streamApi.setSystemPrompt(agentState.state.systemPrompt ?? null);
          if (agentState.state.thinkingLevel !== undefined)
            streamApi.setThinkingLevel(
              (agentState.state.thinkingLevel as ThinkingLevelOption) ?? "auto",
            );
          if (agentState.state.extensionStatuses !== undefined)
            streamApi.setExtensionStatuses(agentState.state.extensionStatuses ?? []);
          if (agentState.state.extensionWidgets !== undefined)
            streamApi.setExtensionWidgets(agentState.state.extensionWidgets ?? []);
          if (agentState.state.queuedMessages !== undefined)
            streamApi.setQueuedMessages(normalizeQueuedMessages(agentState.state.queuedMessages));
        }
      });
    }
    return () => {
      streamApi.mountedRef.current = false;
      // Cancel any pending SSE reconnect so it can't open a new EventSource on
      // an unmounted hook, and signal running=false so a timer that already
      // fired its callback guards out via agentRunningRef.
      streamApi.agentRunningRef.current = false;
      if (streamApi.reconnectTimerRef.current) {
        clearTimeout(streamApi.reconnectTimerRef.current);
        streamApi.reconnectTimerRef.current = null;
      }
      stream.eventSourceRef.current?.close();
      stream.eventSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modelsApi: SessionModelsApi = {
    loadTools,
    loadModels,
    setToolPresetState,
    handleModelChange,
    handleToolPresetChange,
    handleToolsChange,
    handleThinkingLevelChange,
  };

  const publicSlice = {
    modelNames,
    modelList,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    newSessionModel,
    toolPreset,
    tools,
    displayModel,
    isAutoModelSelection,
    loadTools,
  };

  return [publicSlice, modelsApi] as const;
}

export type SessionModelsSlice = ReturnType<typeof useSessionModels>[0];
