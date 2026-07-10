// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScrollToEntry } from "./useScrollToEntry";

/**
 * useScrollToEntry contract:
 *
 *   useScrollToEntry(entryId, onJump)
 *
 *   - Fires onJump(entryId) when entryId transitions from null/undefined
 *     to a string, OR from one string to another.
 *   - Does NOT fire when entryId stays null/undefined.
 *   - Does NOT fire again while entryId stays at the same string across
 *     re-renders.
 *   - Does NOT throw on unmount.
 *
 * Driven by the click-to-jump flow in AppShell: user clicks task row →
 * AppShell sets entryId → hook fires onJump → ChatWindow scrolls → AppShell
 * resets entryId to null (next click will fire again).
 */
describe("useScrollToEntry", () => {
  it("does not fire on initial mount with entryId=null", () => {
    const onJump = vi.fn();
    renderHook(() => useScrollToEntry(null, onJump));
    expect(onJump).not.toHaveBeenCalled();
  });

  it("does not fire on initial mount with entryId=undefined", () => {
    const onJump = vi.fn();
    renderHook(() => useScrollToEntry(undefined, onJump));
    expect(onJump).not.toHaveBeenCalled();
  });

  it("fires onJump when entryId transitions from null to a string", () => {
    const onJump = vi.fn();
    const { rerender } = renderHook(
      ({ entryId }) => useScrollToEntry(entryId, onJump),
      { initialProps: { entryId: null as string | null } },
    );
    rerender({ entryId: "entry-aaa" });
    expect(onJump).toHaveBeenCalledExactlyOnceWith("entry-aaa");
  });

  it("fires onJump when entryId transitions from undefined to a string", () => {
    const onJump = vi.fn();
    const { rerender } = renderHook(
      ({ entryId }: { entryId: string | null | undefined }) => useScrollToEntry(entryId, onJump),
      { initialProps: { entryId: undefined as string | null | undefined } },
    );
    rerender({ entryId: "entry-bbb" });
    expect(onJump).toHaveBeenCalledExactlyOnceWith("entry-bbb");
  });

  it("fires onJump again when entryId transitions between different strings", () => {
    const onJump = vi.fn();
    const { rerender } = renderHook(
      ({ entryId }: { entryId: string | null }) => useScrollToEntry(entryId, onJump),
      { initialProps: { entryId: "first" } },
    );
    expect(onJump).toHaveBeenCalledExactlyOnceWith("first");
    rerender({ entryId: "second" });
    expect(onJump).toHaveBeenCalledTimes(2);
    expect(onJump).toHaveBeenLastCalledWith("second");
  });

  it("does NOT fire onJump when entryId stays at the same string across re-renders", () => {
    const onJump = vi.fn();
    const { rerender } = renderHook(
      ({ entryId }: { entryId: string | null }) => useScrollToEntry(entryId, onJump),
      { initialProps: { entryId: "stable" } },
    );
    // First render fired it (because we went from "no prior value" to "stable").
    // After that, additional renders at the same value should not refire.
    expect(onJump).toHaveBeenCalledTimes(1);
    rerender({ entryId: "stable" });
    rerender({ entryId: "stable" });
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire onJump when entryId transitions to null", () => {
    const onJump = vi.fn();
    const { rerender } = renderHook(
      ({ entryId }: { entryId: string | null | undefined }) => useScrollToEntry(entryId, onJump),
      { initialProps: { entryId: "abc" } as { entryId: string | null | undefined } },
    );
    expect(onJump).toHaveBeenCalledTimes(1);
    rerender({ entryId: null });
    expect(onJump).toHaveBeenCalledTimes(1); // no additional call
  });

  it("does NOT fire onJump when entryId transitions to undefined", () => {
    const onJump = vi.fn();
    const { rerender } = renderHook(
      ({ entryId }: { entryId: string | null | undefined }) =>
        useScrollToEntry(entryId, onJump),
      { initialProps: { entryId: "abc" } as { entryId: string | null | undefined } },
    );
    expect(onJump).toHaveBeenCalledTimes(1);
    rerender({ entryId: undefined });
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("fires onJump on the next non-null entryId after a null cycle (e.g. clear-and-reclick)", () => {
    const onJump = vi.fn();
    const { rerender } = renderHook(
      ({ entryId }: { entryId: string | null | undefined }) => useScrollToEntry(entryId, onJump),
      { initialProps: { entryId: "first" } as { entryId: string | null | undefined } },
    );
    expect(onJump).toHaveBeenCalledTimes(1);
    rerender({ entryId: null });
    rerender({ entryId: "second" });
    expect(onJump).toHaveBeenCalledTimes(2);
    expect(onJump).toHaveBeenLastCalledWith("second");
  });

  it("uses the latest onJump callback when entryId changes (no stale closure)", () => {
    const onJump1 = vi.fn();
    const onJump2 = vi.fn();
    const { rerender } = renderHook(
      ({ entryId, cb }: { entryId: string | null; cb: (e: string) => void }) =>
        useScrollToEntry(entryId, cb),
      { initialProps: { entryId: "first" as string | null, cb: onJump1 } },
    );
    rerender({ entryId: null, cb: onJump1 });
    // Swap callback while entryId is null — should not fire (no transition yet).
    rerender({ entryId: null, cb: onJump2 });
    expect(onJump2).not.toHaveBeenCalled();
    // Now transition to a new string — must use the LATEST callback (onJump2).
    rerender({ entryId: "second", cb: onJump2 });
    expect(onJump2).toHaveBeenCalledExactlyOnceWith("second");
    expect(onJump1).toHaveBeenCalledExactlyOnceWith("first"); // unchanged
  });

  it("does not throw on unmount with pending work", () => {
    const onJump = vi.fn();
    const { unmount } = renderHook(
      ({ entryId }: { entryId: string | null }) => useScrollToEntry(entryId, onJump),
      { initialProps: { entryId: "never-fired" } },
    );
    // entryId was set, but unmounting before the effect runs must not throw.
    // (The latest useEffect would call onJump; we expect unmount to swallow it.)
    expect(() => unmount()).not.toThrow();
    // We don't assert onJump's call count here because React batches
    // effects and the unmount may happen before/after the effect fired —
    // what matters is that the unmount itself is safe.
  });
});