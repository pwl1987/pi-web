// ============================================================================
// Business service facade — session operations
// ============================================================================
//
// High-level session operations consumed by the `/api/agent/*` routes. This is
// the "port" the API layer depends on: it reaches Pi only through the ACL
// (`getPiAdapter`) and the existing `rpc-manager` / `session-reader`, never
// importing the SDK directly. Routes become thin HTTP adapters.

import { startRpcSession, getRpcSession, type AgentSessionWrapper } from "../rpc-manager";
import { resolveSessionPath } from "../session-reader";
import { getPiAdapter } from "../pi";

export interface EnsureSessionResult {
  session: AgentSessionWrapper;
  realSessionId: string;
}

/** Get-or-create the runtime wrapper for a session. */
export async function ensureSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[],
): Promise<EnsureSessionResult> {
  return startRpcSession(sessionId, sessionFile, cwd, toolNames);
}

/** Get an already-running wrapper, if alive. */
export function getSession(id: string): AgentSessionWrapper | undefined {
  return getRpcSession(id);
}

/** Read the `cwd` recorded in a session file's header. */
export function readSessionCwd(filePath: string): string {
  return getPiAdapter().sessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
}

/** Resolve a session id to its cwd (falls back to process.cwd()). */
export async function resolveSessionCwd(id: string): Promise<string> {
  const filePath = await resolveSessionPath(id);
  if (!filePath) return process.cwd();
  return readSessionCwd(filePath);
}
