"use client";

import type { OrchestrationStatus } from "@/lib/agent-orchestrator";

const STATUS_CONFIG: Record<
  OrchestrationStatus,
  { bg: string; border: string; pulse?: boolean; check?: boolean }
> = {
  idle: { bg: "none", border: "var(--border)" },
  parsing: { bg: "var(--accent)", border: "var(--accent)", pulse: true },
  discussing: { bg: "var(--accent)", border: "var(--accent)", pulse: true },
  synthesizing: { bg: "var(--accent)", border: "var(--accent)", pulse: true },
  awaiting_confirm: { bg: "var(--color-warning)", border: "var(--color-warning)", pulse: true },
  awaiting_clarify: { bg: "var(--color-warning)", border: "var(--color-warning)", pulse: true },
  executing: { bg: "var(--git-added)", border: "var(--git-added)", pulse: true },
  done: { bg: "var(--git-added)", border: "none", check: true },
  failed: { bg: "var(--color-error-soft)", border: "none", check: false },
  cancelled: { bg: "var(--text-dim)", border: "none", check: false },
};

export function PlanStatusDot({
  status,
  size = 14,
}: {
  status: OrchestrationStatus;
  size?: number;
}) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: config.bg,
        border: config.border ? `2px solid ${config.border}` : "none",
      }}
    >
      {config.check && status === "done" && (
        <svg
          width={size * 0.65}
          height={size * 0.65}
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
      {config.pulse && (
        <span
          style={{
            width: size * 0.35,
            height: size * 0.35,
            borderRadius: "50%",
            background: "var(--bg)",
            animation: "inspector-pulse 1.5s ease-in-out infinite",
          }}
        />
      )}
    </span>
  );
}
