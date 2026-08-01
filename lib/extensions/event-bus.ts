// Agent event bus — a lightweight pub/sub for agent lifecycle events.
//
// Extensions subscribe via their activation context (context.eventBus) to react
// to tool calls, messages, and agent start/end in real-time. useAgentSession
// emits events from its handleAgentEvent SSE dispatcher.
//
// globalThis singleton (mirrors registry.ts / agent-runtime-store.ts) so it
// survives hot-reload and is accessible from anywhere in the client.

export type AgentEventType =
  | "agent_start"
  | "agent_end"
  | "tool_execution_start"
  | "tool_execution_end"
  | "message_end"
  | "compaction_start"
  | "compaction_end";

export interface AgentEventPayload {
  type: AgentEventType;
  sessionId?: string;
  /** Tool name — present for tool_execution_* events. */
  toolName?: string;
  /** Tool call id — present for tool_execution_* events. */
  toolCallId?: string;
  /** Message role (user/assistant/toolResult) — present for message_end. */
  role?: string;
  /** Whether a compaction was aborted — present for compaction_end. */
  aborted?: boolean;
  timestamp: number;
}

type EventListener = (event: AgentEventPayload) => void;

export class AgentEventBus {
  private listeners = new Map<AgentEventType, Set<EventListener>>();

  /** Subscribe to a specific event type. Returns an unsubscribe function. */
  subscribe(type: AgentEventType, cb: EventListener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
    const captured = set;
    return () => {
      captured.delete(cb);
    };
  }

  /** Emit an event to all subscribers of its type. */
  emit(event: AgentEventPayload): void {
    const set = this.listeners.get(event.type);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(event);
      } catch {
        /* listener errors are non-fatal */
      }
    }
  }
}

declare global {
  var __piWebAgentEventBus: AgentEventBus | undefined;
}

export function getAgentEventBus(): AgentEventBus {
  if (!globalThis.__piWebAgentEventBus) {
    globalThis.__piWebAgentEventBus = new AgentEventBus();
  }
  return globalThis.__piWebAgentEventBus;
}
