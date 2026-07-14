"use client";

import type {
  AgentMessage,
  ChatInputHandle,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionWidgetItem,
  SessionInfo,
  SessionTreeNode,
} from "@/lib/types";
import type { ContextUsage, SessionStatsInfo } from "@/lib/pi-types";

import { useSessionStream, type SessionStreamSlice } from "./useSessionStream";
import { useSessionModels, type SessionModelsSlice } from "./useSessionModels";
import { useSessionActions, type SessionActionsSlice } from "./useSessionActions";

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

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export interface LastAssistantTextResponse {
  text?: string;
}

export type AgentStateResponse = {
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

export type ExtensionUiDialogRequest = Extract<
  ExtensionUiRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;
export type ExtensionUiCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

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

// Re-export types that live in the helpers module so existing importers
// (`import { QueuedMessages } from "@/hooks/useAgentSession"`) keep compiling.
export type {
  QueuedMessages,
  NoticeType,
  NoticeItem,
  CompactResultInfo,
} from "@/lib/agent-session-helpers";

/**
 * Facade over the three session sub-hooks. Preserves the exact public
 * return shape (73 fields) so all ~28 call sites are untouched.
 *  - useSessionStream: SSE connect/reconnect/reconcile + event parsing + base state.
 *  - useSessionModels: model / thinking-level / tools selection.
 *  - useSessionActions: send / abort / fork / navigate / compact / slash + scroll.
 */
export function useAgentSession(opts: UseAgentSessionOptions) {
  const [streamSlice, streamApi] = useSessionStream(opts);
  const [modelsSlice, modelsApi] = useSessionModels(opts, streamApi, streamSlice);
  const [actionsSlice] = useSessionActions(opts, streamApi, streamSlice, modelsApi, modelsSlice);
  return { ...streamSlice, ...modelsSlice, ...actionsSlice };
}

export type UseAgentSessionReturn = SessionStreamSlice & SessionModelsSlice & SessionActionsSlice;
