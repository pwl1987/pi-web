"use client";

import { useCallback, type RefObject } from "react";

/**
 * Vim-style keyboard navigation for a list of task buttons.
 *
 * Returns a keydown handler to attach to the LIST CONTAINER. While a
 * button inside the container is focused, pressing:
 *   j / ArrowDown → focus the next non-disabled button
 *   k / ArrowUp   → focus the previous non-disabled button
 *
 * Contract (locked by hooks/useTaskKeyboardNav.test.tsx):
 *  - Skips disabled buttons (button[disabled]).
 *  - Stops at the boundaries (no wrap — j at the last stays, k at the
 *    first stays).
 *  - If no button is currently focused, j goes to the first and k to
 *    the last (sensible entry points).
 *  - Calls preventDefault() on the matching keydown so the page doesn't
 *    scroll (j/k/Arrow keys have default scroll behavior).
 *  - Ignores other keys.
 *  - No-op on an empty / missing container.
 *  - Returns a stable callback so it can sit in a useEffect dep array
 *    without churn.
 *
 * Wired into InspectorPanel via the onKeyDown prop on the task list
 * container (see components/InspectorPanel.tsx). Buttons must be real
 * <button>s so the browser's default focus + Enter/Space behavior works.
 */
export function useTaskKeyboardNav(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean = true,
): (e: React.KeyboardEvent<HTMLElement>) => void {
  return useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (!enabled) return;
      const key = e.key;
      if (key !== "j" && key !== "k" && key !== "ArrowDown" && key !== "ArrowUp") return;

      const container = containerRef.current;
      if (!container) return;

      const buttons = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
      );
      if (buttons.length === 0) return;

      const active = document.activeElement;
      const currentIdx = active instanceof HTMLButtonElement ? buttons.indexOf(active) : -1;

      // If the focus is outside our button list (e.g. on the container
      // itself), pick a sensible entry point.
      let nextIdx: number;
      if (key === "j" || key === "ArrowDown") {
        if (currentIdx < 0) nextIdx = 0;
        else nextIdx = Math.min(currentIdx + 1, buttons.length - 1);
      } else {
        if (currentIdx < 0) nextIdx = buttons.length - 1;
        else nextIdx = Math.max(currentIdx - 1, 0);
      }

      e.preventDefault();
      buttons[nextIdx]?.focus();
    },
    [containerRef, enabled],
  );
}