// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePersistentState } from "./usePersistentState";

/**
 * usePersistentState contract pinned by these tests:
 *   1. getSnapshot must return the SAME reference across rerenders when
 *      storage is unchanged — otherwise useSyncExternalStore throws
 *      "The result of getSnapshot should be cached to avoid an infinite loop".
 *   2. Writes must invalidate the cached reference so React sees the change.
 *   3. Functional updater must read the latest persisted value, not a stale
 *      closure of `defaultValue`.
 *   4. Missing/invalid storage falls back to the default.
 */

describe("usePersistentState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns referentially equal values across rerenders when storage is unchanged", () => {
    window.localStorage.setItem("__piPersistent:file-tabs", JSON.stringify([{ id: "a" }]));
    const { result, rerender } = renderHook(() =>
      usePersistentState<Array<{ id: string }>>("file-tabs", []),
    );
    const first = result.current[0];
    rerender();
    const second = result.current[0];
    // Without the snapshot cache, JSON.parse produces a fresh array each call
    // and this assertion fails — triggering React's infinite-loop warning.
    expect(second).toBe(first);
  });

  it("yields a fresh reference only after setValue writes a different value", () => {
    const { result } = renderHook(() => usePersistentState<Array<{ id: string }>>("file-tabs", []));
    const before = result.current[0];
    act(() => {
      result.current[1]([{ id: "new" }]);
    });
    const after = result.current[0];
    expect(after).not.toBe(before);
    expect(after).toEqual([{ id: "new" }]);
    // The cache must key on raw string: writing the identical JSON again
    // does not produce yet another reference.
    const cachedRef = after;
    act(() => {
      result.current[1]([{ id: "new" }]);
    });
    expect(result.current[0]).toBe(cachedRef);
  });

  it("falls back to the default when storage is empty", () => {
    const { result } = renderHook(() => usePersistentState<boolean>("flag", true));
    expect(result.current[0]).toBe(true);
  });

  it("returns a stable reference for the default value across rerenders when storage is empty", () => {
    // Regression: previously the hook reassigned defaultRef.current = defaultValue
    // on every render, so when a caller passed `[]` (a fresh literal each render)
    // the snapshot's identity churned and any useEffect that depended on it
    // re-fired forever — AppShell.tsx's "reconcile persisted UI state" effect
    // hit "Maximum update depth exceeded" because of this.
    const { result, rerender } = renderHook(() =>
      usePersistentState<Array<{ id: string }>>("items", []),
    );
    const first = result.current[0];
    rerender();
    const second = result.current[0];
    rerender();
    const third = result.current[0];
    expect(second).toBe(first);
    expect(third).toBe(second);
  });

  it("returns the default when storage holds invalid JSON", () => {
    window.localStorage.setItem("__piPersistent:broken", "not-json{");
    const { result } = renderHook(() => usePersistentState<string>("broken", "fallback"));
    expect(result.current[0]).toBe("fallback");
  });

  it("functional updater reads from storage, not from the defaultRef closure", () => {
    window.localStorage.setItem("__piPersistent:counter", "1");
    const { result } = renderHook(() => usePersistentState<number>("counter", 0));
    expect(result.current[0]).toBe(1);
    act(() => {
      result.current[1]((prev) => prev + 1);
    });
    expect(result.current[0]).toBe(2);
    expect(JSON.parse(window.localStorage.getItem("__piPersistent:counter")!)).toBe(2);
  });

  it("multiple subscribers for the same key stay in sync", () => {
    const a = renderHook(() => usePersistentState<string>("shared", "init"));
    const b = renderHook(() => usePersistentState<string>("shared", "init"));
    act(() => {
      a.result.current[1]("updated");
    });
    expect(b.result.current[0]).toBe("updated");
  });
});
