/**
 * Session utility functions extracted from SessionSidebar.tsx.
 *
 * Provides:
 *   - localStorage-based unread session tracking
 *   - Relative time formatting
 *   - Recent project deduplication
 *   - Home-dir display substitution
 *   - Session tree building from flat session lists
 */

import type { SessionInfo } from "./types";

// ── Unread session tracking ──────────────────────────────────────────────

const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";

export function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed))
      return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

export function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

// ── Relative time formatting ─────────────────────────────────────────────

export function formatRelativeTime(
  dateStr: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return t("sidebar.justNow");
  if (mins < 60) return t("sidebar.minutesAgo", { count: mins });
  if (hours < 24) return t("sidebar.hoursAgo", { count: hours });
  if (days < 7) return t("sidebar.daysAgo", { count: days });
  return date.toLocaleDateString();
}

// ── Project deduplication ────────────────────────────────────────────────

/**
 * Return all projects (deduped by projectRoot so worktrees collapse into their
 * main repo) sorted by most recent session activity.
 */
export function getRecentProjects(sessions: SessionInfo[]): string[] {
  const latestByRoot = new Map<string, string>(); // projectRoot -> most recent modified
  for (const s of sessions) {
    const root = s.projectRoot ?? s.cwd;
    if (!root) continue;
    const prev = latestByRoot.get(root);
    if (!prev || s.modified > prev) {
      latestByRoot.set(root, s.modified);
    }
  }
  return [...latestByRoot.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([root]) => root);
}

// ── Display helpers ──────────────────────────────────────────────────────

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
export function displayCwd(cwd: string, homeDir?: string): string {
  return homeDir && cwd.startsWith(homeDir) ? "~" + cwd.slice(homeDir.length) : cwd;
}

// ── Session tree ─────────────────────────────────────────────────────────

export interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

export function buildSessionTree(
  sessions: SessionInfo[],
  options?: { orchestrators?: SessionInfo[] },
): SessionTreeNode[] {
  const orchestrators = options?.orchestrators ?? [];
  const byId = new Map<string, SessionTreeNode>();

  // ponytail: orchestrator 虚拟根优先入桶（id 用 orchId），随后 sessions 入桶，
  // 冲突时 orchestrator 优先（不覆盖），确保 plan-mode 入口被收纳而非重复。
  for (const o of orchestrators) {
    byId.set(o.id, { session: o, children: [] });
  }
  for (const s of sessions) {
    if (!byId.has(s.id)) byId.set(s.id, { session: s, children: [] });
  }

  // 父子关系：orchestratorParentId 优先（plan-mode 入口），其次 parentSessionId（fork）。
  const parentOf = new Map<string, string>();
  for (const s of sessions) {
    if (s.orchestratorParentId) parentOf.set(s.id, s.orchestratorParentId);
    else if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
  }

  // Walk up the parentSessionId chain to find the nearest ancestor that exists in byId
  function resolveAncestor(id: string): string | null {
    let cur = parentOf.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur)) return null; // cycle guard
      visited.add(cur);
      if (byId.has(cur)) return cur;
      cur = parentOf.get(cur);
    }
    return null;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) {
      const parent = byId.get(ancestor);
      if (parent) parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // ponytail: 过滤空 orchestrator 节点（无 child 的虚拟根不显示，避免堆栈噪音）。
  // 由 SessionSidebar 负责把 orchestrator 节点 id 标到 SessionInfo 上，
  // 通过判断 children.length === 0 识别。
  const orchIdSet = new Set(orchestrators.map((o) => o.id));
  const filteredRoots = roots.filter((n) => !orchIdSet.has(n.session.id) || n.children.length > 0);

  // Sort each level by modified desc
  const sort = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((n) => sort(n.children));
  };
  sort(filteredRoots);
  return filteredRoots;
}
