/**
 * Switch 控件 — boolean 字段。
 * ponytail: 与现有 PluginConfigPage 的 ToggleField 风格保持一致（inline css var）。
 */

"use client";

interface SwitchProps {
  value: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}

export function Switch({ value, onChange, ariaLabel }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
      onClick={() => onChange(!value)}
      style={{
        width: 40,
        height: 22,
        borderRadius: 11,
        border: "none",
        padding: 0,
        cursor: "pointer",
        background: value ? "var(--accent)" : "var(--border)",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: value ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "var(--bg-panel)",
          transition: "left 0.12s",
        }}
      />
    </button>
  );
}
