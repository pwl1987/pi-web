"use client";

import { useRef } from "react";

/** CSS class added on click for a brief visual confirmation. */
export const TASK_ROW_CLICKED_CLASS = "task-row-clicked";
/** How long the click feedback class stays applied (matches CSS animation duration). */
export const TASK_ROW_CLICK_FEEDBACK_MS = 300;

/**
 * One row in the InspectorPanel task list.
 *
 * Extracted from InspectorPanel.tsx so the click-to-jump behavior can be
 * unit-tested in isolation (no need to render the whole panel + fetch mocks).
 *
 * Behavior:
 * - If `entryId` is provided, the row renders as a button and calls
 *   `onTaskClick(entryId)` on click. This is the "click-to-jump" affordance.
 * - If `entryId` is missing (e.g. older session whose todo tool-result
 *   didn't include the mapping), the row still renders but clicking does
 *   nothing — graceful no-op rather than an error.
 */

interface TodoTaskLike {
  id: number;
  subject: string;
  status?: string;
  activeForm?: string;
}

export interface InspectorTaskRowProps {
  task: TodoTaskLike;
  variant: "active" | "pending" | "done";
  /** Latest session entryId that mentions this task; undefined = no-op click. */
  entryId: string | undefined;
  /** Called with `entryId` when the row is clicked. Ignored if entryId is undefined. */
  onTaskClick: (entryId: string) => void;
}

export function InspectorTaskRow({ task, variant, entryId, onTaskClick }: InspectorTaskRowProps) {
  const clickable = entryId !== undefined;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const handleClick = clickable
    ? () => {
        onTaskClick(entryId!);
        // Brief CSS-driven feedback so the user sees "click registered"
        // before the chat scroll lands. The class is added on click and
        // removed after TASK_ROW_CLICK_FEEDBACK_MS via a setTimeout.
        const btn = buttonRef.current;
        if (btn) {
          btn.classList.add(TASK_ROW_CLICKED_CLASS);
          setTimeout(() => {
            btn.classList.remove(TASK_ROW_CLICKED_CLASS);
          }, TASK_ROW_CLICK_FEEDBACK_MS);
        }
      }
    : undefined;

  // Right-click copies the task subject to clipboard. Suppresses the
  // browser's native context menu so we own the gesture end-to-end.
  const handleContextMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!clickable) return;
    e.preventDefault();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(task.subject);
    }
  };

  const statusDot = (
    <span
      style={{
        width: 14,
        height: 14,
        borderRadius: "50%",
        flexShrink: 0,
        marginTop: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...(variant === "done"
          ? { background: "var(--git-added)", border: "none" }
          : variant === "active"
            ? { background: "var(--accent)", border: "2px solid var(--accent)" }
            : { background: "none", border: "2px solid var(--border)" }),
      }}
    >
      {variant === "done" && (
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="var(--bg)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1.5 5 4 7.5 8.5 2.5" />
        </svg>
      )}
      {variant === "active" && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "var(--bg)",
            animation: "inspector-pulse 1.5s ease-in-out infinite",
          }}
        />
      )}
    </span>
  );

  const content = (
    <>
      {statusDot}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.35,
            color: variant === "done" ? "var(--text-dim)" : "var(--text)",
            textDecoration: variant === "done" ? "line-through" : "none",
            wordBreak: "break-word",
          }}
        >
          {task.subject}
        </div>
        {task.activeForm && variant === "active" && (
          <div style={{ fontSize: 10, color: "var(--accent)", fontStyle: "italic", marginTop: 1 }}>
            ⟳ {task.activeForm}
          </div>
        )}
      </div>
    </>
  );

  // Always render a <button> — accessibility, consistent layout, easier
  // testing. When entryId is missing, disable the button so click is a
  // no-op and the cursor reflects the state.
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      disabled={!clickable}
      title={entryId ? `Jump to ${task.subject}` : undefined}
      style={{
        all: "unset",
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "4px 14px",
        width: "100%",
        cursor: clickable ? "pointer" : "default",
        opacity: clickable ? 1 : 0.6,
        borderRadius: 4,
        transition: "background 0.1s, opacity 0.1s",
      }}
      onMouseEnter={(e) => {
        if (clickable) (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {content}
    </button>
  );
}