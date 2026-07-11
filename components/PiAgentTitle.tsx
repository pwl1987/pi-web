"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useScramble } from "@/hooks/useScramble";

/**
 * Sidebar title that displays "Pi Agent Web" normally,
 * and reveals the version string via a scramble animation on click.
 */
export function PiAgentTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const [scrambling, setScrambling] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = showVersion
    ? `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}p${process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}`
    : "Pi Agent Web";
  const display = useScramble(target, scrambling);

  // Scramble animation duration: charCount × 4 frames/char × frame interval (~16.67ms) + 100ms buffer
  const SCRAMBLE_FRAME_MS = 1000 / 60;
  const SCRAMBLE_BUFFER_MS = 100;
  const VERSION_CHAR_COUNT = 6;
  const TITLE_CHAR_COUNT = 8;

  const triggerScramble = useCallback((toVersion: boolean) => {
    setShowVersion(toVersion);
    setScrambling(true);
    const charCount = toVersion ? VERSION_CHAR_COUNT : TITLE_CHAR_COUNT;
    setTimeout(() => setScrambling(false), charCount * 4 * SCRAMBLE_FRAME_MS + SCRAMBLE_BUFFER_MS);
  }, []);

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

    setShowVersion((prev) => {
      const next = !prev;
      triggerScramble(next);
      if (next) {
        revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
      }
      return next;
    });
  }, [triggerScramble]);

  useEffect(
    () => () => {
      if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    },
    [],
  );

  return (
    <button
      onClick={handleClick}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: "default",
        fontWeight: 700,
        fontSize: 15,
        letterSpacing: "-0.01em",
        color: showVersion ? "var(--accent)" : "var(--text)",
        fontFamily: "var(--font-mono)",
        minWidth: "6ch",
      }}
    >
      {display}
    </button>
  );
}
