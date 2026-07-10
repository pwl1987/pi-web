"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

interface AsyncStatus {
  runId?: string;
  mode?: string;
  state?: string;
  steps?: Array<{
    agent?: string;
    currentTool?: string;
  }>;
}

/**
 * Top-bar badge showing the number of active subagents.
 *
 * - Hidden entirely when no subagents are running (takes zero space).
 * - Shows "🤖 N" with a pulse animation when N > 0.
 * - Clicking opens the subagents panel.
 * - Polls /api/subagents every 10s.
 */
export const SubagentBadge = memo(function SubagentBadge({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  const [active, setActive] = useState<AsyncStatus[]>([]);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/subagents");
      if (!res.ok) return;
      const d = await res.json() as { active: AsyncStatus[] };
      setActive(d.active ?? []);
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    void reload();
    const interval = setInterval(() => void reload(), 10_000);
    return () => clearInterval(interval);
  }, [reload]);

  if (active.length === 0) return null;

  // Build tooltip: one line per active subagent.
  const tooltipLines = active.map((run) => {
    const agent = run.steps?.[0]?.agent ?? run.mode ?? "agent";
    const tool = run.steps?.find((s) => s.currentTool)?.currentTool;
    return tool ? `${agent}: ${tool}` : agent;
  });
  const tooltip = `${t("subagents.badgeTooltip", { count: active.length })}\n${tooltipLines.join("\n")}`;

  return (
    <button
      onClick={onClick}
      title={tooltip}
      aria-label={t("subagents.badgeTooltip", { count: active.length })}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        height: "100%", padding: "0 10px",
        background: "none",
        border: "none",
        borderTop: "2px solid transparent",
        cursor: "pointer",
        color: "var(--accent)",
        fontSize: 11, fontWeight: 600,
        whiteSpace: "nowrap", flexShrink: 0,
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
    >
      <span style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 16, height: 16,
      }}>
        {/* Pulse dot */}
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: "var(--accent)",
          animation: "subagent-pulse 1.5s ease-in-out infinite",
        }} />
      </span>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v4" />
        <line x1="8" y1="16" x2="8" y2="16" />
        <line x1="16" y1="16" x2="16" y2="16" />
      </svg>
      <span>{active.length}</span>
      <style>{`
        @keyframes subagent-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </button>
  );
});
