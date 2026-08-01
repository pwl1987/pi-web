"use client";

import React from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { ToolEntry } from "@/lib/tool-presets";
import { applyPresetToTools } from "@/lib/tool-presets";
import { ToolChecklist } from "@/components/ToolChecklist";

const TOOL_PRESETS = ["off", "default", "full"] as const;
const TOOL_PRESET_MAP: Record<"off" | "default" | "full", "none" | "default" | "full"> = {
  off: "none",
  default: "default",
  full: "full",
};

export function ToolPresetDropdown({
  tools,
  toolPreset,
  toolsLabel,
  isStreaming,
  controlsMenuOpen,
  dropdownOpen,
  onToolsChange,
  onToolPresetChange,
  onToggle,
  dropdownRef,
  t,
}: {
  tools: ToolEntry[] | undefined;
  toolPreset: "none" | "default" | "full" | undefined;
  toolsLabel: string;
  isStreaming: boolean;
  controlsMenuOpen: boolean;
  dropdownOpen: boolean;
  onToolsChange: ((tools: ToolEntry[]) => void) | undefined;
  onToolPresetChange: ((preset: "none" | "default" | "full") => void) | undefined;
  onToggle: (v: boolean) => void;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const isMobile = useIsMobile();

  return (
    <div ref={dropdownRef} style={{ position: "relative" }}>
      <button
        onClick={() => !isStreaming && onToggle(!dropdownOpen)}
        disabled={isStreaming}
        title={toolsLabel}
        aria-label={toolsLabel}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          padding: isMobile ? "0 6px" : "8px 12px",
          width: isMobile ? "auto" : undefined,
          height: 32,
          background: dropdownOpen ? "var(--bg-hover)" : "none",
          border: "none",
          borderRadius: 9,
          color: "var(--text-muted)",
          cursor: isStreaming ? "not-allowed" : "pointer",
          fontSize: 12,
          opacity: isStreaming ? 0.5 : 1,
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(e) => {
          if (isStreaming) return;
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = dropdownOpen ? "var(--bg-hover)" : "none";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        {(!isMobile || controlsMenuOpen) && (
          <span style={{ whiteSpace: "nowrap" }}>{toolsLabel}</span>
        )}
      </button>
      {dropdownOpen && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            right: 0,
            zIndex: 100,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
            overflow: "hidden",
            minWidth: 200,
            maxWidth: 280,
          }}
        >
          {tools && onToolsChange ? (
            <ToolChecklist
              tools={tools}
              onChange={onToolsChange}
              onPresetApply={(names) => {
                onToolsChange(applyPresetToTools(tools, names));
              }}
              onClose={() => onToggle(false)}
            />
          ) : (
            TOOL_PRESETS.map((lvl) => {
              const preset = TOOL_PRESET_MAP[lvl];
              const isActive = (toolPreset ?? "default") === preset;
              const desc =
                lvl === "off"
                  ? t("input.toolsNone")
                  : lvl === "default"
                    ? t("input.toolsDefault")
                    : t("input.toolsFull");
              return (
                <button
                  key={lvl}
                  onClick={() => {
                    onToggle(false);
                    if (!isActive && onToolPresetChange) onToolPresetChange(preset);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "7px 12px",
                    background: isActive ? "var(--bg-selected)" : "none",
                    border: "none",
                    color: isActive ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    textAlign: "left",
                    fontWeight: isActive ? 600 : 400,
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "none";
                  }}
                >
                  {isActive ? (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ flexShrink: 0 }}
                    >
                      <polyline points="1.5 5 4 7.5 8.5 2.5" />
                    </svg>
                  ) : (
                    <span style={{ width: 10, flexShrink: 0 }} />
                  )}
                  <span style={{ flex: 1 }}>{lvl}</span>
                  <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>
                    {desc}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
