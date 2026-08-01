"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Normalized usage shape — wire/UI shared. Defined locally instead of
 * importing from `@/lib/token-usage` because client components must not
 * pull in node-only helpers; the server route already strips it down.
 */
export interface TokenUsageBreakdownRow {
  model_name: string;
  current_interval_total_count: number | null;
  current_interval_usage_count: number | null;
  current_interval_remaining_percent: number | null;
  end_time: number | null;
  current_interval_status: number | null;
}

export interface TokenUsageInfo {
  provider: string;
  used: number;
  remaining: number | null;
  total: number | null;
  usedPercent: number | null;
  resetAt: string | null; // ISO string from the server
  /** Per-model quota breakdown (e.g. MiniMax model_remains[]). undefined for flat shapes. */
  breakdown?: TokenUsageBreakdownRow[];
  raw: unknown;
}

export type TokenUsageReason = "unsupported" | "not_configured" | "error" | null;

export interface TokenUsageState {
  info: TokenUsageInfo | null;
  /** Why we have nothing to show right now. */
  reason: TokenUsageReason;
  /** Last error message (when reason === "error"). */
  error: string | null;
  /** Most recent successful fetch time (ms). 0 while we haven't fetched yet. */
  fetchedAt: number;
  /** True after the first settle (success or stable error). */
  settled: boolean;
}

const INITIAL: TokenUsageState = {
  info: null,
  reason: null,
  error: null,
  fetchedAt: 0,
  settled: false,
};

/**
 * How long to wait before the first fetch after mount. Token-usage pills are
 * secondary UI — deferring them lets the critical first-paint requests
 * (/api/models, /api/sessions, the agent SSE stream) win the browser's
 * limited per-host connection slots instead of contending with quota polling.
 */
const INITIAL_FETCH_DELAY_MS = 1500;

/**
 * Client-side fetch timeout. The server route caps itself at ~4s, so this
 * 6s guard normally never fires — it only catches a hung network connection
 * that would otherwise hang on the browser's ~300s default.
 */
const CLIENT_TIMEOUT_MS = 6000;

/**
 * Cap for exponential backoff on consecutive errors. 5min means a
 * persistently-failing provider retries at most every 5min until the user
 * returns to the tab (visibilitychange resets the streak).
 */
const BACKOFF_MAX_MS = 5 * 60_000;

export interface UseTokenUsageOptions {
  /** Provider id (matched against SUPPORTED_TOKEN_USAGE_PROVIDERS). */
  provider: string;
  /** Polling interval, ms. Defaults to 60s. */
  intervalMs?: number;
  /** Disable polling and stay at INITIAL. */
  enabled?: boolean;
}

/**
 * Polls `/api/token-usage/:provider` and returns the latest normalized
 * shape. Designed to be cheap to call from multiple consumers — each
 * instance keeps its own fetch cycle.
 *
 * - Pause when tab hidden, refresh on visibilitychange / online.
 * - Ignore stale responses (last-write-wins via in-flight generation).
 * - Don't expose throw paths; everything is encoded in `reason` so the
 *   top-bar indicator can render a single branch.
 */
