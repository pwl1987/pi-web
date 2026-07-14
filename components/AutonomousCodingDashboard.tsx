"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useUnifiedEngine } from "@/hooks/useUnifiedEngine";
import { StageStepper } from "./StageStepper";
import { PlanTaskCard } from "./PlanTaskCard";
import { RequirementTree } from "./RequirementTree";
import { Skeleton } from "./Skeleton";
import { useI18n } from "@/hooks/useI18n";
import { stripAnsi } from "@/lib/ansi";
import type { RunState } from "@/lib/unified-engine/unified-engine-types";

/** 把引擎日志的 ISO 时间戳（UTC）转为本地时区 HH:MM:SS 显示。 */
function formatLogTime(at: unknown): string {
  const s = String(at ?? "");
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s.slice(11, 19)
    : d.toLocaleTimeString("zh-CN", { hour12: false });
}

const dashboardInputStyle: CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 10px",
  color: "var(--text)",
  fontSize: 13,
  minWidth: 160,
};
const dashboardBtnStyle: CSSProperties = {
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const dashboardBtnStyleGhost: CSSProperties = {
  background: "transparent",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  cursor: "pointer",
};

function StatusBadge({ status }: { status: RunState["status"] }) {
  const { t } = useI18n();
  const color =
    status === "completed"
      ? "#22C55E"
      : status === "failed"
        ? "#EF4444"
        : status === "running"
          ? "var(--accent)"
          : "var(--text-dim)";
  return <span style={{ fontSize: 12, fontWeight: 600, color }}>{t(`engine.run.${status}`)}</span>;
}

export function AutonomousCodingDashboard() {
  const { t } = useI18n();
  const {
    runs,
    selectedRunId,
    events,
    cwd,
    title,
    loading,
    error,
    setCwd,
    setTitle,
    selectRun,
    createChange,
    controlRun,
  } = useUnifiedEngine();
  const selected = runs.find((r) => r.runId === selectedRunId) ?? null;

  // 运行日志视图：按当前选中 run 过滤引擎日志（持久化，跨重启可追踪）。
  const [showEngineLog, setShowEngineLog] = useState(false);
  const [engineLogs, setEngineLogs] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    if (!showEngineLog || !selectedRunId) return;
    let cancelled = false;
    fetch(`/api/engine/log?scope=engine&limit=500`)
      .then((r) => r.json())
      .then((d) => {
        const all = (d.logs ?? []) as Array<Record<string, unknown>>;
        if (!cancelled)
          setEngineLogs(
            all.filter(
              (l) =>
                ((l.meta as Record<string, unknown> | undefined)?.runId ?? "") === selectedRunId,
            ),
          );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showEngineLog, selectedRunId]);

  return (
    <div
      style={{
        width: "min(1120px, 94vw)",
        height: "min(78vh, 760px)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        color: "var(--text)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("engine.newTitle")}
          style={dashboardInputStyle}
        />
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder={t("engine.cwd")}
          style={dashboardInputStyle}
        />
        <button onClick={createChange} disabled={loading} style={dashboardBtnStyle}>
          {t("engine.create")}
        </button>
        {error && <span style={{ color: "#EF4444", fontSize: 12 }}>{error}</span>}
      </div>

      <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0 }}>
        <div style={{ width: 240, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          <RequirementTree runs={runs} selectedRunId={selectedRunId} onSelect={selectRun} />
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
          {selected ? (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <StageStepper current={selected.stage} />
                <StatusBadge status={selected.status} />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  onClick={() => controlRun(selected.runId, "start")}
                  style={dashboardBtnStyle}
                >
                  {t("engine.start")}
                </button>
                <button
                  onClick={() => controlRun(selected.runId, "pause")}
                  style={dashboardBtnStyleGhost}
                >
                  {t("engine.pause")}
                </button>
                <button
                  onClick={() => controlRun(selected.runId, "resume")}
                  style={dashboardBtnStyleGhost}
                >
                  {t("engine.resume")}
                </button>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {selected.changeName}
                </span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t("engine.tasks")}</div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  overflowY: "auto",
                  minHeight: 0,
                  paddingRight: 4,
                }}
              >
                {selected.tasks.map((task) => (
                  <PlanTaskCard key={task.id} task={task} />
                ))}
                {selected.tasks.length === 0 && selected.status === "running" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={i}
                        style={{
                          background: "var(--bg-panel)",
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                          padding: "10px 12px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <Skeleton width="60%" height={14} radius={4} />
                        <Skeleton width="100%" height={12} radius={4} />
                        <Skeleton width="80%" height={12} radius={4} />
                      </div>
                    ))}
                  </div>
                )}
                {selected.tasks.length === 0 && selected.status !== "running" && (
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    {t("engine.noTasks")}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-dim)",
                fontSize: 14,
              }}
            >
              {t("engine.empty")}
            </div>
          )}
        </div>

        <div style={{ width: 280, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => setShowEngineLog(false)}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: !showEngineLog
                  ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                  : "none",
                color: !showEngineLog ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {t("engine.live")}
            </button>
            <button
              onClick={() => setShowEngineLog(true)}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: showEngineLog
                  ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                  : "none",
                color: showEngineLog ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {t("engine.logView")}
            </button>
          </div>
          <div
            style={{
              overflowY: "auto",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {showEngineLog ? (
              engineLogs.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("engine.emptyLog")}</div>
              ) : (
                engineLogs.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 11,
                      color: "var(--text-dim)",
                      borderLeft: "2px solid var(--border)",
                      paddingLeft: 8,
                      lineHeight: 1.4,
                    }}
                  >
                    <span style={{ color: "#64748b" }}>{formatLogTime(l.at)}</span>{" "}
                    <span style={{ color: "var(--text)" }}>
                      {stripAnsi(String(l.message ?? ""))}
                    </span>
                  </div>
                ))
              )
            ) : events.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("engine.noEvents")}</div>
            ) : (
              events.map((e, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 11,
                    color: "var(--text-dim)",
                    borderLeft: "2px solid var(--border)",
                    paddingLeft: 8,
                    lineHeight: 1.4,
                  }}
                >
                  <span style={{ color: "var(--accent)" }}>[{e.type}]</span>{" "}
                  {stripAnsi(String(e.message ?? ""))}
                </div>
              ))
            )}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{t("engine.persistedHint")}</div>
        </div>
      </div>
    </div>
  );
}
