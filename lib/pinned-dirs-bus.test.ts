import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPinnedDirsBus } from "./pinned-dirs-bus";

describe("pinned-dirs bus", () => {
  beforeEach(() => {
    // Reset the global singleton between tests so listener state is fresh.
    delete (globalThis as { __piWebPinnedDirsBus?: unknown }).__piWebPinnedDirsBus;
  });

  it("returns the same instance on repeated calls (singleton)", () => {
    const a = getPinnedDirsBus();
    const b = getPinnedDirsBus();
    expect(a).toBe(b);
  });

  it("notifies subscribers on emit", () => {
    const bus = getPinnedDirsBus();
    const cb = vi.fn();
    const off = bus.subscribe(cb);
    bus.emit();
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it("stops notifying after unsubscribe", () => {
    const bus = getPinnedDirsBus();
    const cb = vi.fn();
    const off = bus.subscribe(cb);
    bus.emit();
    off();
    bus.emit();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("supports multiple independent subscribers", () => {
    const bus = getPinnedDirsBus();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    bus.subscribe(cb1); // stay subscribed
    const off2 = bus.subscribe(cb2);
    bus.emit();
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
    off2();
    bus.emit();
    expect(cb1).toHaveBeenCalledTimes(2);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("does not throw if a subscriber throws", () => {
    const bus = getPinnedDirsBus();
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    bus.subscribe(bad); // stay subscribed
    bus.subscribe(good);
    expect(() => bus.emit()).not.toThrow();
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });
});
