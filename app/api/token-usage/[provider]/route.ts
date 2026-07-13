// GET /api/token-usage/[provider]
//
// Returns the current token-plan / quota usage for a supported provider,
// when an API key is configured for it. Used by the top-bar usage indicator.
//
// Response shape (always 200 unless server error):
//   { ok: true, info: TokenUsageInfo }                       — happy path
//   { ok: false, reason: "unsupported" | "not_configured" }  — nothing to show
//   { ok: false, reason: "error", error: string }            — remote fetch failed
//
// We return 200 with `ok: false` for the common "nothing to show" cases so
// the client can render a single empty state instead of branching on HTTP
// codes. 5xx is reserved for unexpected local errors.

import type { TokenUsageInfo } from "@/lib/token-usage";
import { NextResponse } from "next/server";
import { getPiAdapter } from "@/lib/pi";

const { AuthStorage } = getPiAdapter();

import { SUPPORTED_TOKEN_USAGE_PROVIDERS, fetchTokenPlanRemains } from "@/lib/token-usage";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// ── Request dedup cache ────────────────────────────────────────────────────
// Avoid redundant API calls when the client polls rapidly (tab switch,
// page-foreground events, etc.). Each provider entry lives 2 s; concurrent
// requests for the same provider within that window share the same promise.
//
// 缓存存的是已解析的纯数据（CachedPayload），而非 Response 对象。Response 的 body
// 是一次性流：首个请求返回给 Next.js 后 body 即被消费，后续命中缓存再 r.clone()
// 会抛 "Body has already been consumed"（clone 必须在 body 未读时调用）。改为缓存
// plain object，每个请求命中时新建 NextResponse，无 body 流问题。
type CachedPayload = {
  status: number;
  body: Record<string, unknown>;
};
const dedupCache = new Map<string, { expiresAt: number; promise: Promise<CachedPayload> }>();
const DEDUP_TTL_MS = 2_000;

export async function GET(_req: Request, { params }: Params) {
  const { provider: providerId } = await params;
  const now = Date.now();

  // Reuse in-flight or recent result
  const cached = dedupCache.get(providerId);
  if (cached && cached.expiresAt > now) {
    // 命中缓存：用纯数据新建 Response，不依赖共享的 Response body 流。
    return cached.promise.then((payload) =>
      NextResponse.json(payload.body, { status: payload.status }),
    );
  }

  const promise = handleRequest(providerId);

  dedupCache.set(providerId, { expiresAt: now + DEDUP_TTL_MS, promise });
  // Clean up stale entries lazily (max 5 providers won't grow unbounded)
  if (dedupCache.size > 8) {
    for (const [key, entry] of dedupCache) {
      if (entry.expiresAt <= now) dedupCache.delete(key);
    }
  }

  // 首个请求：从 promise 拿到纯数据，也新建 Response（与缓存命中路径一致）。
  return promise.then((payload) => NextResponse.json(payload.body, { status: payload.status }));
}

async function handleRequest(providerId: string): Promise<CachedPayload> {
  const cfg = SUPPORTED_TOKEN_USAGE_PROVIDERS[providerId];
  if (!cfg) {
    return { status: 404, body: { ok: false, reason: "unsupported" } };
  }

  let apiKey: string | undefined;
  try {
    const authStorage = AuthStorage.create();
    apiKey = await authStorage.getApiKey(providerId);
  } catch {
    // Storage layer may fail — treat as not configured; UI will silently hide.
    return { status: 200, body: { ok: false, reason: "not_configured" } };
  }

  if (!apiKey) {
    return { status: 200, body: { ok: false, reason: "not_configured" } };
  }

  try {
    // 4s cap (down from the lib default of 5s). A GET quota query that
    // hasn't answered in 4s is effectively hung — fail fast so the client's
    // 6s timeout guard rarely has to fire, and the pill shows its error
    // state quickly instead of hanging the top bar.
    const info = await fetchTokenPlanRemains({ provider: cfg, apiKey, timeoutMs: 4000 });
    if (!info) {
      // Server responded but the payload didn't carry usable fields.
      // Treat as a soft "no data" so the UI doesn't flap on transient shapes.
      return {
        status: 200,
        body: { ok: false, reason: "error", error: "Empty or unparseable token-plan response" },
      };
    }
    return {
      status: 200,
      body: {
        ok: true,
        info: serializeInfo(info),
        providerDisplayName: cfg.displayName,
      },
    };
  } catch (err) {
    return {
      status: 200,
      body: {
        ok: false,
        reason: "error",
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Convert a TokenUsageInfo into a JSON-safe shape so `info` rides the wire
 * without Date serialization surprises.
 */
function serializeInfo(info: TokenUsageInfo) {
  // Pull per-model rows out of the MiniMax envelope so the UI can render a
  // breakdown in a future tooltip without re-fetching. Other providers'
  // `raw` payloads pass through unchanged.
  const breakdown =
    info.raw &&
    typeof info.raw === "object" &&
    Array.isArray((info.raw as { model_remains?: unknown }).model_remains)
      ? (info.raw as { model_remains: Array<Record<string, unknown>> }).model_remains.map((m) => ({
          model_name: m.model_name,
          current_interval_total_count:
            typeof m.current_interval_total_count === "number"
              ? m.current_interval_total_count
              : null,
          current_interval_usage_count:
            typeof m.current_interval_usage_count === "number"
              ? m.current_interval_usage_count
              : null,
          current_interval_remaining_percent:
            typeof m.current_interval_remaining_percent === "number"
              ? m.current_interval_remaining_percent
              : null,
          end_time: typeof m.end_time === "number" ? m.end_time : null,
          current_interval_status:
            typeof m.current_interval_status === "number" ? m.current_interval_status : null,
        }))
      : undefined;

  return {
    provider: info.provider,
    used: info.used,
    remaining: info.remaining ?? null,
    total: info.total ?? null,
    usedPercent: info.usedPercent,
    resetAt: info.resetAt ? info.resetAt.toISOString() : null,
    breakdown,
    raw: info.raw,
  };
}
