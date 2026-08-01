// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useIsCwdPinned } from "./useIsCwdPinned";
import { getPinnedDirsBus } from "@/lib/pinned-dirs-bus";
import { mockFetchAlways } from "@/lib/test-fetch-mock";

describe("useIsCwdPinned", () => {
  beforeEach(() => {
    delete (globalThis as { __piWebPinnedDirsBus?: unknown }).__piWebPinnedDirsBus;
    vi.restoreAllMocks();
  });

  it("returns false initially, then true when the cwd is in the list", async () => {
    mockFetchAlways({
      pinnedDirs: [{ path: "/Users/me/projects/x" }, { path: "/other" }],
    });
    const { result } = renderHook(() => useIsCwdPinned("/Users/me/projects/x"));
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("returns false when the cwd is not in the list", async () => {
    mockFetchAlways({ pinnedDirs: [{ path: "/other" }] });
    const { result } = renderHook(() => useIsCwdPinned("/not-pinned"));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("returns false when cwd is null", async () => {
    mockFetchAlways({ pinnedDirs: [{ path: "/x" }] });
    const { result } = renderHook(() => useIsCwdPinned(null));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("re-checks when the pinned-dirs bus emits", async () => {
    // First fetch: cwd not pinned.
    let mockBody = { pinnedDirs: [] as Array<{ path: string }> };
    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => mockBody,
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useIsCwdPinned("/me"));
    await waitFor(() => expect(result.current).toBe(false));

    // Simulate another component pinning this dir.
    mockBody = { pinnedDirs: [{ path: "/me" }] };
    act(() => getPinnedDirsBus().emit());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("returns false on fetch error (safe default)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    const { result } = renderHook(() => useIsCwdPinned("/me"));
    await waitFor(() => expect(result.current).toBe(false));
  });
});
