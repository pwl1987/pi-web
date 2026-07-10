"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { ExtensionRuntimeContext, QualifiedAction } from "@/lib/extensions/types";

interface Props {
  open: boolean;
  onClose: () => void;
  actions: QualifiedAction[];
  getDisabledReason: (action: QualifiedAction, ctx: ExtensionRuntimeContext) => string | undefined;
  context: ExtensionRuntimeContext;
}

/** Cmd+K command palette — shows extension actions with search and keyboard nav. */
export function CommandPalette({ open, onClose, actions, getDisabledReason, context }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter actions by search query.
  const filtered = useMemo(() => {
    if (!query.trim()) return actions;
    const q = query.toLowerCase();
    return actions.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q),
    );
  }, [actions, query]);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Focus input after render.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clamp active index when filtered list changes.
  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length, activeIndex]);

  if (!open) return null;

  const execute = (action: QualifiedAction) => {
    const reason = getDisabledReason(action, context);
    if (reason) return; // disabled
    void action.run(context);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = filtered[activeIndex];
      if (action) execute(action);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "min(560px, calc(100vw - 32px))",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "60vh",
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search commands…"
          style={{
            width: "100%",
            padding: "12px 16px",
            background: "none",
            border: "none",
            borderBottom: "1px solid var(--border)",
            outline: "none",
            color: "var(--text)",
            fontSize: 15,
            fontFamily: "inherit",
          }}
        />
        <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: 4 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "16px", color: "var(--text-dim)", fontSize: 13, textAlign: "center" }}>
              No commands found
            </div>
          ) : (
            filtered.map((action, i) => {
              const disabledReason = getDisabledReason(action, context);
              const isActive = i === activeIndex;
              return (
                <button
                  key={action.qualifiedId}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => execute(action)}
                  disabled={!!disabledReason}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    width: "100%",
                    padding: "8px 12px",
                    background: isActive ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: 6,
                    cursor: disabledReason ? "default" : "pointer",
                    textAlign: "left",
                    opacity: disabledReason ? 0.5 : 1,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
                    {action.title}
                  </span>
                  {action.description && (
                    <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                      {disabledReason ?? action.description}
                    </span>
                  )}
                  {!action.description && disabledReason && (
                    <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{disabledReason}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
