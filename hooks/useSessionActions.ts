"use client";

import { useState, useCallback, useEffect } from "react";
import type { AgentMessage, AttachedImage, SessionInfo } from "@/lib/types";
import { sendAgentCommand } from "@/lib/agent-client";
import {
  readCompactResult,
  userMessageKey,
  type CompactCommandResult,
} from "@/lib/agent-session-helpers";
import type { LastAssistantTextResponse } from "./useAgentSession";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type {
  UseAgentSessionOptions,
  AgentStateResponse,
  SlashCommandInfo,
  BuiltinSlashCommandResult,
  ThinkingLevelOption,
} from "./useAgentSession";
import type { SessionStreamApi, SessionStreamSlice } from "./useSessionStream";
import type { SessionModelsApi, SessionModelsSlice } from "./useSessionModels";

const PROGRAMMATIC_SCROLL_IGNORE_MS = 700;
const USER_SCROLL_INTENT_MS = 1200;
/** Distance from the bottom (px) within which we consider the view "at bottom". */
const BOTTOM_DISTANCE_PX = 80;
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

export type SessionActionsApi = Record<string, never>;

export function useSessionActions(
  opts: UseAgentSessionOptions,
  streamApi: SessionStreamApi,
  stream: SessionStreamSlice,
  modelsApi: SessionModelsApi,
  models: SessionModelsSlice,
) {
  const { session, newSessionCwd, onSessionForked, onSessionStatsPanelOpen, pluginsRefreshKey } =
    opts;

  const handleSend = useCallback(
    async (message: string, images?: AttachedImage[]) => {
      const trimmedMessage = message.trim();
      if (!trimmedMessage && !images?.length) return;
      if (stream.agentRunning) return;
      const isSlashCommandPrompt = !images?.length && trimmedMessage.startsWith("/");
      const promptRunId = streamApi.promptRunIdRef.current + 1;

      const imageBlocks = images?.map((img) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: img.mimeType, data: img.data },
      }));
      const userMsg: AgentMessage = {
        role: "user",
        content: imageBlocks?.length
          ? [
              ...(message.trim() ? [{ type: "text" as const, text: message }] : []),
              ...(imageBlocks ?? []),
            ]
          : message,
        timestamp: Date.now(),
      };
      stream.setMessages((prev) => [...prev, userMsg]);
      streamApi.optimisticUserMessageKeyRef.current = userMessageKey(userMsg);
      streamApi.promptRunIdRef.current = promptRunId;
      streamApi.agentRunningRef.current = true;
      streamApi.setAgentRunning(true);
      streamApi.setAgentPhase(
        isSlashCommandPrompt ? { kind: "running_command" } : { kind: "waiting_model" },
      );
      streamApi.dispatch({ type: "start" });
      stream.pendingScrollToUserRef.current = true;
      streamApi.completionScrollAllowedRef.current = true;

      const piImages = images?.map((img) => ({
        type: "image" as const,
        data: img.data,
        mimeType: img.mimeType,
      }));

      try {
        let sentSessionId: string | null = null;
        if (stream.isNew && newSessionCwd) {
          const selectedModel = models.newSessionModel;
          const existingSid =
            stream.sessionIdRef.current ?? (await streamApi.ensuringNewSessionRef.current);
          const sid = existingSid ?? (await streamApi.ensureNewSession());
          if (sid) {
            sentSessionId = sid;
            if (selectedModel) {
              streamApi.setPendingModel(selectedModel);
              if (existingSid) {
                await sendAgentCommand(sid, {
                  type: "set_model",
                  provider: selectedModel.provider,
                  modelId: selectedModel.modelId,
                });
              }
            }
            await streamApi.ensureEventsConnected(sid);
            await sendAgentCommand(sid, {
              type: "prompt",
              message,
              ...(piImages?.length ? { images: piImages } : {}),
            });
            streamApi.promoteNewSession(1, message);
          }
        } else if (session) {
          sentSessionId = session.id;
          await streamApi.ensureEventsConnected(session.id);
          await sendAgentCommand(session.id, {
            type: "prompt",
            message,
            ...(piImages?.length ? { images: piImages } : {}),
          });
        }
        if (isSlashCommandPrompt && sentSessionId) {
          void streamApi.waitForPromptSettlement(sentSessionId, promptRunId);
        }
      } catch (e) {
        console.error("Failed to send message:", e);
        if (e instanceof Error && e.name === "EventStreamConnectionError") {
          const optimisticKey = streamApi.optimisticUserMessageKeyRef.current;
          if (optimisticKey) {
            stream.setMessages((prev) => {
              const last = prev[prev.length - 1];
              return last?.role === "user" && userMessageKey(last) === optimisticKey
                ? prev.slice(0, -1)
                : prev;
            });
          }
          streamApi.addNotice({ type: "error", message: e.message });
        }
        streamApi.optimisticUserMessageKeyRef.current = null;
        streamApi.agentRunningRef.current = false;
        streamApi.setAgentRunning(false);
        streamApi.setAgentPhase(null);
        streamApi.dispatch({ type: "end" });
      }
    },
    [
      stream.isNew,
      newSessionCwd,
      models.newSessionModel,
      session,
      stream.agentRunning,
      streamApi.ensureNewSession,
      streamApi.ensureEventsConnected,
      streamApi.promoteNewSession,
      streamApi.waitForPromptSettlement,
      streamApi.addNotice,
    ],
  );

  const handleAbort = useCallback(async () => {
    const sid = stream.sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, [stream.sessionIdRef]);

  const handleFork = useCallback(
    async (entryId: string) => {
      const sid = stream.sessionIdRef.current;
      if (!sid) return;
      stream.setForkingEntryId(entryId);
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
        stream.setForkingEntryId(null);
      }
    },
    [stream.sessionIdRef, onSessionForked],
  );

  const handleNavigate = useCallback(
    async (entryId: string) => {
      const sid = stream.sessionIdRef.current;
      if (!sid) return;
      sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId }).catch(() => {});
      stream.setActiveLeafId(entryId);
      await streamApi.loadContext(sid, entryId);
    },
    [streamApi.loadContext, stream.sessionIdRef],
  );

  const handleLeafChange = useCallback(
    async (leafId: string | null) => {
      stream.setActiveLeafId(leafId);
      const sid = stream.sessionIdRef.current;
      if (!sid) return;
      await streamApi.loadContext(sid, leafId);
      if (leafId) {
        sendAgentCommand(sid, { type: "navigate_tree", targetId: leafId }).catch(() => {});
      }
    },
    [streamApi.loadContext, stream.sessionIdRef],
  );

  const handleCompact = useCallback(async () => {
    const sid = stream.sessionIdRef.current;
    if (!sid || stream.isCompacting) return;
    streamApi.setIsCompacting(true);
    streamApi.setCompactError(null);
    streamApi.setCompactResult(null);
    try {
      const result = await sendAgentCommand<CompactCommandResult>(sid, { type: "compact" });
      streamApi.setCompactResult(readCompactResult(result, "manual"));
      await streamApi.loadSession(sid, true);
    } catch (e) {
      let errorMessage = e instanceof Error ? e.message : String(e);
      // Improve error messages for common compact failures
      if (errorMessage.includes("model_context") || errorMessage.includes("finish_reason")) {
        errorMessage = "压缩失败：模型上下文超出上限，请尝试切换到上下文窗口更大的模型。";
      } else if (errorMessage.includes("Summarization failed")) {
        errorMessage = "压缩失败：无法生成摘要，当前模型可能无法处理过大的会话。";
      }
      streamApi.setCompactError(errorMessage);
      streamApi.setCompactResult(null);
    } finally {
      streamApi.setIsCompacting(false);
    }
  }, [stream.isCompacting, streamApi.loadSession, stream.sessionIdRef]);

  const handleBuiltinSlashCommand = useCallback(
    async (text: string): Promise<BuiltinSlashCommandResult> => {
      if (!text.startsWith("/")) return { handled: false };
      const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
      if (!match) return { handled: false };

      const [, commandName, rawArgs = ""] = match;
      const args = rawArgs.trim();
      const sid = stream.sessionIdRef.current ?? (await streamApi.ensureNewSession());
      const complete = (result: BuiltinSlashCommandResult): BuiltinSlashCommandResult => {
        if (!result.handled) return result;
        if (result.error) {
          streamApi.addNotice({ type: "error", message: result.error });
        } else if (result.action !== "openSessionStats") {
          streamApi.addNotice({ type: "success", message: result.message ?? "命令已完成" });
        }
        return result;
      };

      try {
        switch (commandName) {
          case "compact": {
            if (!sid || stream.isCompacting)
              return complete({ handled: true, error: "没有可压缩的活动会话" });
            streamApi.setIsCompacting(true);
            streamApi.setCompactError(null);
            streamApi.setCompactResult(null);
            try {
              const result = await sendAgentCommand<CompactCommandResult>(sid, {
                type: "compact",
                ...(args ? { customInstructions: args } : {}),
              });
              streamApi.setCompactResult(readCompactResult(result, "manual"));
              if (await streamApi.loadSession(sid, true)) streamApi.promoteNewSession();
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
              streamApi.setCompactError(errorMessage);
              return complete({ handled: true, error: errorMessage });
            }
          }

          case "reload": {
            if (!sid) return complete({ handled: true, error: "没有可重新加载的活动会话" });
            await sendAgentCommand(sid, { type: "reload" });
            await Promise.all([
              streamApi.loadSession(sid, false, true),
              modelsApi.loadTools(sid),
              streamApi.loadSlashCommands(),
              modelsApi.loadModels(),
            ]);
            return complete({ handled: true, message: "Reloaded session resources" });
          }

          case "name": {
            if (!sid) return complete({ handled: true, error: "没有可命名的活动会话" });
            if (!args) return complete({ handled: true, error: "用法：/name <名称>" });
            await sendAgentCommand(sid, { type: "set_session_name", name: args });
            if (await streamApi.loadSession(sid)) streamApi.promoteNewSession();
            return complete({ handled: true, message: `Session renamed to ${args}` });
          }

          case "session": {
            if (!sid) return complete({ handled: true, error: "没有活动会话" });
            const stats = await sendAgentCommand<SessionStatsInfo>(sid, {
              type: "get_session_stats",
            });
            if (stats) {
              streamApi.setSessionStatsOverride(stats);
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
        if (commandName === "compact") streamApi.setIsCompacting(false);
      }
    },
    [
      streamApi.addNotice,
      streamApi.ensureNewSession,
      stream.isCompacting,
      modelsApi.loadModels,
      streamApi.loadSession,
      streamApi.loadSlashCommands,
      modelsApi.loadTools,
      streamApi.promoteNewSession,
      onSessionStatsPanelOpen,
      stream.sessionIdRef,
    ],
  );

  // Queued (undelivered) messages live in the queue panel only; the chat gets
  // the real user message when pi delivers it (user message_end event). An
  // optimistic chat bubble here would duplicate the queue panel and turn into
  // a ghost message if the queue is recalled.
  const handleSteer = useCallback(
    async (message: string, images?: AttachedImage[]) => {
      const sid = stream.sessionIdRef.current;
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
    },
    [stream.sessionIdRef],
  );

  const handlePromptWithStreamingBehavior = useCallback(
    async (message: string, behavior: "steer" | "followUp", images?: AttachedImage[]) => {
      const sid = stream.sessionIdRef.current;
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
    [stream.sessionIdRef],
  );

  const handleFollowUp = useCallback(
    async (message: string, images?: AttachedImage[]) => {
      const sid = stream.sessionIdRef.current;
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
    },
    [stream.sessionIdRef],
  );

  const handleAbortCompaction = useCallback(async () => {
    const sid = stream.sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, [stream.sessionIdRef]);

  const handleRecallQueue = useCallback(async () => {
    const sid = stream.sessionIdRef.current;
    if (!sid) return;
    try {
      const result = await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, {
        type: "clear_queue",
      });
      // clearQueue also emits an empty queue_update, but that only reaches us
      // while SSE is connected — clear locally so idle recalls update the UI.
      streamApi.setQueuedMessages({ steering: [], followUp: [] });
      const texts = [...(result?.steering ?? []), ...(result?.followUp ?? [])];
      if (texts.length > 0) {
        opts.chatInputRef?.current?.prependText(texts.join("\n\n"));
      }
    } catch (e) {
      console.error("Failed to recall queued messages:", e);
      streamApi.addNotice({ type: "error", message: "撤回排队消息失败" });
    }
  }, [opts.chatInputRef, streamApi.addNotice, stream.sessionIdRef]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      streamApi.ignoreProgrammaticScrollUntilRef.current =
        Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
      stream.messagesEndRef.current?.scrollIntoView({ behavior });
    },
    [stream.messagesEndRef],
  );

  const scrollUserMsgToTop = useCallback(() => {
    const container = stream.scrollContainerRef.current;
    const el = stream.lastUserMsgRef.current;
    if (!container || !el) return;
    const elAbsTop =
      el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    streamApi.ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    container.scrollTo({ top: elAbsTop - 16, behavior: "smooth" });
  }, [stream.scrollContainerRef, stream.lastUserMsgRef]);

  const markUserScrollIntent = useCallback(
    (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (!SCROLL_KEYS.has(event.key)) return;
        if (
          event.target instanceof Element &&
          event.target.closest("input, textarea, [contenteditable='true']")
        )
          return;
      }
      streamApi.userScrollIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
    },
    [streamApi.userScrollIntentUntilRef],
  );

  const handleScrollPositionChange = useCallback(() => {
    // Track whether the viewport is pinned near the bottom — always, regardless
    // of agent running state, so the floating "scroll to bottom" button shows.
    const container = stream.scrollContainerRef.current;
    if (container) {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      streamApi.setIsAtBottom(distance < BOTTOM_DISTANCE_PX);
    }
    // Suppress completion auto-scroll only when the user actively scrolled away
    // during a run.
    if (!streamApi.agentRunningRef.current) return;
    if (Date.now() < streamApi.ignoreProgrammaticScrollUntilRef.current) return;
    if (Date.now() > streamApi.userScrollIntentUntilRef.current) return;
    streamApi.completionScrollAllowedRef.current = false;
  }, [stream.scrollContainerRef, streamApi.agentRunningRef, streamApi]);

  // Manual "scroll to bottom" invoked by the floating button: jumps to the
  // bottom and re-enables completion auto-scroll so future runs follow.
  const scrollToBottomAction = useCallback(() => {
    streamApi.completionScrollAllowedRef.current = true;
    scrollToBottom("smooth");
    streamApi.setIsAtBottom(true);
  }, [scrollToBottom, streamApi]);

  const reloadSession = useCallback(async () => {
    if (stream.sessionIdRef.current) {
      await streamApi.loadSession(stream.sessionIdRef.current, true);
    }
  }, [streamApi.loadSession, stream.sessionIdRef]);

  // onBranchDataChange effect
  useEffect(() => {
    if (!opts.onBranchDataChange) return;
    opts.onBranchDataChange(stream.data?.tree ?? [], stream.activeLeafId, handleLeafChange);
  }, [stream.data, stream.activeLeafId, handleLeafChange, opts.onBranchDataChange]);

  useEffect(() => {
    window.addEventListener("keydown", markUserScrollIntent);
    window.addEventListener("pointerdown", markUserScrollIntent, { passive: true });
    return () => {
      window.removeEventListener("keydown", markUserScrollIntent);
      window.removeEventListener("pointerdown", markUserScrollIntent);
    };
  }, [markUserScrollIntent]);

  useEffect(() => {
    const container = stream.scrollContainerRef.current;
    if (!container) return;
    container.addEventListener("wheel", markUserScrollIntent, { passive: true });
    container.addEventListener("touchstart", markUserScrollIntent, { passive: true });
    container.addEventListener("scroll", handleScrollPositionChange, { passive: true });
    return () => {
      container.removeEventListener("wheel", markUserScrollIntent);
      container.removeEventListener("touchstart", markUserScrollIntent);
      container.removeEventListener("scroll", handleScrollPositionChange);
    };
  }, [stream.messages.length, stream.loading, handleScrollPositionChange, markUserScrollIntent]);

  useEffect(() => {
    if (stream.messages.length > 0) {
      if (stream.pendingScrollToUserRef.current) {
        stream.pendingScrollToUserRef.current = false;
        stream.initialScrollDoneRef.current = true;
        scrollUserMsgToTop();
      } else if (!stream.initialScrollDoneRef.current) {
        stream.initialScrollDoneRef.current = true;
        scrollToBottom("instant");
      } else if (
        !streamApi.agentRunningRef.current &&
        streamApi.completionScrollAllowedRef.current
      ) {
        scrollToBottom("smooth");
      }
    }
  }, [stream.messages.length, stream.agentRunning, scrollToBottom, scrollUserMsgToTop]);

  // Re-fetch tool list when plugins are reloaded. Mirrors the
  // modelsRefreshKey pattern: a counter bump from AppShell triggers a
  // lightweight in-place refresh instead of a full ChatWindow remount.
  useEffect(() => {
    const sid = stream.sessionIdRef.current;
    if (!sid) return;
    void modelsApi.loadTools(sid).catch((e) => {
      console.error("Failed to refresh tools after plugin reload:", e);
    });
  }, [modelsApi.loadTools, pluginsRefreshKey, stream.sessionIdRef]);

  const publicSlice = {
    // Actions
    handleSend,
    handleAbort,
    handleFork,
    handleNavigate,
    handleModelChange: modelsApi.handleModelChange,
    handleCompact,
    handleSteer,
    handleFollowUp,
    handlePromptWithStreamingBehavior,
    handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    reloadSession,
    handleToolPresetChange: modelsApi.handleToolPresetChange,
    handleToolsChange: modelsApi.handleToolsChange,
    handleThinkingLevelChange: modelsApi.handleThinkingLevelChange,
    // Scroll-to-bottom
    isAtBottom: stream.isAtBottom,
    scrollToBottomAction,
  };

  return [publicSlice, {}] as const;
}

export type SessionActionsSlice = ReturnType<typeof useSessionActions>[0];
