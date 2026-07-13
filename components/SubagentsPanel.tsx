"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { btnStyle, cardStyle, errorBoxStyle, loadingBoxStyle } from "@/lib/styles";

interface AsyncStatus {
  runId?: string;
  sessionId?: string;
  mode?: string;
  state?: string;
  currentStep?: number;
  chainStepCount?: number;
  startedAt?: number;
  endedAt?: number;
  totalTokens?: number;
  totalCost?: number;
  steps?: Array<{
    agent?: string;
    status?: string;
    currentTool?: string;
    activityState?: string;
    turnCount?: number;
    toolCount?: number;
    tokens?: number;
    totalCost?: number;
  }>;
}

interface CompletedResult {
  runId?: string;
  agent?: string;
  success?: boolean;
  summary?: string;
  state?: string;
  totalTokens?: number;
  totalCost?: number;
}

export function SubagentsPanel() {
  const { t } = useI18n();
  const [active, setActive] = useState<AsyncStatus[]>([]);
  const [completed, setCompleted] = useState<CompletedResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/subagents");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { active: AsyncStatus[]; completed: CompletedResult[] };
      setActive(d.active);
      setCompleted(d.completed);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // Poll every 10s for live updates.
    const interval = setInterval(() => void reload(), 10_000);
    return () => clearInterval(interval);
  }, [reload]);

  if (loading) return <div style={loadingBoxStyle}>{t("common.loading")}</div>;
  if (error) return <div style={errorBoxStyle}>{error}</div>;

  return (
    <div style={{ padding: 12, fontSize: 12, height: "100%", overflowY: "auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t("subagents.title")}</h3>
        <button onClick={() => void reload()} style={btnStyle}>
          {t("common.refresh")}
        </button>
      </div>

      {/* Active runs */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
          marginBottom: 6,
        }}
      >
        {t("subagents.active")} ({active.length})
      </div>
      {active.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {active.map((run) => (
            <div key={run.runId} style={cardStyle}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                  {run.steps?.[0]?.agent ?? run.mode ?? "agent"}
                </span>
                <span
                  style={badgeStyle(run.state === "running" ? "var(--accent)" : "var(--text-dim)")}
                >
                  {run.state ?? "?"}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginTop: 6,
                  fontSize: 11,
                  color: "var(--text-muted)",
                }}
              >
                <span>
                  {t("subagents.mode")}: {run.mode ?? "?"}
                </span>
                {run.chainStepCount && (
                  <span>
                    {t("subagents.step")}: {run.currentStep ?? 0}/{run.chainStepCount}
                  </span>
                )}
                {run.steps?.some((s) => s.currentTool) && (
                  <span>
                    🔧{" "}
                    {run.steps
                      .filter((s) => s.currentTool)
                      .map((s) => s.currentTool)
                      .join(", ")}
                  </span>
                )}
              </div>
              {(run.totalTokens || run.totalCost) && (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginTop: 4,
                    fontSize: 11,
                    color: "var(--text-dim)",
                  }}
                >
                  {run.totalTokens ? <span>{run.totalTokens.toLocaleString()} tokens</span> : null}
                  {run.totalCost ? <span>${run.totalCost.toFixed(4)}</span> : null}
                </div>
              )}
              {run.startedAt && (
                <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>
                  {new Date(run.startedAt).toLocaleTimeString()}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: "var(--text-dim)", marginBottom: 16 }}>{t("subagents.noActive")}</div>
      )}

      {/* Completed runs */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
          marginBottom: 6,
        }}
      >
        {t("subagents.completed")} ({completed.length})
      </div>
      {completed.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {completed.slice(0, 20).map((run, i) => (
            <div key={run.runId ?? i} style={cardStyle}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                  {run.agent ?? "agent"}
                </span>
                <span style={badgeStyle(run.success ? "var(--accent)" : "#f87171")}>
                  {run.success ? "✓" : "✗"}
                </span>
              </div>
              {run.summary && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginTop: 4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {run.summary}
                </div>
              )}
              {(run.totalTokens || run.totalCost) && (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginTop: 4,
                    fontSize: 11,
                    color: "var(--text-dim)",
                  }}
                >
                  {run.totalTokens ? <span>{run.totalTokens.toLocaleString()} tokens</span> : null}
                  {run.totalCost ? <span>${run.totalCost.toFixed(4)}</span> : null}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: "var(--text-dim)" }}>{t("subagents.noCompleted")}</div>
      )}
    </div>
  );
}

function badgeStyle(color: string): React.CSSProperties {
  return {
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 3,
    background: `${color}22`,
    color,
    fontWeight: 600,
  };
}
