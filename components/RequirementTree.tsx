"use client";

import type { RunState } from "@/lib/unified-engine/unified-engine-types";
import { useI18n } from "@/hooks/useI18n";

export function RequirementTree({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: RunState[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 0, overflowY: "auto" }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", padding: "2px 4px" }}>
        {t("engine.changes")}
      </div>
      {runs.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-dim)", padding: 4 }}>
          {t("engine.emptyList")}
        </div>
      )}
      {runs.map((r) => {
        const active = r.runId === selectedRunId;
        return (
          <button
            key={r.runId}
            onClick={() => onSelect(r.runId)}
            style={{
              textAlign: "left",
              cursor: "pointer",
              border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
              borderRadius: 10,
              padding: "8px 10px",
              background: active
                ? "color-mix(in srgb, var(--accent) 16%, transparent)"
                : "transparent",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{r.title}</span>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {r.changeName} · {t(`engine.stage.${r.stage}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
