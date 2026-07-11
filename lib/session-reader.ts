import type { AgentMessage, SessionEntry, SessionInfo, SessionContext } from "./types";
import type { PiSessionEntry, PiSessionInfo } from "./pi";
import { getPiAdapter } from "./pi";
import { normalizeToolCalls } from "./normalize";
import { resolveProject, type ProjectInfo } from "./worktree";

export function getAgentDir(): string {
  return getPiAdapter().agentDir;
}

export async function listAllSessions(): Promise<SessionInfo[]> {
  const piSessions: PiSessionInfo[] = await getPiAdapter().SessionManager.listAll();
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(s.path, s.id);

  // Resolve each unique cwd to its project root (main repo shared by all
  // worktrees). resolveProject caches per-cwd, so this is cheap after warmup.
  const uniqueCwds = [...new Set(piSessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(
    uniqueCwds.map(async (cwd) => {
      projectByCwd.set(cwd, await resolveProject(cwd));
    }),
  );

  const cache = getPathCache();
  const ttl = Date.now() + PATH_CACHE_TTL_MS;
  return piSessions.map((s) => {
    // Populate path cache so resolveSessionPath works without a full scan
    cache.set(s.id, { path: s.path, expiresAt: ttl });
    const project = s.cwd ? projectByCwd.get(s.cwd) : undefined;
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: s.parentSessionPath ? pathToId.get(s.parentSessionPath) : undefined,
      projectRoot: project?.projectRoot ?? s.cwd,
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

// ============================================================================
// Session path cache: sessionId → absolute file path
// Stored in globalThis for hot-reload safety. Entries expire after PATH_CACHE_TTL_MS
// so a session file created/moved on disk is discovered without a full restart.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, { path: string; expiresAt: number }> | undefined;
}

const PATH_CACHE_TTL_MS = 60_000;

function getPathCache(): Map<string, { path: string; expiresAt: number }> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cache = getPathCache();
  const entry = cache.get(sessionId);
  if (entry) {
    if (Date.now() < entry.expiresAt) return entry.path;
    cache.delete(sessionId); // expired — treat as a miss
  }

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  const repopulated = cache.get(sessionId);
  return repopulated ? repopulated.path : null;
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  getPathCache().set(sessionId, { path: filePath, expiresAt: Date.now() + PATH_CACHE_TTL_MS });
}

export function invalidateSessionPathCache(sessionId: string): void {
  getPathCache().delete(sessionId);
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  return getPiAdapter().SessionManager.open(filePath).getEntries() as unknown as SessionEntry[];
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = getPiAdapter().buildSessionContext(
    piEntries,
    leafId,
    byId as unknown as Map<string, PiSessionEntry>,
  ) as SessionContext;

  // Build entryIds: parallel array to messages[], mapping each message back to its entry id.
  // Needed for fork and navigate_tree calls from the UI.
  let targetLeaf: SessionEntry | undefined;
  if (leafId === null) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }
  if (leafId) targetLeaf = byId.get(leafId);
  if (!targetLeaf) targetLeaf = entries[entries.length - 1];
  if (!targetLeaf) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }

  // Walk path from target leaf to root
  const path: SessionEntry[] = [];
  let cur: SessionEntry | undefined = targetLeaf;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  // Build UI history from the FULL branch path (root to leaf), without trimming.
  // pi's buildSessionContext targets LLM context: it drops everything before the last
  // compaction's firstKeptEntryId. Correct for the model, but it would hide compacted
  // history from the UI. We keep piCtx only for thinkingLevel/model, and render every
  // displayable entry on the path ourselves; compaction/branch_summary entries become
  // inline summary messages so the user still sees where context was compressed.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const e of path) {
    const m = entryToUiMessage(e);
    if (m) {
      messages.push(m);
      entryIds.push(e.id);
    }
  }

  return {
    messages,
    entryIds,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
  };
}

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
function entryToUiMessage(entry: SessionEntry): AgentMessage | null {
  switch (entry.type) {
    case "message":
      return normalizeToolCalls(entry.message);
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: entry.summary,
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    default:
      return null;
  }
}
