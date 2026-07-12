"use client";

// 约束面板：实时展示当前生效的约束违反，并支持手动重新校验。
// 数据来自 useConstraints()，后者订阅约束引擎——当 i18n 语言切换、运行时状态变化或
// 业务投递 status:reported 事件时，面板会即时更新（约束与程序逻辑联动的 UI 落地）。

import { useConstraints } from "@/lib/constraints/useConstraints";
import { useI18n } from "@/hooks/useI18n";
import type { ConstraintSeverity } from "@/lib/constraints/types";

const SEVERITY_LABEL: Record<ConstraintSeverity, string> = {
  error: "错误",
  warn: "警告",
  info: "提示",
};

const SEVERITY_COLOR: Record<ConstraintSeverity, string> = {
  error: "var(--danger, #e5484d)",
  warn: "var(--warning, #f5a623)",
  info: "var(--text-muted)",
};

const btnStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
};

export function ConstraintPanel() {
  const { t } = useI18n();
  const { findings, recheck } = useConstraints();

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16, fontSize: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>
          {t("constraints.title")}
        </div>
        <button type="button" onClick={recheck} style={btnStyle}>
          {t("constraints.recheck")}
        </button>
      </div>

      {findings.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
          {t("constraints.noViolations")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {findings.map((f) => (
            <div
              key={f.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 10,
                background: "var(--bg-panel)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: SEVERITY_COLOR[f.severity],
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontWeight: 600, color: "var(--text)" }}>{f.title}</span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 10,
                    color: SEVERITY_COLOR[f.severity],
                  }}
                >
                  {SEVERITY_LABEL[f.severity]}
                </span>
              </div>
              <div style={{ marginTop: 6, color: "var(--text-muted)", lineHeight: 1.5 }}>
                {f.message}
              </div>
              {f.trigger && (
                <div style={{ marginTop: 6, fontSize: 10, color: "var(--text-dim)" }}>
                  {t("constraints.trigger")}：{f.trigger}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
