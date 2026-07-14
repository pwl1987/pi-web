"use client";

import React from "react";
import { useIsMobile } from "@/hooks/useIsMobile";

export const THINKING_LEVELS = [
  "auto",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const THINKING_LEVEL_DESC: Record<ThinkingLevel, string> = {
  auto: "thinking.auto",
  off: "thinking.off",
  minimal: "thinking.minimal",
  low: "thinking.low",
  medium: "thinking.medium",
  high: "thinking.high",
  xhigh: "thinking.xhigh",
};

export function ThinkingLevelDropdown({
  thinkingLevel,
  dropdownOpen,
  thinkingDisplayLabel,
  availableThinkingLevels,
  thinkingLevelMap,
  isStreaming,
  controlsMenuOpen,
  onThinkingLevelChange,
  onToggle,
  dropdownRef,
  t,
}: {
  thinkingLevel: ThinkingLevel | undefined;
  dropdownOpen: boolean;
  thinkingDisplayLabel: string;
  availableThinkingLevels: string[] | null | undefined;
  thinkingLevelMap: Record<string, string | null> | null | undefined;
  isStreaming: boolean;
  controlsMenuOpen: boolean;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
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
        title={t("input.changeReasoning", { level: thinkingDisplayLabel })}
        aria-label={t("input.changeReasoning", { level: thinkingDisplayLabel })}
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
          <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
          <line x1="7" y1="18" x2="12" y2="18" />
          <line x1="8" y1="21" x2="11" y2="21" />
        </svg>
        {(!isMobile || controlsMenuOpen) && (
          <span style={{ whiteSpace: "nowrap" }}>{thinkingDisplayLabel}</span>
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
            minWidth: 180,
          }}
        >
          {THINKING_LEVELS.filter((lvl) => {
            if (!availableThinkingLevels) return true;
            if (lvl === "auto") return true;
            return availableThinkingLevels.includes(lvl);
          }).map((lvl) => {
            const isActive = (thinkingLevel ?? "auto") === lvl;
            const desc = t(THINKING_LEVEL_DESC[lvl]);
            const mappedVal =
              lvl !== "auto" && thinkingLevelMap ? thinkingLevelMap[lvl] : undefined;
            const displayLabel = mappedVal != null && mappedVal !== lvl ? mappedVal : lvl;
            const showOriginal = mappedVal != null && mappedVal !== lvl;
            return (
              <button
                key={lvl}
                onClick={() => {
                  onToggle(false);
                  if (!isActive) onThinkingLevelChange(lvl);
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
                <span style={{ flex: 1 }}>
                  {displayLabel}
                  {showOriginal && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--text-dim)",
                        fontFamily: "var(--font-mono)",
                        marginLeft: 5,
                      }}
                    >
                      ({lvl})
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>
                  {desc}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