export function useTokenUsage(opts: UseTokenUsageOptions): TokenUsageState {
  const { provider, intervalMs = 60_000, enabled = true } = opts;
  const [state, setState] = useState<TokenUsageState>(INITIAL);
  const inFlightRef = useRef(0);
  const prevProviderRef = useRef(provider);
  // Track first render to avoid reset-on-mount flash
  const mountedRef = useRef(false);

  // Reset when provider changes — must be in useEffect, not render body,
  // to avoid React warning: "Cannot update a component while rendering a
  // different component" and potential infinite loops from setState in render.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevProviderRef.current = provider;
      return;
    }
    if (prevProviderRef.current === provider) return;
    prevProviderRef.current = provider;
    // Only reset if we have something to clear — avoids a needless INITIAL
    // setState when the state is already pristine.
    setState((prev) => (prev.info || prev.reason || prev.error ? INITIAL : prev));
  }, [provider]);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let abortCtrl: AbortController | null = null;
    let alive = true;
    // Tracks consecutive error cycles for exponential backoff. Reset to 0
    // on any non-error (success / not_configured / unsupported).
    let errorStreak = 0;
    const myGen = ++inFlightRef.current;

    const tick = async () => {
      if (!alive) return;
      // Client-side timeout — the server route caps at ~4-5s, but a hung
      // network connection could otherwise keep this fetch open for the
      // browser's default ~300s. 6s > server 4s so the server timeout
      // normally wins; this is the tail guard.
      abortCtrl = new AbortController();
      const timeout = setTimeout(() => abortCtrl?.abort(), CLIENT_TIMEOUT_MS);
      try {
        const res = await fetch(`/api/token-usage/${encodeURIComponent(provider)}`, {
          cache: "no-store",
          signal: abortCtrl.signal,
        });
        if (!alive || myGen !== inFlightRef.current) return;

        if (res.status === 404) {
          // Provider isn't supported — that's not an error worth surfacing.
          errorStreak = 0;
          setState({
            info: null,
            reason: "unsupported",
            error: null,
            fetchedAt: Date.now(),
            settled: true,
          });
          scheduleNext();
          return;
        }

        const body = (await res.json().catch(() => ({}))) as
          | { ok: true; info: TokenUsageInfo }
          | { ok: false; reason?: TokenUsageReason; error?: string };

        if (!alive || myGen !== inFlightRef.current) return;

        if (body.ok) {
          errorStreak = 0;
          setState({
            info: body.info,
            reason: null,
            error: null,
            fetchedAt: Date.now(),
            settled: true,
          });
        } else {
          const reason = body.reason ?? "error";
          // not_configured / unsupported are stable "nothing to show" — no
          // point retrying aggressively. Only genuine errors back off.
          if (reason === "error") errorStreak++;
          else errorStreak = 0;
          setState({
            info: null,
            reason,
            error: body.error ?? null,
            fetchedAt: Date.now(),
            settled: true,
          });
        }
      } catch (err) {
        if (!alive || myGen !== inFlightRef.current) return;
        errorStreak++;
        setState({
          info: null,
          reason: "error",
          error: err instanceof Error ? err.message : String(err),
          fetchedAt: Date.now(),
          settled: true,
        });
      } finally {
        clearTimeout(timeout);
        abortCtrl = null;
      }
      scheduleNext();
    };

    const scheduleNext = () => {
      if (!alive) return;
      // Exponential backoff on consecutive errors: 60s → 120s → 240s → … 5min cap.
      // Lets a persistently-failing/slow provider rest instead of dragging
      // every minute. Visibility/online handlers still force an immediate
      // refresh when the user returns, so backoff never feels stale.
      const backoff =
        errorStreak > 0 ? Math.min(intervalMs * 2 ** errorStreak, BACKOFF_MAX_MS) : intervalMs;
      // Pause when tab is hidden — saves a network round trip on inactive tabs.
      const delay = document.hidden ? Math.min(backoff, 15_000) : backoff;
      timer = setTimeout(tick, delay);
    };

    const onVisible = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!document.hidden) {
        // Returning to the tab resets backoff — the user is here and wants
        // fresh data now.
        errorStreak = 0;
        void tick();
      }
    };
    const onOnline = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      errorStreak = 0;
      void tick();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    // Delay the first fetch so token-usage polling doesn't compete with the
    // critical first-paint requests (/api/models, /api/sessions, the SSE
    // stream). The pill is secondary UI — appearing ~1.5s after load is fine.
    // requestIdleCallback (if available) defers even further when the main
    // thread is busy; otherwise setTimeout is the fallback.
    const scheduleFirst = (cb: () => void, ms: number) => {
      const ric =
        typeof window !== "undefined"
          ? (
              window as unknown as {
                requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
              }
            ).requestIdleCallback
          : undefined;
      if (typeof ric === "function") {
        const handle = ric(cb, { timeout: ms + 500 });
        return () =>
          (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(
            handle,
          );
      }
      const h = setTimeout(cb, ms);
      return () => clearTimeout(h);
    };
    const cancelFirst = scheduleFirst(() => {
      void tick();
    }, INITIAL_FETCH_DELAY_MS);

    return () => {
      alive = false;
      cancelFirst();
      if (timer) clearTimeout(timer);
      abortCtrl?.abort();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
    // We intentionally exclude `intervalMs`/`enabled` from deps — top bar
    // controls only at mount time. Pass `provider` as the only key change.
  }, [provider, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

/**
 * Format `used` for display: 12.3k / 1.2M / 456
 * Mirrors the formatter already in AppShell, kept duplicated so this hook
 * stays self-contained for tests.
 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * Format resetAt as "in 1h23m" / "in 4d" — for in-the-future only. Past
 * or missing resets return null so the caller can branch cleanly.
 */
export function formatResetIn(resetAt: string | null): string | null {
  if (!resetAt) return null;
  const target = Date.parse(resetAt);
  if (Number.isNaN(target)) return null;
  const ms = target - Date.now();
  if (ms <= 0) return null;

  const min = Math.floor(ms / 60_000);
  if (min < 1) return null;
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const rm = min % 60;
  if (h < 24) return rm > 0 ? `${h}h${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const dh = h % 24;
  return dh > 0 ? `${d}d${dh}h` : `${d}d`;
}
