// Token usage / quota lookup for providers that publish a token-plan API.
//
// Design notes:
// - Each provider calls a different endpoint (e.g. minimax → /v1/token_plan/remains)
//   so we keep the URL config in a per-provider map rather than baking the URL into
//   the parser. Adding a new provider is a single entry in SUPPORTED_TOKEN_USAGE_PROVIDERS.
// - parseTokenPlanRemains is pure and tolerant of shape variants so that any
//   provider-specific extra field stays available via `raw` for richer UI later.
//   Only the fields we currently display (used/total/remaining/resetAt) are typed.
// - fetchTokenPlanRemains is injectable so it can be unit-tested without `fetch`.
//   Production callers pass the default `fetch`.

export interface TokenUsageProviderConfig {
  id: string;
  /** Base URL of the provider API, no trailing slash. */
  baseUrl: string;
  /** Endpoint path appended to baseUrl (with leading `/`). */
  endpoint: string;
  /** Human-readable provider name. Falls back to id. */
  displayName: string;
}

/**
 * Providers whose token plan / quota endpoint we know about.
 *
 * Only add a provider here when the upstream API is documented enough to
 * point at it; the route layer is what ensures an API key is configured
 * before the fetch is attempted.
 *
 * The MiniMax global + China variants both publish the same
 * `/v1/token_plan/remains` endpoint at `www.minimaxi.com`. The SDK splits
 * them into separate provider ids (`minimax` global vs `minimax-cn`
 * China) so we map both. Add the SDK id verbatim — the AppShell iterates
 * this map and renders one pill per entry.
 */
export const SUPPORTED_TOKEN_USAGE_PROVIDERS: Record<string, TokenUsageProviderConfig> = {
  // MiniMax Global — Coding Plan. Endpoint: GET /v1/token_plan/remains
  // Authorization: Bearer <api key>
  minimax: {
    id: "minimax",
    baseUrl: "https://www.minimaxi.com",
    endpoint: "/v1/token_plan/remains",
    displayName: "MiniMax",
  },
  // MiniMax China — same endpoint, same host.
  "minimax-cn": {
    id: "minimax-cn",
    baseUrl: "https://www.minimaxi.com",
    endpoint: "/v1/token_plan/remains",
    displayName: "MiniMax CN",
  },
  // NOTE: xiaomi-token-plan-{ams,cn,sgp} are not listed here because their
  // token-plan endpoint is not publicly documented and our probes to
  // `/v1/token_plan/remains` returned 404. Re-enable once a working endpoint
  // is known.
};

/** Normalized shape returned to the UI. Provider-specific fields live in `raw`. */
export interface TokenUsageInfo {
  provider: string;
  /** Tokens consumed. Always present (parser requires it). */
  used: number;
  /** Tokens remaining, if disclosed. */
  remaining?: number;
  /** Tokens total in the current window, if disclosed. */
  total?: number;
  /**
   * Percentage of `total` consumed (0-100, rounded). `null` when `total` is
   * unknown — UI should not show a percent bar in that case.
   */
  usedPercent: number | null;
  /** When the current plan window resets, if disclosed. */
  resetAt?: Date;
  /** Raw upstream payload — for any provider-specific rendering we don't yet support. */
  raw: unknown;
}

/**
 * Parse a token-plan / quota payload into the normalized shape the UI consumes.
 * Returns `null` when the payload doesn't carry a usable `used` field, so callers
 * can `tokenInfo === null ? "loading/error" : …` instead of catching exceptions.
 *
 * Supported shapes:
 *
 *   A. "Flat" single-quota payload (used/total/remaining/reset_at at the top):
 *      { used, total, remaining, reset_at }
 *
 *   B. MiniMax model_remains[] envelope (multiple per-model quotas):
 *      {
 *        model_remains: [{ current_interval_total_count, current_interval_usage_count,
 *                          current_interval_remaining_percent, end_time, … }],
 *        base_resp: { status_code: 0, status_msg: "success" }
 *      }
 *      The parser aggregates used/total across all entries (so the indicator
 *      shows one number rather than per-model breakdown) and picks the soonest
 *      `end_time` for the reset clock.
 *
 *      A non-zero `base_resp.status_code` is treated as a soft failure and
 *      `null` is returned — the route layer turns that into a `not_configured`
 *      or `error` reason depending on whether an API key was set.
 *
 * Recognized flat-payload field spellings (case-insensitive, snake/camel agnostic):
 * - used: `used`, `used_quota`, `tokens_used`, `consumed`
 * - total: `total`, `quota`, `limit`, `tokens_total`, `tokens_limit`
 * - remaining: `remaining`, `left`, `tokens_left`
 * - resetAt: `reset_at`, `resetAt`, `reset_time`, `reset`
 *   Accepted as ISO string or epoch seconds.
 */
