"use client";

import { useEffect, useRef } from "react";

/**
 * Fires `onJump(entryId)` whenever `entryId` transitions to a new non-null
 * string value.
 *
 * Drives the click-to-jump flow:
 *   1. User clicks a task row in InspectorPanel.
 *   2. AppShell sets entryId state to the task's session entryId.
 *   3. This hook detects the transition and calls onJump(entryId).
 *   4. The parent (AppShell) scrolls ChatWindow to that entry, then resets
 *      entryId back to null. Next click → next transition → next jump.
 *
 * Contract (locked by hooks/useScrollToEntry.test.tsx):
 *   - null/undefined on initial mount: no fire.
 *   - null/undefined → string: fire(string).
 *   - stringA → stringB: fire(stringB).
 *   - string → null/undefined: no fire.
 *   - Stable string across re-renders: no additional fire.
 *   - Latest onJump callback is always used (no stale closure).
 *   - Safe to unmount mid-flight.
 *
 * Note: we don't track sessionId here — that's the parent's concern. If the
 * parent wants a "fresh" entryId on session change, it just resets entryId
 * back to null before assigning the new one (or vice versa).
 */
export function useScrollToEntry(
  entryId: string | null | undefined,
  onJump: (entryId: string) => void,
): void {
  // Keep the latest callback in a ref so the effect below doesn't need
  // onJump in its deps — that would re-run the effect on every render of
  // the parent, which would cause spurious fires when onJump is a fresh
  // closure each render (common with inline arrow functions).
  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;

  // Track the last value we fired for, so we only call onJump on actual
  // transitions. Initialized to a sentinel that can never collide with a
  // real entryId.
  const lastFiredRef = useRef<string | null | undefined>(undefined);
  // Mirror entryId into a ref so the effect only re-runs when entryId
  // actually changes (not when onJump changes, see comment above).
  const entryIdRef = useRef(entryId);
  entryIdRef.current = entryId;

  useEffect(() => {
    const current = entryIdRef.current;
    // Skip when entryId is null/undefined, or when it hasn't changed since
    // the last fire (avoids double-fires when the parent re-renders with
    // the same entryId).
    if (!current || current === lastFiredRef.current) return;
    lastFiredRef.current = current;
    onJumpRef.current(current);
    // We deliberately do NOT include onJump in deps — see the ref trick
    // above. eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);
}
