/**
 * Thin wrapper around HTMLElement.scrollIntoView, with a transient
 * "highlight" affordance for click-to-jump feedback.
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
 *  - Adds a 'scroll-highlight' class so the user sees a brief visual
 *    ring around the scrolled-into message. The class is removed after
 *    HIGHLIGHT_DURATION_MS.
 *  - No-op when element is null/undefined (defensive — callers can pass
 *    a possibly-missing ref without checking first).
 */
export const SCROLL_HIGHLIGHT_CLASS = "scroll-highlight";
export const SCROLL_HIGHLIGHT_DURATION_MS = 1500;

// Track per-element highlight-removal timers so back-to-back scrolls on
// the same element keep the highlight class until activity stops. The
// WeakMap means the timer dies naturally when the element is GC'd.
const highlightTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function scrollIntoView(element: HTMLElement | null | undefined): void {
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  // Brief highlight ring so the user can see WHERE the click landed.
  // Cancel any in-flight removal from a previous scroll on this element
  // so the ring stays visible while activity is ongoing.
  const existing = highlightTimers.get(element);
  if (existing) clearTimeout(existing);
  element.classList.add(SCROLL_HIGHLIGHT_CLASS);
  const t = setTimeout(() => {
    element.classList.remove(SCROLL_HIGHLIGHT_CLASS);
    highlightTimers.delete(element);
  }, SCROLL_HIGHLIGHT_DURATION_MS);
  highlightTimers.set(element, t);
}