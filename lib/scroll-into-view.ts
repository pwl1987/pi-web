/**
 * Thin wrapper around HTMLElement.scrollIntoView.
 *
 * Two reasons this exists as a separate module:
 *  1. Single seam for testing — components that scroll can import this
 *     and tests can mock it, instead of every test mocking
 *     HTMLElement.prototype.scrollIntoView globally.
 *  2. Centralized scroll policy — if we ever want to swap smooth for
 *     instant, add focus(), respect reduced-motion, or use a polyfill,
 *     it's one place to change.
 *
 * Contract (locked by lib/scroll-into-view.test.ts):
 *  - Calls element.scrollIntoView({ behavior: "smooth", block: "center" })
 *  - No-op when element is null/undefined (defensive — callers can pass
 *    a possibly-missing ref without checking first).
 */
export function scrollIntoView(element: HTMLElement | null | undefined): void {
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
}