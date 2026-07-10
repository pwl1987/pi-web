"use client";

import { useEffect, useState } from "react";
import { getPinnedDirsBus } from "@/lib/pinned-dirs-bus";

/**
 * Tracks whether a given cwd appears in the pinned-dirs list.
 *
 * Fetches `/api/pinned-dirs` on mount and whenever the pinned-dirs bus
 * fires (Pin button, PinnedDirsList unpin, alias edits in other
 * components). Returns `false` while loading or on error — the Pin
 * button renders in its "not pinned" state, which is the safe default
 * (clicking POSTs and the bus re-syncs everyone).
 *
 * Kept separate from PinnedDirsList's own fetch so the two components
 * stay independently testable. The extra GET is cheap (just paths) and
 * the bus keeps them consistent.
 */
export function useIsCwdPinned(cwd: string | null | undefined): boolean {
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!cwd) {
        setIsPinned(false);
        return;
      }
      try {
        const res = await fetch("/api/pinned-dirs");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { pinnedDirs?: { path: string }[] };
        if (cancelled) return;
        setIsPinned((data.pinnedDirs ?? []).some((d) => d.path === cwd));
      } catch {
        if (!cancelled) setIsPinned(false);
      }
    };
    void check();
    const bus = getPinnedDirsBus();
    const off = bus.subscribe(() => { void check(); });
    return () => {
      cancelled = true;
      off();
    };
  }, [cwd]);

  return isPinned;
}