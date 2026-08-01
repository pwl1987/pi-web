"use client";

import React from "react";
import type { FileIndexEntry } from "@/lib/file-fuzzy";
import { FolderIcon, getFileIcon } from "../FileIcons";

export function AtFilePanel({
  atQuery,
  atMatches,
  atActiveIndex,
  atItemRefs,
  fileIndexLoading,
  fileIndex,
  cwd,
  needsServerSearch,
  serverResultInUse,
  applyAtCompletion,
  setAtActiveIndex,
  t,
}: {
  atQuery: { start: number; quoted: boolean; query: string } | null;
  atMatches: FileIndexEntry[];
  atActiveIndex: number;
  atItemRefs: React.RefObject<Array<HTMLButtonElement | null> | null>;
  fileIndexLoading: boolean;
  fileIndex: { cwd: string } | null;
  cwd: string | null | undefined;
  needsServerSearch: boolean;
  serverResultInUse: boolean;
  applyAtCompletion: (entry: FileIndexEntry) => void;
  setAtActiveIndex: (i: number) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  if (atQuery === null) return null;

  const indexLoading = fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd);
  const matchCountLabel =
    atMatches.length === 1
      ? t("input.oneMatch")
      : t("input.countMatches", { count: atMatches.length });
  const truncatedHint =
    fileIndex &&
    "truncated" in fileIndex &&
    (fileIndex as { truncated?: boolean }).truncated &&
    !serverResultInUse
      ? atQuery.query
        ? t("input.searchingAllFiles")
        : t("input.indexTruncated")
      : "";

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
        maxHeight: "min(48vh, 400px)",
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
          {indexLoading
            ? t("input.loadingFiles")
            : t("input.filesCount", { label: `${matchCountLabel}${truncatedHint}` })}
        </span>
        <span style={{ fontFamily: "var(--font-mono)" }}>Tab / Enter</span>
      </div>
      <div
        style={{
          maxHeight: "calc(min(48vh, 400px) - 34px)",
          overflowY: "auto",
          padding: 4,
        }}
      >
        {!indexLoading && atMatches.length === 0 ? (
          <div style={{ padding: "6px 8px", fontSize: 12, color: "var(--text-dim)" }}>
            {needsServerSearch && !serverResultInUse ? "Searching…" : "No matching files"}
          </div>
        ) : (
          atMatches.map((entry, index) => {
            const active = index === atActiveIndex;
            const name = entry.path.split("/").pop() ?? entry.path;
            const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
            return (
              <button
                key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                ref={(node) => {
                  if (atItemRefs.current) atItemRefs.current[index] = node;
                }}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyAtCompletion(entry);
                }}
                onMouseEnter={() => setAtActiveIndex(index)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  border: "none",
                  borderRadius: 6,
                  background: active ? "var(--bg-selected)" : "none",
                  color: "var(--text)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 12.5,
                  fontFamily: "var(--font-mono)",
                }}
              >
                <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                  {entry.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}
                </span>
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {dirPrefix && <span style={{ color: "var(--text-dim)" }}>{dirPrefix}</span>}
                  {name}
                  {entry.isDir && <span style={{ color: "var(--text-dim)" }}>/</span>}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
