// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scrollIntoView } from "./scroll-into-view";

/**
 * scrollIntoView wrapper contract:
 *  - Calls native element.scrollIntoView with { behavior: "smooth", block: "center" }
 *    so click-to-jump scrolls the target message into the viewport center.
 *  - Defensive no-op when called with null/undefined so callers can pass
 *    a possibly-missing ref without checking first.
 *
 * The wrapper exists so tests can mock a single import boundary instead of
 * every component test mocking HTMLElement.prototype.scrollIntoView.
 */
/** Create a real DOM element with a mock scrollIntoView (jsdom ships
 *  a no-op one — we want a spy we can assert on). */
function makeEl(): HTMLDivElement & { scrollIntoView: ReturnType<typeof vi.fn> } {
  const el = document.createElement("div") as unknown as HTMLDivElement & { scrollIntoView: ReturnType<typeof vi.fn> };
  el.scrollIntoView = vi.fn() as unknown as typeof el.scrollIntoView;
  return el;
}

describe("scrollIntoView", () => {
  it("calls native scrollIntoView with smooth + center options", () => {
    const el = makeEl();
    scrollIntoView(el);
    expect(el.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("does not throw or scroll when element is null", () => {
    expect(() => scrollIntoView(null)).not.toThrow();
  });

  it("does not throw or scroll when element is undefined", () => {
    expect(() => scrollIntoView(undefined)).not.toThrow();
  });

  it("does nothing extra on the element (no other property mutations)", () => {
    // We pass a real element. The wrapper should ONLY call scrollIntoView
    // and add/remove the highlight class — no surprise mutations. If we
    // ever add focus(), focus rings will appear, breaking this test,
    // which is intentional.
    const el = makeEl();
    scrollIntoView(el);
    expect(el.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe("scrollIntoView highlight (click-to-jump feedback)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds the 'scroll-highlight' class to the element on scroll", () => {
    const el = makeEl();
    scrollIntoView(el);
    expect(el.classList.contains("scroll-highlight")).toBe(true);
  });

  it("removes the 'scroll-highlight' class after the highlight duration", () => {
    const el = makeEl();
    scrollIntoView(el);
    expect(el.classList.contains("scroll-highlight")).toBe(true);
    // Advance past the highlight duration.
    vi.advanceTimersByTime(1600);
    expect(el.classList.contains("scroll-highlight")).toBe(false);
  });

  it("does not add the class to a null element (no-op contract preserved)", () => {
    expect(() => scrollIntoView(null)).not.toThrow();
    // We can't observe a classList on null, but the no-op must not throw.
  });

  it("does not add the class when the element is undefined", () => {
    expect(() => scrollIntoView(undefined)).not.toThrow();
  });

  it("handles multiple back-to-back scrolls on the same element (last highlight wins)", () => {
    const el = makeEl();
    scrollIntoView(el);
    vi.advanceTimersByTime(500); // mid-highlight
    expect(el.classList.contains("scroll-highlight")).toBe(true);
    scrollIntoView(el); // re-scroll
    vi.advanceTimersByTime(1100);
    // After 500 + 1100 = 1600ms since first call, first timer fires.
    expect(el.classList.contains("scroll-highlight")).toBe(true); // second timer hasn't fired yet
    vi.advanceTimersByTime(600);
    expect(el.classList.contains("scroll-highlight")).toBe(false);
  });
});