export function parseTokenPlanRemains(raw: unknown, providerId: string): TokenUsageInfo | null {
  if (!isPlainObject(raw)) return null;

  // ── MiniMax envelope: model_remains[] + base_resp.status_code ─────────────
  const modelRemains = raw.model_remains;
  if (Array.isArray(modelRemains)) {
    const baseResp = (raw as Record<string, unknown>).base_resp;
    if (isPlainObject(baseResp)) {
      const statusCode = readFiniteNumber(baseResp, ["status_code", "code"]);
      if (statusCode !== null && statusCode !== 0) return null;
    }
    if (modelRemains.length === 0) return null;
    return aggregateModelRemains(modelRemains, providerId);
  }

  // ── Flat single-quota shape ───────────────────────────────────────────────
  const used = readFiniteNumber(raw, ["used", "used_quota", "tokens_used", "consumed"]);
  if (used === null) return null;

  const total = readFiniteNumber(raw, ["total", "quota", "limit", "tokens_total", "tokens_limit"]);
  const explicitRemaining = readFiniteNumber(raw, ["remaining", "left", "tokens_left"]);
  // If the payload doesn't disclose remaining but does disclose total, derive it.
  // Tests depend on this so { quota: 100, used_quota: 30 } → remaining: 70.
  const remaining =
    explicitRemaining ?? (typeof total === "number" ? Math.max(0, total - used) : null);
  const resetAtRaw = pick(raw, ["reset_at", "resetAt", "reset_time", "reset"]);

  let resetAt: Date | undefined;
  if (typeof resetAtRaw === "string" && resetAtRaw.trim()) {
    const d = new Date(resetAtRaw);
    if (!Number.isNaN(d.getTime())) resetAt = d;
  } else if (typeof resetAtRaw === "number" && Number.isFinite(resetAtRaw)) {
    resetAt = parseEpochNumber(resetAtRaw);
  }

  let usedPercent: number | null = null;
  if (typeof total === "number" && total > 0 && typeof used === "number") {
    usedPercent = Math.min(100, Math.round((used / total) * 100));
  }

  return {
    provider: providerId,
    used,
    remaining: remaining ?? undefined,
    total: total ?? undefined,
    usedPercent,
    resetAt,
    raw,
  };
}

/**
 * Reduce a MiniMax `model_remains[]` payload to the single normalized
 * TokenUsageInfo the top-bar indicator consumes.
 *
 * Aggregation rules (chosen for the "overall quota" view):
 *   - used    = sum of `current_interval_usage_count` across all entries
 *   - total   = sum of `current_interval_total_count` across all entries
 *   - resetAt = the soonest `end_time` (so the pill surfaces the next refresh)
 *
 * Skips individual entries that lack a recognizable total so a partial /
 * per-model response (e.g. one entry left out) doesn't tank the indicator.
 */
function aggregateModelRemains(entries: unknown[], providerId: string): TokenUsageInfo | null {
  let used = 0;
  let total = 0;
  let sawAnyTotal = false;
  let earliestReset: number | null = null;

  for (const entryRaw of entries) {
    if (!isPlainObject(entryRaw)) continue;
    const entryTotal = readFiniteNumber(entryRaw, [
      "current_interval_total_count",
      "total_count",
      "total",
    ]);
    const entryUsed = readFiniteNumber(entryRaw, [
      "current_interval_usage_count",
      "usage_count",
      "used",
    ]);
    if (typeof entryTotal !== "number") continue;
    sawAnyTotal = true;
    total += entryTotal;
    if (typeof entryUsed === "number") used += entryUsed;
    const endTime = readFiniteNumber(entryRaw, ["end_time", "endTime"]);
    if (typeof endTime === "number") {
      if (earliestReset === null || endTime < earliestReset) earliestReset = endTime;
    }
  }

  if (!sawAnyTotal) return null;

  const remaining = Math.max(0, total - used);
  const usedPercent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : null;

  return {
    provider: providerId,
    used,
    total,
    remaining,
    usedPercent,
    resetAt: earliestReset !== null ? new Date(earliestReset) : undefined,
    raw: { model_remains: entries },
  };
}

/** Options for fetchTokenPlanRemains. */
export interface FetchTokenUsageOptions {
  provider: TokenUsageProviderConfig;
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Override the per-request timeout (ms). Default 5000. */
  timeoutMs?: number;
}

/**
 * Call a provider's token-plan endpoint with bearer auth and parse the
 * JSON body. Returns `null` when `apiKey` is empty or the body has no usable
 * `used` field. Throws on non-2xx HTTP status so callers can distinguish
 * "transient" (network/auth failure) from "API has no quota info".
 */
export async function fetchTokenPlanRemains(
  opts: FetchTokenUsageOptions,
): Promise<TokenUsageInfo | null> {
  if (!opts.apiKey.trim()) return null;

  const url = `${opts.provider.baseUrl.replace(/\/$/, "")}${opts.provider.endpoint}`;
  const f = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await f(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${opts.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Read a small slice of the body for diagnostics without ballooning memory
    // on big 5xx responses.
    let snippet = "";
    try {
      const text = await res.text();
      snippet = text.slice(0, 200);
    } catch {
      // ignore
    }
    throw new Error(
      `Token-plan request to ${opts.provider.id} failed: HTTP ${res.status}${snippet ? ` — ${snippet}` : ""}`,
    );
  }

  // Some providers return 204 or empty body — handle gracefully.
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) return null;

  const body = await res.json().catch(() => null);
  return parseTokenPlanRemains(body, opts.provider.id);
}

// ── Small helpers (kept inline; pure, no deps) ────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in obj) return obj[k];
  }
  return undefined;
}

function readFiniteNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  const v = pick(obj, keys);
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/**
 * Parse a numeric timestamp that may be epoch-seconds or epoch-milliseconds.
 * Tries both interpretations and keeps the one that yields a year >= 2000 —
 * tokens-plans always reference times after that, so this rejects the wrong
 * interpretation without depending on Date.now().
 */
function parseEpochNumber(n: number): Date | undefined {
  const asMs = new Date(n);
  if (!Number.isNaN(asMs.getTime()) && asMs.getFullYear() >= 2000) return asMs;
  const asSec = new Date(n * 1000);
  if (!Number.isNaN(asSec.getTime()) && asSec.getFullYear() >= 2000) return asSec;
  return undefined;
}
