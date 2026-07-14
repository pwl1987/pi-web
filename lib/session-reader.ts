import { statSync } from "fs";
import type { AgentMessage, SessionEntry, SessionInfo, SessionContext } from "./types";
import type { PiSessionEntry, PiSessionInfo } from "./pi";
import { getPiAdapter } from "./pi";
import { normalizeToolCalls } from "./normalize";
import { resolveProject, type ProjectInfo } from "./worktree";

export function getAgentDir(): string {
  return getPiAdapter().agentDir;
}

export async function listAllSessions(): Promise<SessionInfo[]> {
  // In-flight 锁：并发调用方（同请求二次扫描、或并行请求）共享同一次
  // 底层扫描，而非各自触发一次全量 listAll。Promise settle 后清除。
  if (globalThis.__piListAllPromise) return globalThis.__piListAllPromise;
  const run = async (): Promise<SessionInfo[]> => {
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
        // ponytail: 识别 plan-mode 注入的 marker `orchestrator:<orchId>`，归一化为
        // orchestratorParentId 供 SessionSidebar 子树渲染。普通 fork 不走此分支
        // (pathToId 已把 pi session 路径解析为 id，marker 不会出现在 byId 中)。
        orchestratorParentId: (() => {
          const p = s.parentSessionPath;
          if (!p) return undefined;
          const m = /^orchestrator:([\w-]+)$/.exec(p);
          return m ? m[1] : undefined;
        })(),
        // 同源推断 isPlanMode：SessionItem 据此渲染固定 plan 角标，不依赖 name 前缀。
        isPlanMode: /^orchestrator:[\w-]+$/.test(s.parentSessionPath ?? ""),
        projectRoot: project?.projectRoot ?? s.cwd,
        ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
      };
    });
  };
  const promise = run().finally(() => {
    globalThis.__piListAllPromise = undefined;
  });
  globalThis.__piListAllPromise = promise;
  return promise;
}

// ============================================================================
// Session path cache: sessionId → absolute file path
// Stored in globalThis for hot-reload safety. Entries expire after PATH_CACHE_TTL_MS
// so a session file created/moved on disk is discovered without a full restart.
// ============================================================================
const PATH_CACHE_TTL_MS = 60_000;

// ===========================================================================
// Session data cache: filePath → 完整会话快照，以文件 mtime 校验。
// 存于 globalThis 以兼容热重载。命中 mtime 时跳过整文件
// readFileSync + JSONL 解析 + tree 构建，消除每次切 leaf / 刷新 / 并发
// 请求都全量重读的开销。LRU 上限防止长进程内存只增不减。
// ===========================================================================
const CACHE_MAX = 200;

interface CachedSessionSnapshot {
  mtimeMs: number;
  entries: SessionEntry[];
  header: Record<string, unknown> | null;
  leafId: string | null;
  tree: unknown[];
  sessionName: string;
}

declare global {
  var __piSessionPathCache: Map<string, { path: string; expiresAt: number }> | undefined;
  /** 完整会话快照缓存（mtime LRU）：filePath → entries + header + leafId + tree + name */
  var __piSessionDataCache: Map<string, CachedSessionSnapshot> | undefined;
  /** @deprecated 已迁移至 __piSessionDataCache；保留声明避免旧热重载引用丢失 */
  var __piSessionEntriesCache:
    Map<string, { mtimeMs: number; entries: SessionEntry[] }> | undefined;
  var __piListAllPromise: Promise<SessionInfo[]> | undefined;
}

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

function getDataCache(): Map<string, CachedSessionSnapshot> {
  // 复用 globalThis key 兼容热重载；旧 key __piSessionEntriesCache
  // 类型变更自动冷起。
  if (!globalThis.__piSessionDataCache) globalThis.__piSessionDataCache = new Map();
  return globalThis.__piSessionDataCache;
}

/** 以 mtime LRU 缓存打开会话，返回完整快照（entries + header + leafId + tree + sessionName）。 */
export function openSessionCached(filePath: string): CachedSessionSnapshot {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch {
    // 文件暂缺 → 跳过缓存，让 SessionManager.open 抛出真实错误。
    return snapshotFromManager(getPiAdapter().SessionManager.open(filePath), -1);
  }

  const cache = getDataCache();
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    // LRU touch：移到最近使用位。
    cache.delete(filePath);
    cache.set(filePath, cached);
    return cached;
  }

  const snapshot = snapshotFromManager(getPiAdapter().SessionManager.open(filePath), mtimeMs);
  cache.set(filePath, snapshot);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return snapshot;
}

/** 轻量级：仅读取 header，复用同一 mtime LRU 缓存。 */
export function getSessionHeaderCached(filePath: string): Record<string, unknown> | null {
  try {
    const mtimeMs = statSync(filePath).mtimeMs;
    const cache = getDataCache();
    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) return cached.header;
  } catch {
    // stat 失败 → 文件暂缺，fallback 直接打开（让 SessionManager 抛真实错误）。
  }
  // 缓存未命中或 stat 失败 → 开完整快照。
  return openSessionCached(filePath).header;
}

/**
 * 从 SessionManager 实例提取快照。
 * 参数类型用 SDK 返回值的 duck-type（含 getEntries/getHeader/getLeafId/getTree/getSessionName）
 * 避免直接依赖 SDK 内部类型。
 */
function snapshotFromManager(
   
  sm: {
    getEntries(): any;
    getHeader(): any;
    getLeafId(): any;
    getTree(): any;
    getSessionName(): any;
  },
  mtimeMs: number,
): CachedSessionSnapshot {
  return {
    mtimeMs,
    entries: sm.getEntries() as unknown as SessionEntry[],
    header: sm.getHeader() as Record<string, unknown> | null,
    leafId: sm.getLeafId() as string | null,
    tree: sm.getTree() as unknown[],
    sessionName: sm.getSessionName() as string,
  };
}

/** 写操作后主动失效缓存，确保下次读取拿到最新数据。 */
export function invalidateSessionDataCache(filePath: string): void {
  getDataCache().delete(filePath);
}

/**
 * @deprecated 使用 openSessionCached 获取完整快照；
 * 此函数保留为别名以兼容 contexts 路由等仅需 entries 的调用方。
 */
export function getSessionEntries(filePath: string): SessionEntry[] {
  return openSessionCached(filePath).entries;
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
