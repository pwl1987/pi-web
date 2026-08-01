import type { ToolEntry } from "@/lib/tool-presets";
import { BUILTIN_TOOL_NAMES } from "@/lib/tool-presets";
import { PRESET_NONE, PRESET_DEFAULT, PRESET_FULL } from "@/lib/tool-presets";
import { getToolLabel } from "@/lib/tool-labels";
import { useI18n } from "@/hooks/useI18n";
import { PresetChip } from "./PresetChip";
import React from "react";

/** Per-tool checklist panel: built-in tools, extension tools, quick presets. */
export function ToolChecklist({
  tools,
  onChange,
  onPresetApply,
  onClose,
}: {
  tools: ToolEntry[];
  onChange: (tools: ToolEntry[]) => void;
  onPresetApply: (names: string[]) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const builtin = tools.filter((x) => BUILTIN_TOOL_NAMES.has(x.name));
  const extensions = tools.filter((x) => !BUILTIN_TOOL_NAMES.has(x.name));

  const toggle = (name: string) => {
    onChange(tools.map((x) => (x.name === name ? { ...x, active: !x.active } : x)));
  };

  const renderRow = (tool: ToolEntry) => {
    const label = getToolLabel(tool.name, locale);
    const description = label.description || tool.description;
    return (
      <button
        key={tool.name}
        onClick={() => toggle(tool.name)}
        title={description || tool.name}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: tool.active ? "var(--text)" : "var(--text-muted)",
          fontSize: 12,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            flexShrink: 0,
            border: tool.active ? "1px solid var(--accent)" : "1px solid var(--border)",
            background: tool.active ? "var(--accent)" : "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {tool.active && (
            <svg
              width="9"
              height="9"
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
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{tool.name}</span>
        {description && (
          <span
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              marginLeft: "auto",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 120,
            }}
          >
            {description}
          </span>
        )}
      </button>
    );
  };

  return (
    <div style={{ maxHeight: "min(60vh, 460px)", overflowY: "auto" }}>
      {/* Quick presets */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "7px 10px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <PresetChip
          label={t("input.presetAll")}
          title={t("input.toolsFull")}
          onClick={() => {
            onPresetApply(PRESET_FULL);
          }}
        />
        <PresetChip
          label={t("input.presetDefault")}
          title={t("input.toolsDefault")}
          onClick={() => {
            onPresetApply(PRESET_DEFAULT);
          }}
        />
        <PresetChip
          label={t("input.presetNone")}
          title={t("input.toolsNone")}
          onClick={() => {
            onPresetApply(PRESET_NONE);
          }}
        />
      </div>
      {builtin.length > 0 && (
        <>
          <div
            style={{
              padding: "5px 12px 2px",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--text-dim)",
            }}
          >
            {t("input.toolsBuiltin")}
          </div>
          {builtin.map(renderRow)}
        </>
      )}
      {extensions.length > 0 && (
        <>
          <div
            style={{
              padding: "5px 12px 2px",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--text-dim)",
              borderTop: builtin.length > 0 ? "1px solid var(--border)" : "none",
            }}
          >
            {t("input.toolsExtensions")}
          </div>
          {extensions.map(renderRow)}
        </>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "6px 10px",
          borderTop: "1px solid var(--border)",
        }}
      >
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {t("common.done")}
        </button>
      </div>
    </div>
  );
}
