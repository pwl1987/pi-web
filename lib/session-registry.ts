// Session registry + running-status broadcaster.
//
// Extracted from rpc-manager.ts so it can be unit-tested without importing the
// pi SDK (which requires jiti and can't run under bare node:test).
// The registry stores objects implementing SessionHandle (a minimal interface
// that AgentSessionWrapper satisfies structurally).

/** Minimal interface for objects stored in the registry. */
export interface SessionHandle {
  readonly sessionId: string;
  isRunning(): boolean;
  isAlive(): boolean;
  destroy(): void;
}

declare global {
  var __piSessions: Map<string, SessionHandle> | undefined;
  var __piStartLocks:
    Map<string, Promise<{ session: SessionHandle; realSessionId: string }>> | undefined;
  var __piRunningListeners: Set<(ids: string[]) => void> | undefined;
}

export function getRegistry(): Map<string, SessionHandle> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
  }
  return globalThis.__piSessions;
}

export function getLocks(): Map<
  string,
  Promise<{ session: SessionHandle; realSessionId: string }>
> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export function getRpcSession(sessionId: string): SessionHandle | undefined {
  return getRegistry().get(sessionId);
}

export function getRunningRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return [...ids];
}

// Running-status broadcaster — pushes the current set of running session ids
// to subscribers whenever the set changes. Listeners live on globalThis so
// they survive Next.js hot-reload.

function getRunningListeners(): Set<(ids: string[]) => void> {
  if (!globalThis.__piRunningListeners) globalThis.__piRunningListeners = new Set();
  return globalThis.__piRunningListeners;
}

export function subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
  const listeners = getRunningListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let lastRunningSnapshot = "";

/**
 * Recompute the running-session-id set and, if it changed since the last
 * notification, broadcast it to subscribers. Cheap to call often.
 */
export function notifyRunningChange(): void {
  const ids = getRunningRpcSessionIds();
  const snapshot = JSON.stringify([...ids].sort());
  if (snapshot === lastRunningSnapshot) return;
  lastRunningSnapshot = snapshot;
  for (const listener of getRunningListeners()) {
    try {
      listener(ids);
    } catch {
      /* ignore listener errors */
    }
  }
}

/** Reset snapshot cache (for testing). */
export function _resetRunningSnapshot(): void {
  lastRunningSnapshot = "";
}
