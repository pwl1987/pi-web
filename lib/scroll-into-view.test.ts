import { describe, it, expect, vi } from "vitest";
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
describe("scrollIntoView", () => {
  it("calls native scrollIntoView with smooth + center options", () => {
    const native = vi.fn();
    const el = { scrollIntoView: native } as unknown as HTMLElement;
    scrollIntoView(el);
    expect(native).toHaveBeenCalledTimes(1);
    expect(native).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("does not throw or scroll when element is null", () => {
    expect(() => scrollIntoView(null)).not.toThrow();
  });

  it("does not throw or scroll when element is undefined", () => {
    expect(() => scrollIntoView(undefined)).not.toThrow();
  });

  it("does nothing extra on the element (no other property mutations)", () => {
    // We pass a minimal mock. The wrapper should ONLY call scrollIntoView
    // — no surprise mutations. If we ever add focus(), focus rings will
    // appear, breaking this test, which is intentional.
    const native = vi.fn();
    const el = { scrollIntoView: native } as unknown as HTMLElement;
    scrollIntoView(el);
    // Only one method should be invoked.
    expect(native).toHaveBeenCalledTimes(1);
  });
});