"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTodoLiveRefresh } from "@/hooks/useTodoLiveRefresh";
import { useAgentRuntime } from "@/lib/agent-runtime-store";

// ---- Types ----

interface GitDiffData {
  isGit: boolean;
  branch: string | null;
  added: number;
  deleted: number;
  modified: number;
  staged: number;
  untracked: number;
}

interface TodoTask {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  blockedBy?: number[];
}

// ---- Component ----

/**
 * Floating inspector panel — bottom-right taskbar.
 *
 * Two mutually exclusive states:
 * - collapsed → small floating pill at bottom-right showing change stats
 * - expanded → floating glass panel above where the pill would be, with a
 *   circular close (X) in the panel's top-right corner and a 3-dot menu
 *   inside the header. The pill disappears while expanded.
 */
export function InspectorPanel({ sessionId, cwd, open, onToggle }: {
  sessionId: string | null;
  cwd: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const runtime = useAgentRuntime();
  const [gitData, setGitData] = useState<GitDiffData | null>(null);
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [pinned, setPinned] = useState(false);
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [closeHover, setCloseHover] = useState(false);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ---- Pin state from localStorage ----
  useEffect(() => {
    try {
      const p = localStorage.getItem("pi-inspector-pinned");
      if (p === "true") { setPinned(true); onToggle(); }
      const c = localStorage.getItem("pi-inspector-tasks-collapsed");
      if (c === "true") setTasksCollapsed(true);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePin = useCallback(() => {
    setPinned((prev) => {
      const next = !prev;
      try { localStorage.setItem("pi-inspector-pinned", String(next)); } catch { /* ignore */ }
      return next;
    });
    setMenuOpen(false);
  }, []);

  const toggleTasksCollapsed = useCallback(() => {
    setTasksCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("pi-inspector-tasks-collapsed", String(next)); } catch { /* ignore */ }
      return next;
    });
    setMenuOpen(false);
  }, []);

  // ---- Git data fetching ----
  const reloadGit = useCallback(async () => {
    if (!cwd) return;
    try {
      const res = await fetch(`/api/git-diff?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) return;
      setGitData(await res.json());
    } catch { /* best-effort */ }
  }, [cwd]);

  // ---- Todo data fetching ----
  const reloadTodos = useCallback(async () => {
    if (!sessionId) { setTasks([]); return; }
    try {
      const res = await fetch(`/api/task-list?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const d = await res.json() as { tasks: TodoTask[] };
      setTasks(d.tasks ?? []);
    } catch { /* best-effort */ }
  }, [sessionId]);

  // Initial load + git polling (10s)
  useEffect(() => {
    void reloadGit();
    const interval = setInterval(() => void reloadGit(), 10_000);
    return () => clearInterval(interval);
  }, [reloadGit]);

  // Todo load + refresh on agent end
  useEffect(() => { void reloadTodos(); }, [reloadTodos]);
  // Live refresh — re-fetch the moment the agent's `todo` tool completes,
  // so progress updates mid-run show up without waiting for agent_end.
  useTodoLiveRefresh(sessionId, reloadTodos);
  useEffect(() => {
    if (!runtime.agentRunning) { void reloadGit(); void reloadTodos(); }
  }, [runtime.agentRunning, reloadGit, reloadTodos]);

  // ---- Auto-fit expanded panel width to content (clamped by container) ----
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    const panel = panelRef.current;
    if (!container || !panel) return;
    const measure = () => {
      const p = panelRef.current;
      const c = containerRef.current;
      if (!p || !c) return;
      p.style.width = "auto";
      const natural = p.scrollWidth;
      const maxWidth = Math.max(260, c.clientWidth - 24);
      const next = Math.min(natural, maxWidth);
      p.style.width = `${next}px`;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    ro.observe(panel);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, gitData?.isGit, tasks.length, tasksCollapsed]);

  // ---- Close the 3-dot menu on outside click ----
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // ---- Escape closes the panel ----
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onToggle]);

  const hasTasks = tasks.length > 0;
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const inProgressTasks = tasks.filter((t) => t.status === "in_progress");
  const pendingTasks = tasks.filter((t) => t.status === "pending");
  const allDone = hasTasks && completedTasks.length === tasks.length;

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const showGit = gitData?.isGit === true;

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: 14,
        right: 14,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
      }}
    >
      <style>{`
        @keyframes inspector-fade-down {
          from { opacity: 0; transform: translateY(-8px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
        @keyframes inspector-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.4; transform: scale(0.7); }
        }
      `}</style>

      {/* ======================================================
          EXPANDED — floating panel (only shown when open)
         ====================================================== */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            minWidth: 260,
            maxWidth: "100%",
            marginBottom: 10, // gap from pill area below
            background: "color-mix(in srgb, var(--bg-panel) 90%, transparent)",
            backdropFilter: "blur(16px) saturate(150%)",
            WebkitBackdropFilter: "blur(16px) saturate(150%)",
            border: "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
            borderRadius: 14,
            boxShadow:
              "0 16px 48px rgba(0,0,0,0.25), 0 4px 12px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.04)",
            animation: "inspector-fade-down 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
            transformOrigin: "top right",
            overflow: "visible", // allow floating close button to protrude
          }}
        >
          {/* ---- Floating circular close button (top-right, protrudes) ---- */}
          <button
            onClick={onToggle}
            onMouseEnter={() => setCloseHover(true)}
            onMouseLeave={() => setCloseHover(false)}
            title={t("common.close")}
            aria-label={t("common.close")}
            style={{
              position: "absolute",
              top: -10,
              right: -10,
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              borderRadius: "50%",
              border: "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
              background: closeHover
                ? "color-mix(in srgb, var(--git-deleted) 18%, var(--bg-panel))"
                : "color-mix(in srgb, var(--bg-panel) 95%, transparent)",
              backdropFilter: "blur(12px) saturate(160%)",
              WebkitBackdropFilter: "blur(12px) saturate(160%)",
              boxShadow: closeHover
                ? "0 4px 14px rgba(244,112,103,0.35), 0 2px 6px rgba(0,0,0,0.18)"
                : "0 4px 10px rgba(0,0,0,0.20), 0 1px 3px rgba(0,0,0,0.12)",
              cursor: "pointer",
              color: closeHover ? "var(--git-deleted)" : "var(--text-muted)",
              transition: "background 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s",
              transform: closeHover ? "scale(1.06)" : "scale(1)",
              zIndex: 2,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* ---- Header ---- */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
              minHeight: 38,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)", flexShrink: 0 }}>
                <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M6 9v6" />
                <path d="M18 9a3 3 0 1 0-3-3" /><path d="M15 21h6" /><path d="M18 18v3" />
              </svg>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{t("inspector.title")}</span>
              {pinned && (
                <span
                  title={t("inspector.pinned")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    padding: "1px 6px",
                    fontSize: 9,
                    fontWeight: 600,
                    color: "var(--accent)",
                    background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                    borderRadius: 999,
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" /></svg>
                  {t("inspector.pinned")}
                </span>
              )}
            </div>

            {/* Three-dot menu (stays inside header) */}
            <div ref={menuRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: 2 }}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                title={t("inspector.more")}
                aria-label={t("inspector.more")}
                style={{
                  ...iconBtn,
                  color: menuOpen ? "var(--text)" : "var(--text-muted)",
                  background: menuOpen ? "var(--bg-hover)" : "transparent",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
                </svg>
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    right: 0,
                    minWidth: 200,
                    padding: 4,
                    background: "color-mix(in srgb, var(--bg-panel) 96%, transparent)",
                    backdropFilter: "blur(14px) saturate(160%)",
                    WebkitBackdropFilter: "blur(14px) saturate(160%)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    boxShadow: "0 8px 28px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.10)",
                    zIndex: 3,
                    animation: "inspector-fade-down 0.14s ease-out",
                  }}
                >
                  <MenuItem
                    onClick={togglePin}
                    checked={pinned}
                    icon={
                      <svg width="13" height="13" viewBox="0 0 24 24" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
                      </svg>
                    }
                    label={t("inspector.pin")}
                  />
                  <MenuItem
                    onClick={() => { toggleTasksCollapsed(); }}
                    checked={tasksCollapsed}
                    icon={
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    }
                    label={t("inspector.collapseTasks")}
                  />
                  <div style={{ height: 1, background: "var(--border)", margin: "4px 6px" }} />
                  <MenuItem
                    onClick={() => { void reloadGit(); void reloadTodos(); setMenuOpen(false); }}
                    checked={false}
                    icon={
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
                      </svg>
                    }
                    label={t("common.refresh")}
                  />
                </div>
              )}
            </div>
          </div>

          {/* ---- Block: Git changes ---- */}
          {showGit && (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 14px 6px",
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "var(--bg-subtle)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}>
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </span>
                <span style={{ fontSize: 13, color: "var(--text)", flex: 1, fontWeight: 500 }}>{t("inspector.changes")}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--git-added)", fontVariantNumeric: "tabular-nums" }}>
                  +{fmt(gitData!.added)}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--git-deleted)", fontVariantNumeric: "tabular-nums" }}>
                  −{fmt(gitData!.deleted)}
                </span>
              </div>
              {/* Sub-detail: file counts */}
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "0 14px 8px 44px",
                  fontSize: 10,
                  color: "var(--text-dim)",
                }}
              >
                <span>{t("inspector.modified")}: {gitData!.modified}</span>
                <span>{t("inspector.staged")}: {gitData!.staged}</span>
                {gitData!.untracked > 0 && <span>{t("inspector.untracked")}: {gitData!.untracked}</span>}
              </div>
            </div>
          )}

          {/* ---- Block: Branch selector + commit/push action ---- */}
          {showGit && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderTop: "1px solid var(--border)",
              }}
            >
              <button
                title={t("inspector.branch")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                  padding: "5px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--bg)",
                  cursor: "pointer",
                  color: "var(--text)",
                  flex: 1,
                  transition: "border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--text-muted)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)", flexShrink: 0 }}>
                  <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M6 9v6" />
                  <path d="M18 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M18 12v3a3 3 0 0 1-3 3H9" />
                </svg>
                <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                  {gitData!.branch ?? t("inspector.detached")}
                </span>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <button
                title={t("inspector.commitPush")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 10px",
                  border: "1px solid color-mix(in srgb, var(--accent) 40%, var(--border))",
                  borderRadius: 6,
                  background: "color-mix(in srgb, var(--accent) 8%, var(--bg))",
                  cursor: "pointer",
                  color: "var(--accent)",
                  flexShrink: 0,
                  fontWeight: 600,
                  transition: "background 0.15s, border-color 0.15s",
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.background = "color-mix(in srgb, var(--accent) 16%, var(--bg))";
                  el.style.borderColor = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.background = "color-mix(in srgb, var(--accent) 8%, var(--bg))";
                  el.style.borderColor = "color-mix(in srgb, var(--accent) 40%, var(--border))";
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
                <span style={{ fontSize: 12 }}>{t("inspector.commitPush")}</span>
              </button>
            </div>
          )}

          {/* ---- Block: Task progress ---- */}
          {hasTasks && (
            <div style={{ borderTop: "1px solid var(--border)", flex: 1, overflowY: "auto", minHeight: 0 }}>
              <button
                onClick={toggleTasksCollapsed}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 14px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>{t("inspector.process")}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: allDone ? "var(--git-added)" : "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                    {completedTasks.length}/{tasks.length}
                  </span>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)", transform: tasksCollapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s" }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>

              {!tasksCollapsed && (
                <div style={{ padding: "0 0 8px" }}>
                  {completedTasks.length > 0 && (
                    <div style={{ padding: "0 14px 4px", fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {t("inspector.completedN", { count: completedTasks.length })}
                    </div>
                  )}
                  {inProgressTasks.map((task) => (
                    <TaskRow key={task.id} task={task} variant="active" />
                  ))}
                  {pendingTasks.map((task) => (
                    <TaskRow key={task.id} task={task} variant="pending" />
                  ))}
                  {completedTasks.map((task) => (
                    <TaskRow key={task.id} task={task} variant="done" />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!hasTasks && !showGit && (
            <div
              style={{
                padding: "32px 16px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)" }}>
                <circle cx="12" cy="12" r="10" /><path d="M8 12h8M12 8v8" />
              </svg>
              <span style={{ fontSize: 12, color: "var(--text-dim)", textAlign: "center", lineHeight: 1.5 }}>
                {t("inspector.empty")}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ======================================================
          COLLAPSED — floating taskbar pill (only shown when NOT open)
         ====================================================== */}
      {!open && (
        <button
          onClick={onToggle}
          title={t("inspector.title")}
          aria-label={t("inspector.title")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "6px 12px",
            height: 30,
            background: "color-mix(in srgb, var(--bg-panel) 90%, transparent)",
            backdropFilter: "blur(12px) saturate(150%)",
            WebkitBackdropFilter: "blur(12px) saturate(150%)",
            border: "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
            borderRadius: 999,
            cursor: "pointer",
            color: "var(--text)",
            fontSize: 12,
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
            boxShadow: "0 4px 14px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.08)",
            width: "fit-content",
            transition: "transform 0.12s ease, box-shadow 0.12s ease",
            animation: "inspector-fade-down 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow = "0 8px 22px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.10)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.08)";
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--text-muted)", flexShrink: 0 }}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 9h6v6H9z" />
          </svg>
          <span>{t("inspector.changes")}</span>
          {showGit && (
            <>
              <span style={{ fontWeight: 600, color: "var(--git-added)" }}>+{fmt(gitData!.added)}</span>
              <span style={{ fontWeight: 600, color: "var(--git-deleted)" }}>−{fmt(gitData!.deleted)}</span>
            </>
          )}
          {hasTasks && (
            <>
              <span style={{ width: 1, height: 12, background: "var(--border)", margin: "0 2px" }} />
              <span style={{ color: allDone ? "var(--git-added)" : "var(--text-muted)", fontWeight: 600 }}>
                {completedTasks.length}/{tasks.length}
              </span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ---- Menu item helper ----

function MenuItem({ onClick, label, icon, checked }: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  checked: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="menuitem"
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "7px 10px",
        border: "none",
        borderRadius: 7,
        background: hover ? "var(--bg-hover)" : "transparent",
        color: "var(--text)",
        cursor: "pointer",
        fontSize: 12,
        textAlign: "left",
        transition: "background 0.1s",
      }}
    >
      <span style={{ display: "inline-flex", width: 14, alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
        {icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {checked && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)" }}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}

// ---- Task row ----

function TaskRow({ task, variant }: { task: TodoTask; variant: "active" | "pending" | "done" }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "4px 14px",
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          flexShrink: 0,
          marginTop: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          ...(variant === "done"
            ? { background: "var(--git-added)", border: "none" }
            : variant === "active"
              ? { background: "var(--accent)", border: "2px solid var(--accent)" }
              : { background: "none", border: "2px solid var(--border)" }),
        }}
      >
        {variant === "done" && (
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="var(--bg)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1.5 5 4 7.5 8.5 2.5" />
          </svg>
        )}
        {variant === "active" && (
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--bg)",
              animation: "inspector-pulse 1.5s ease-in-out infinite",
            }}
          />
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.35,
            color: variant === "done" ? "var(--text-dim)" : "var(--text)",
            textDecoration: variant === "done" ? "line-through" : "none",
            wordBreak: "break-word",
          }}
        >
          {task.subject}
        </div>
        {task.activeForm && variant === "active" && (
          <div style={{ fontSize: 10, color: "var(--accent)", fontStyle: "italic", marginTop: 1 }}>
            ⟳ {task.activeForm}
          </div>
        )}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--text-muted)",
  padding: 5,
  borderRadius: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "background 0.1s",
};