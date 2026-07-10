"use client";

import { useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getPinnedDirsBus } from "@/lib/pinned-dirs-bus";

interface Props {
  /** Working directory to act on. When null, the button renders disabled. */
  cwd: string | null;
  /**
   * Whether the cwd is already pinned. The parent owns the source of
   * truth and should subscribe to the pinned-dirs bus (or react to
   * onPinnedChange) so this reflects updates from other components.
   */
  isPinned: boolean;
  /**
   * Called after a successful POST / DELETE with the new isPinned value
   * (true after pin, false after unpin). Also called with the rollback
   * value when the API rejects, so the parent can keep its state
   * mirror accurate. Parent should typically ignore the value and just
   * refetch on bus emit.
   */
  onPinnedChange: (next: boolean) => void;
}

/**
 * Small icon button next to the cwd picker. Click toggles pin state on
 * the current working directory.
 *
 * Optimistic UI: the parent's `isPinned` is flipped immediately via
 * `onPinnedChange(true|false)` so the button face updates without
 * waiting for the API. If the API rejects, we flip back (rollback)
 * before propagating the next state. The pinned-dirs bus is fired on
 * success so PinnedDirsList and similar viewers re-fetch. Failures
 * (non-2xx or network error) are silent — no throw, just rollback.
 *
 * Contract: see components/PinCurrentDirButton.test.tsx (7 tests).
 */
export function PinCurrentDirButton({ cwd, isPinned, onPinnedChange }: Props) {
  const { t } = useI18n();
  const bus = getPinnedDirsBus();

  const toggle = useCallback(async () => {
    if (!cwd) return;
    const nextIsPinned = !isPinned;
    // Optimistic flip.
    onPinnedChange(nextIsPinned);
    try {
      const res = await fetch("/api/pinned-dirs", {
        method: nextIsPinned ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: cwd }),
      });
      if (!res.ok) {
        // Roll back the optimistic state.
        onPinnedChange(isPinned);
        return;
      }
      // Notify peers (PinnedDirsList etc.) to re-fetch.
      bus.emit();
    } catch {
      // Network error — roll back. The bus emit is suppressed so peers
      // don't think something changed.
      onPinnedChange(isPinned);
    }
  }, [cwd, isPinned, onPinnedChange, bus]);

  const disabled = cwd === null;
  const title = !cwd
    ? ""
    : isPinned
      ? t("sidebar.unpinDir")
      : t("sidebar.pinDir");

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-label={title}
      title={title}
      style={{
        background: "transparent",
        border: "1px solid var(--border)",
        borderRadius: 5,
        padding: "4px 6px",
        color: isPinned ? "var(--accent)" : "var(--text-muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
        transition: "color 0.1s, border-color 0.1s",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLButtonElement).style.color = isPinned
            ? "var(--text)"
            : "var(--accent)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = isPinned
            ? "var(--accent)"
            : "var(--text-muted)";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = isPinned
          ? "var(--accent)"
          : "var(--text-muted)";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
      }}
    >
      {isPinned ? (
        // Solid pin (currently pinned — click to unpin)
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
        </svg>
      ) : (
        // Outline pin (not yet pinned — click to pin)
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
        </svg>
      )}
    </button>
  );
}