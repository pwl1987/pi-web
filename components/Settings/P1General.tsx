/**
 * P1General — 通用设置面板（语言、主题、声音）。
 * ponytail: P1 阶段保留现有 SettingsPanel.tsx 实现，本组件留作占位升级入口。
 */

"use client";

export function P1General() {
  return (
    <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12 }}>
      通用设置 — 由现有 components/SettingsPanel.tsx 承载，本组件为拆分占位。
    </div>
  );
}
