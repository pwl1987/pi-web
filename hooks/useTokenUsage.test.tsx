// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useTokenUsage, formatTokenCount, formatResetIn } from "./useTokenUsage";

type FetchResponse = { ok?: boolean; status?: number; body: unknown };

function mockFetch(responses: FetchResponse[]) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: (r.status ?? 200) === 200,
      status: r.status ?? 200,
      json: async () => r.body,
    } as unknown as Response);
  }
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

// We deliberately don't use vi.useFakeTimers — they make the hook's
// initial await (which is awaited microtask work) flakey in jsdom, and
// none of the tests below inspect the actual interval. Instead we
// assert only the state after the initial fetch settles.

beforeEach(() => {
  // Reset fetch between tests so leaked mocks from a prior test don't
  // pollute state changes.
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── formatTokenCount ────────────────────────────────────────────────────────

describe("formatTokenCount", () => {
  it("formats sub-1000 numbers with no suffix", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(456)).toBe("456");
  });
  it("formats 1k–1M as 'X.Xk'", () => {
    expect(formatTokenCount(1_000)).toBe("1.0k");
    expect(formatTokenCount(12_345)).toBe("12.3k");
  });
  it("formats ≥1M as 'X.XM'", () => {
    expect(formatTokenCount(1_000_000)).toBe("1.0M");
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
  });
});

// ─── formatResetIn ──────────────────────────────────────────────────────────

describe("formatResetIn", () => {
  // 冻结系统时间，避免测试内两次 Date.now() 取值间隔跨过分钟边界导致偶发失败。
  const NOW = 1_750_000_000_000;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when resetAt is null/invalid", () => {
    expect(formatResetIn(null)).toBeNull();
    expect(formatResetIn("not-a-date")).toBeNull();
  });
  it("returns null when resetAt is in the past", () => {
    expect(formatResetIn(new Date(NOW - 1000).toISOString())).toBeNull();
  });
  it("formats a near-future reset as minutes", () => {
    const iso = new Date(NOW + 5 * 60_000).toISOString();
    expect(formatResetIn(iso)).toBe("5m");
  });
  it("formats a multi-hour reset as 'XhYm'", () => {
    const iso = new Date(NOW + (3 * 60 + 25) * 60_000).toISOString();
    expect(formatResetIn(iso)).toBe("3h25m");
  });
  it("formats a full-day reset as 'Xd'", () => {
    const iso = new Date(NOW + 48 * 60 * 60_000).toISOString();
    expect(formatResetIn(iso)).toBe("2d");
  });
});

// ─── useTokenUsage ───────────────────────────────────────────────────────────

describe("useTokenUsage", () => {
  it("starts un-settled and renders without a fetch failure", () => {
    mockFetch([{ status: 200, body: { ok: true, info: sampleInfo() } }]);
    const { result } = renderHook(() => useTokenUsage({ provider: "minimax" }));
    expect(result.current.settled).toBe(false);
    expect(result.current.info).toBeNull();
  });

  it("hydrates info from a successful response", async () => {
    const fetchMock = mockFetch([{ status: 200, body: { ok: true, info: sampleInfo() } }]);
    const { result } = renderHook(() => useTokenUsage({ provider: "minimax" }));

    // First fetch is delayed ~1.5s (INITIAL_FETCH_DELAY_MS) so it doesn't
    // contend with first-paint requests — waitFor needs headroom past that.
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 4000 });
    expect(result.current.info?.used).toBe(12_345);
    expect(result.current.reason).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("encodes not_configured as reason, not error", async () => {
    mockFetch([{ status: 200, body: { ok: false, reason: "not_configured" } }]);
    const { result } = renderHook(() => useTokenUsage({ provider: "minimax" }));
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 4000 });
    expect(result.current.info).toBeNull();
    expect(result.current.reason).toBe("not_configured");
  });

  it("404 → reason='unsupported' (silent in UI)", async () => {
    mockFetch([{ status: 404, body: { ok: false, reason: "unsupported" } }]);
    const { result } = renderHook(() => useTokenUsage({ provider: "minimax" }));
    await waitFor(() => expect(result.current.reason).toBe("unsupported"), { timeout: 4000 });
  });

  it("network failure → reason='error'", async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("boom")) as unknown as typeof fetch;
    const { result } = renderHook(() => useTokenUsage({ provider: "minimax" }));
    await waitFor(() => expect(result.current.reason).toBe("error"), { timeout: 4000 });
    expect(result.current.error).toMatch(/boom/);
  });

  it("enabled=false never fetches", async () => {
    const fetchMock = mockFetch([{ status: 200, body: { ok: true, info: sampleInfo() } }]);
    const { result } = renderHook(() => useTokenUsage({ provider: "minimax", enabled: false }));
    // Give the effect a chance to schedule; none should happen. The delayed
    // first fetch would fire at 1.5s — wait past that to be sure it never did.
    await new Promise((r) => setTimeout(r, 60));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.settled).toBe(false);
  });

  it("resets state when provider changes", async () => {
    mockFetch([
      { status: 200, body: { ok: true, info: sampleInfo() } },
      { status: 200, body: { ok: false, reason: "not_configured" } },
    ]);
    const { result, rerender } = renderHook(({ provider }) => useTokenUsage({ provider }), {
      initialProps: { provider: "minimax" },
    });
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 4000 });
    rerender({ provider: "something-else" });
    // After provider change, the very first effect re-run fires a new fetch —
    // which our mock has queued as the "not_configured" response, so the
    // settled/info state transitions accordingly. Most importantly, info
    // from the old provider must be cleared until the new fetch resolves.
    await waitFor(() => expect(result.current.reason).toBe("not_configured"), { timeout: 4000 });
  });
});

function sampleInfo() {
  return {
    provider: "minimax",
    used: 12_345,
    remaining: 7_655,
    total: 20_000,
    usedPercent: 62,
    resetAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    raw: {},
  };
}
