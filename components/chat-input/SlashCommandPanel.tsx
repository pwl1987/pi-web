"use client";

import React from "react";
import type { SlashCommandPaletteItem, SlashCommandSource } from "@/lib/slash-commands";
import { SLASH_SOURCE_GROUP_LABEL } from "@/lib/slash-commands";

interface SlashCommandsGroup {
  source: SlashCommandSource;
  items: Array<{ command: SlashCommandPaletteItem; index: number }>;
}

export function SlashCommandPanel({
  slashQuery,
  groupedSlashCommands,
  slashActiveIndex,
  slashItemRefs,
  slashCommandsLoading,
  slashCommandCountLabel,
  filteredCount,
  applySlashCommand,
  setSlashActiveIndex,
  t,
}: {
  slashQuery: string | null;
  groupedSlashCommands: SlashCommandsGroup[];
  slashActiveIndex: number;
  slashItemRefs: React.RefObject<Array<HTMLButtonElement | null> | null>;
  slashCommandsLoading: boolean | undefined;
  slashCommandCountLabel: string;
  filteredCount: number;
  applySlashCommand: (cmd: SlashCommandPaletteItem) => void;
  setSlashActiveIndex: (i: number) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  if (slashQuery === null) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 120,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 -6px 20px rgba(0,0,0,0.12)",
        overflow: "hidden",
        maxHeight: "min(56vh, 460px)",
      }}
    >
      <div
        style={{
          padding: "8px 10px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 11,
          color: "var(--text-dim)",
        }}
      >
        <span>
          {slashCommandsLoading
            ? t("input.loadingCommands")
            : t("input.slashCommandsCount", { label: slashCommandCountLabel })}
        </span>
        <span style={{ fontFamily: "var(--font-mono)" }}>Tab / Enter</span>
      </div>
      <div
        style={{
          maxHeight: "calc(min(56vh, 460px) - 34px)",
          overflowY: "auto",
          padding: 10,
        }}
      >
        {!slashCommandsLoading && filteredCount === 0 ? (
          <div style={{ padding: "2px 2px 4px", fontSize: 12, color: "var(--text-dim)" }}>
            {t("input.noSlashCommands")}
          </div>
        ) : (
          groupedSlashCommands.map((group) => (
            <section key={group.source} style={{ marginBottom: 12 }}>
              <div
                style={{
                  position: "sticky",
                  top: -10,
                  zIndex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "4px 0 6px",
                  background: "var(--bg)",
                  color: "var(--text-dim)",
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                <span>{t(SLASH_SOURCE_GROUP_LABEL[group.source])}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>
                  {group.items.length}
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 8,
                }}
              >
                {group.items.map(({ command, index }) => {
                  const active = index === slashActiveIndex;
                  return (
                    <button
                      key={`${command.source}:${command.name}`}
                      ref={(node) => {
                        if (slashItemRefs.current) slashItemRefs.current[index] = node;
                      }}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applySlashCommand(command);
                      }}
                      onMouseEnter={() => setSlashActiveIndex(index)}
                      style={{
                        width: "100%",
                        minWidth: 0,
                        minHeight: 58,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        justifyContent: "center",
                        padding: "9px 10px",
                        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                        borderRadius: 7,
                        background: active ? "var(--bg-selected)" : "var(--bg-panel)",
                        color: "var(--text)",
                        cursor: "pointer",
                        textAlign: "left",
                        boxShadow: active
                          ? "0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent)"
                          : "none",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontFamily: "var(--font-mono)",
                          overflowWrap: "anywhere",
                          wordBreak: "break-word",
                        }}
                      >
                        /{command.name}
                      </span>
                      {command.description && (
                        <span
                          style={{
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: 2,
                            overflow: "hidden",
                            fontSize: 11,
                            lineHeight: 1.35,
                            color: "var(--text-dim)",
                          }}
                        >
                          {command.description}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
