"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTodoLiveRefresh } from "@/hooks/useTodoLiveRefresh";
import { useAgentRuntime } from "@/lib/agent-runtime-store";
import { EmptyState } from "./ui/EmptyState";

interface TodoTask {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  blockedBy?: number[];
}

/**
 * Floating todo sidebar — overlays on the right side of the chat area.
 *
 * - Collapsed: shows a thin vertical tab on the right edge with a count badge.
 * - Expanded: slides in a ~300px panel listing all tasks grouped by status.
 * - The sidebar is always mounted (when a session is active) so the user can
 *   toggle it at any time. It floats above content without pushing layout.
 */
export function TodoSidebar({
  sessionId,
  open,
  onToggle,
}: {
  sessionId: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const runtime = useAgentRuntime();
  const [tasks, setTasks] = useState<TodoTask[]>([]);

  const reload = useCallback(async () => {
    if (!sessionId) {
      setTasks([]);
      return;
    }
    try {
      const res = await fetch(`/api/task-list?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const d = (await res.json()) as { tasks: TodoTask[] };
      setTasks(d.tasks ?? []);
    } catch {
      /* best-effort */
    }
  }, [sessionId]);

  useEffect(() => {
    void reload();
  }, [reload]);
  // Live refresh — re-fetch when the agent's `todo` tool completes in this session.
  useTodoLiveRefresh(sessionId, reload);
  useEffect(() => {
    if (!runtime.agentRunning && sessionId) void reload();
  }, [runtime.agentRunning, sessionId, reload]);

  if (!sessionId) return null;

  const completed = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  const inProgress = tasks.filter((t) => t.status === "in_progress");
  const pending = tasks.filter((t) => t.status === "pending");
  const doneList = tasks.filter((t) => t.status === "completed");
  const hasTasks = total > 0;
  const allDone = completed === total && total > 0;

  return (
    <>
      {/* Floating toggle tab — always visible on right edge */}
      <button
        onClick={onToggle}
        title={t("todo.title")}
        style={{
          position: "absolute",
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 200,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: "10px 4px",
          background: open ? "var(--bg-panel)" : "var(--bg)",
          border: "1px solid var(--border)",
          borderRight: "none",
          borderRadius: "8px 0 0 8px",
          cursor: "pointer",
          color: allDone ? "var(--accent)" : hasTasks ? "var(--text)" : "var(--text-dim)",
          boxShadow: "-2px 0 8px rgba(0,0,0,0.06)",
          transition: "background 0.15s",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {allDone ? (
            <>
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </>
          ) : (
            <>
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </>
          )}
        </svg>
        {hasTasks && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              writingMode: "vertical-rl",
              textOrientation: "mixed",
              color: allDone ? "var(--accent)" : "var(--text-muted)",
              letterSpacing: "0.05em",
            }}
          >
            {completed}/{total}
          </span>
        )}
      </button>

      {/* Slide-in panel */}
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 300,
            zIndex: 199,
            background: "var(--bg-panel)",
            borderLeft: "1px solid var(--border)",
            boxShadow: "-4px 0 16px rgba(0,0,0,0.08)",
            display: "flex",
            flexDirection: "column",
            animation: "todo-slide-in 0.2s ease-out",
          }}
        >
          <style>{`
            @keyframes todo-slide-in {
              from { transform: translateX(100%); opacity: 0; }
              to { transform: translateX(0); opacity: 1; }
            }
          `}</style>
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 12px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--accent)" }}
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{t("todo.title")}</span>
              {hasTasks && (
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--text-dim)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  ({completed}/{total})
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button onClick={() => void reload()} title={t("common.refresh")} style={iconBtn}>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
                </svg>
              </button>
              <button onClick={onToggle} title={t("common.close")} style={iconBtn}>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          {/* Body */}
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
            {!hasTasks ? (
              <EmptyState padding="24px 16px" fontSize={12} center lineHeight={1.6}>
                {t("todo.empty")}
              </EmptyState>
            ) : (
              <>
                {inProgress.length > 0 && (
                  <TodoGroup label={t("todo.inProgress")} tasks={inProgress} accent />
                )}
                {pending.length > 0 && <TodoGroup label={t("todo.pending")} tasks={pending} />}
                {doneList.length > 0 && (
                  <TodoGroup label={t("todo.completed")} tasks={doneList} muted />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function TodoGroup({
  label,
  tasks,
  accent,
  muted,
}: {
  label: string;
  tasks: TodoTask[];
  accent?: boolean;
  muted?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(!!muted);
  return (
    <div style={{ marginBottom: 2 }}>
      <button
        onClick={() => setCollapsed((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "6px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: accent ? "var(--accent)" : "var(--text-dim)",
          textAlign: "left",
        }}
      >
        <span style={{ width: 8 }}>{collapsed ? "▸" : "▾"}</span>
        {label} ({tasks.length})
      </button>
      {!collapsed &&
        tasks.map((task) => (
          <div
            key={task.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 7,
              padding: "5px 12px 5px 20px",
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                flexShrink: 0,
                marginTop: 1,
                border:
                  task.status === "completed"
                    ? "none"
                    : accent
                      ? "2px solid var(--accent)"
                      : "2px solid var(--border)",
                background:
                  task.status === "completed" ? "var(--accent)" : accent ? "var(--accent)" : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {task.status === "completed" && (
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="var(--bg)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="1.5 5 4 7.5 8.5 2.5" />
                </svg>
              )}
              {accent && task.status !== "completed" && (
                <span
                  style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--bg)" }}
                />
              )}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  lineHeight: 1.35,
                  color: muted ? "var(--text-dim)" : "var(--text)",
                  textDecoration: task.status === "completed" ? "line-through" : "none",
                  wordBreak: "break-word",
                }}
              >
                {task.subject}
              </div>
              {task.description && !muted && (
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                  {task.description}
                </div>
              )}
              {task.activeForm && accent && (
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--accent)",
                    fontStyle: "italic",
                    marginTop: 1,
                  }}
                >
                  ⟳ {task.activeForm}
                </div>
              )}
              {task.blockedBy && task.blockedBy.length > 0 && !muted && (
                <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 1 }}>
                  ⛔ {task.blockedBy.join(", ")}
                </div>
              )}
            </div>
          </div>
        ))}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--text-muted)",
  padding: "3px",
  borderRadius: 4,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
