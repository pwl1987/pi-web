"use client";

import { useEffect } from "react";

/**
 * Global keyboard shortcuts extracted from AppShell (phase 6.3).
 *
 * - Cmd/Ctrl+K toggles the command palette (calls onToggleCommandPalette)
 * - Cmd/Ctrl+J focuses the chat input textarea (looked up by attribute)
 *
 * Keeping these in a dedicated hook shrinks AppShell and makes the shortcut
 * surface easy to audit and test in isolation.
 */
export function useGlobalShortcuts(opts: { onToggleCommandPalette: () => void }): void {
  const { onToggleCommandPalette } = opts;

  // Cmd/Ctrl+K → toggle command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onToggleCommandPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggleCommandPalette]);

  // Ctrl/Cmd+J → focus chat input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "j") {
        e.preventDefault();
        const textarea = document.querySelector<HTMLTextAreaElement>("[data-chat-input-textarea]");
        textarea?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
