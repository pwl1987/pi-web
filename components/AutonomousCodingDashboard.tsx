"use client";

import type { CSSProperties } from "react";
import { useUnifiedEngine } from "@/hooks/useUnifiedEngine";
import { StageStepper } from "./StageStepper";
import { PlanTaskCard } from "./PlanTaskCard";
import { RequirementTree } from "./RequirementTree";
import { useI18n } from "@/hooks/useI18n";
import type { RunState } from "@/lib/unified-engine/unified-engine-types";

const inputStyle: CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 10px",
  color: "var(--text)",
  fontSize: 13,
  minWidth: 160,
};
const btnStyle: CSSProperties = {
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const btnStyleGhost: CSSProperties = {
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
          style={inputStyle}
        />
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder={t("engine.cwd")}
          style={inputStyle}
        />
        <button onClick={createChange} disabled={loading} style={btnStyle}>
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
                <button onClick={() => controlRun(selected.runId, "start")} style={btnStyle}>
                  {t("engine.start")}
                </button>
                <button onClick={() => controlRun(selected.runId, "pause")} style={btnStyleGhost}>
                  {t("engine.pause")}
                </button>
                <button onClick={() => controlRun(selected.runId, "resume")} style={btnStyleGhost}>
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
                {selected.tasks.length === 0 && (
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
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("engine.feedback")}</div>
          <div
            style={{
              overflowY: "auto",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {events.map((e, i) => (
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
                <span style={{ color: "var(--accent)" }}>[{e.type}]</span> {e.message ?? ""}
              </div>
            ))}
            {events.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("engine.noEvents")}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
