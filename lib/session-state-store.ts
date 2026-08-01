// Sidecar state file for pi-web: tracks which sessions were recently active so
// they can be pre-warmed (re-loaded into the in-process registry) after a
// process restart. The message history itself is already persisted by the Pi
// SDK in .jsonl files — this sidecar only records the "which sessions are
// open + toolsDisabled flag" that lives purely in memory (globalThis).
//
// Location: <agentDir>/pi-web-state.json (alongside sessions/).

import { writeFileSync, readFileSync, existsSync, renameSync } from "fs";
import { join, isAbsolute } from "path";
import { getAgentDir } from "./config-file.ts";

const STATE_FILE = "pi-web-state.json";
const MAX_ENTRIES = 20;

export interface ActiveSessionEntry {
  sessionId: string;
  lastActive: number;
  toolsDisabled: boolean;
}

export interface PinnedDir {
  path: string;
  alias?: string;
  pinnedAt: number;
}

export interface PiWebState {
  version: 2;
  activeSessions: ActiveSessionEntry[];
  pinnedDirs: PinnedDir[];
}

function stateFilePath(): string {
  return join(getAgentDir(), STATE_FILE);
}

function emptyState(): PiWebState {
  return { version: 2, activeSessions: [], pinnedDirs: [] };
}

/** Read the sidecar state. Returns an empty structure if the file is missing or corrupt. */
export function loadSessionState(): PiWebState {
  try {
    const file = stateFilePath();
    if (!existsSync(file)) return emptyState();
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      activeSessions?: unknown;
      pinnedDirs?: unknown;
    };
    // Accept both v1 (no pinnedDirs) and v2 (with pinnedDirs); upgrade v1 in place.
    if (parsed.version !== 1 && parsed.version !== 2) {
      return emptyState();
    }
    if (!Array.isArray(parsed.activeSessions)) {
      return emptyState();
    }
    // Upgrade v1 → v2 by adding an empty pinnedDirs array.
    const pinnedDirs =
      parsed.version === 2 && Array.isArray(parsed.pinnedDirs)
        ? (parsed.pinnedDirs as unknown[]).filter(isValidPinnedDir)
        : [];
    return {
      version: 2,
      activeSessions: (parsed.activeSessions as unknown[]).filter(isValidEntry),
      pinnedDirs,
    };
  } catch {
    return emptyState();
  }
}

/**
 * 校验路径为安全的绝对路径：非空、无 NUL、平台绝对、且不含有 `..` 段
 * （防止路径穿越越过被固定的根目录）。
 */
function isSafeAbsolutePath(p: unknown): p is string {
  if (typeof p !== "string" || p.length === 0) return false;
  if (/[\0]/.test(p)) return false;
  if (!isAbsolute(p)) return false;
  if (p.split(/[\\/]/).includes("..")) return false;
  return true;
}

export function isValidEntry(e: unknown): e is ActiveSessionEntry {
  if (typeof e !== "object" || e === null) return false;
  const obj = e as Record<string, unknown>;
  // sessionId 后续用于拼接会话文件路径，拒绝任何可穿越 / 破坏路径连接的字符。
  if (typeof obj.sessionId !== "string" || !obj.sessionId) return false;
  if (/[\/\\]|\.\.|\0|\s/.test(obj.sessionId as string)) return false;
  return typeof obj.lastActive === "number" && typeof obj.toolsDisabled === "boolean";
}

export function isValidPinnedDir(e: unknown): e is PinnedDir {
  if (typeof e !== "object" || e === null) return false;
  const obj = e as Record<string, unknown>;
  if (!isSafeAbsolutePath(obj.path)) return false;
  return (
    typeof obj.pinnedAt === "number" && (obj.alias === undefined || typeof obj.alias === "string")
  );
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

// ---------------------------------------------------------------------------
// Pinned directories
// ---------------------------------------------------------------------------

/** Return the list of pinned directories (path + optional alias). */
export function getPinnedDirs(): PinnedDir[] {
  return loadSessionState().pinnedDirs;
}

/**
 * Pin a directory. If `path` is already pinned, its alias is updated.
 * `alias` is trimmed; an empty alias is stored as undefined.
 * No-op (returns a synthetic entry without persisting) if path is empty.
 */
export function addPinnedDir(path: string, alias?: string): PinnedDir {
  const trimmedAlias = alias?.trim();
  // 防御：拒绝相对 / 穿越路径，绝不持久化到 sidecar。
  if (!isSafeAbsolutePath(path)) {
    return { path, alias: trimmedAlias || undefined, pinnedAt: Date.now() };
  }
  const state = loadSessionState();
  const now = Date.now();
  const existing = state.pinnedDirs.find((d) => d.path === path);
  if (existing) {
    existing.alias = trimmedAlias || undefined;
    existing.pinnedAt = now;
  } else {
    state.pinnedDirs.push({ path, alias: trimmedAlias || undefined, pinnedAt: now });
  }
  saveSessionState(state);
  return { path, alias: trimmedAlias || undefined, pinnedAt: now };
}

/** Remove a pinned directory by path. Returns true if something was removed. */
export function removePinnedDir(path: string): boolean {
  const state = loadSessionState();
  const before = state.pinnedDirs.length;
  state.pinnedDirs = state.pinnedDirs.filter((d) => d.path !== path);
  const changed = state.pinnedDirs.length !== before;
  if (changed) saveSessionState(state);
  return changed;
}
