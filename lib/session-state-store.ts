// Sidecar state file for pi-web: tracks which sessions were recently active so
// they can be pre-warmed (re-loaded into the in-process registry) after a
// process restart. The message history itself is already persisted by the Pi
// SDK in .jsonl files — this sidecar only records the "which sessions are
// open + toolsDisabled flag" that lives purely in memory (globalThis).
//
// Location: <agentDir>/pi-web-state.json (alongside sessions/).

import { writeFileSync, readFileSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const STATE_FILE = "pi-web-state.json";
const MAX_ENTRIES = 20;

/** Resolve the pi agent directory (inlined to avoid importing session-reader → pi SDK in tests). */
function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export interface ActiveSessionEntry {
  sessionId: string;
  lastActive: number;
  toolsDisabled: boolean;
}

export interface PiWebState {
  version: 1;
  activeSessions: ActiveSessionEntry[];
}

function stateFilePath(): string {
  return join(getAgentDir(), STATE_FILE);
}

function emptyState(): PiWebState {
  return { version: 1, activeSessions: [] };
}

/** Read the sidecar state. Returns an empty structure if the file is missing or corrupt. */
export function loadSessionState(): PiWebState {
  try {
    const file = stateFilePath();
    if (!existsSync(file)) return emptyState();
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<PiWebState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.activeSessions)) {
      return emptyState();
    }
    return { version: 1, activeSessions: parsed.activeSessions.filter(isValidEntry) };
  } catch {
    return emptyState();
  }
}

function isValidEntry(e: unknown): e is ActiveSessionEntry {
  if (typeof e !== "object" || e === null) return false;
  const obj = e as Record<string, unknown>;
  return typeof obj.sessionId === "string"
    && typeof obj.lastActive === "number"
    && typeof obj.toolsDisabled === "boolean";
}

/** Atomically write the sidecar (write .tmp then rename to avoid corruption on crash). */
export function saveSessionState(state: PiWebState): void {
  try {
    const file = stateFilePath();
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    renameSync(tmp, file);
  } catch {
    // Non-fatal: persistence is best-effort. If we can't write (read-only fs,
    // permissions), the app still works — it just won't pre-warm on restart.
  }
}

/**
 * Record (or refresh) a session as active. Keeps at most MAX_ENTRIES most-recent
 * entries. Writes synchronously because this is called infrequently (on session
 * start / message send) and the cost of losing the write on crash is low.
 */
export function recordActiveSession(sessionId: string, toolsDisabled: boolean): void {
  if (!sessionId) return;
  const state = loadSessionState();
  const now = Date.now();

  // Remove existing entry for this session (if any), then prepend the updated one.
  const filtered = state.activeSessions.filter((e) => e.sessionId !== sessionId);
  filtered.unshift({ sessionId, lastActive: now, toolsDisabled });
  state.activeSessions = filtered.slice(0, MAX_ENTRIES);

  saveSessionState(state);
}

/** Remove entries whose sessionId is not in validIds (e.g. sessions deleted from disk). */
export function pruneStaleSessions(validIds: Set<string>): void {
  const state = loadSessionState();
  const before = state.activeSessions.length;
  state.activeSessions = state.activeSessions.filter((e) => validIds.has(e.sessionId));
  if (state.activeSessions.length !== before) {
    saveSessionState(state);
  }
}
