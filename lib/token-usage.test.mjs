import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPPORTED_TOKEN_USAGE_PROVIDERS,
  parseTokenPlanRemains,
  fetchTokenPlanRemains,
} from "./token-usage.ts";

// ── SUPPORTED_TOKEN_USAGE_PROVIDERS ──────────────────────────────────────────

test("SUPPORTED_TOKEN_USAGE_PROVIDERS includes minimax", () => {
  assert.ok(SUPPORTED_TOKEN_USAGE_PROVIDERS.minimax, "minimax should be a supported provider");
  const p = SUPPORTED_TOKEN_USAGE_PROVIDERS.minimax;
  assert.ok(p.baseUrl, "minimax must have a baseUrl");
  assert.ok(p.endpoint, "minimax must have an endpoint");
  assert.match(p.baseUrl, /^https?:\/\//);
});

test("SUPPORTED_TOKEN_USAGE_PROVIDERS includes minimax-cn (China) at the same endpoint", () => {
  // The SDK exposes `minimax-cn` as a separate provider id, but it shares
  // the www.minimaxi.com token-plan endpoint with global minimax. If the
  // SDK ever drops -cn, the AppShell simply won't render its pill.
  const cn = SUPPORTED_TOKEN_USAGE_PROVIDERS["minimax-cn"];
  assert.ok(cn, "minimax-cn should be a supported provider");
  assert.equal(cn.baseUrl, SUPPORTED_TOKEN_USAGE_PROVIDERS.minimax.baseUrl);
  assert.equal(cn.endpoint, SUPPORTED_TOKEN_USAGE_PROVIDERS.minimax.endpoint);
});

test("SUPPORTED_TOKEN_USAGE_PROVIDERS does NOT include Xiaomi (no public quota endpoint)", () => {
  // xiaomi-token-plan-* returned 404 from /v1/token_plan/remains at the time
  // of writing. Re-enable these entries once an endpoint is documented.
  for (const id of ["xiaomi-token-plan-ams", "xiaomi-token-plan-cn", "xiaomi-token-plan-sgp"]) {
    assert.equal(
      SUPPORTED_TOKEN_USAGE_PROVIDERS[id],
      undefined,
      `${id} should not be in SUPPORTED_TOKEN_USAGE_PROVIDERS until a public quota endpoint is known`,
    );
  }
});

test("every supported provider has a baseUrl, endpoint and matching id", () => {
  for (const [id, cfg] of Object.entries(SUPPORTED_TOKEN_USAGE_PROVIDERS)) {
    assert.equal(cfg.id, id, `provider key=${id} must match cfg.id`);
    assert.ok(cfg.baseUrl, `${id}: baseUrl required`);
    assert.ok(cfg.endpoint, `${id}: endpoint required`);
  }
});

// ── parseTokenPlanRemains ────────────────────────────────────────────────────

// 1. Provider returns the happy-path shape we know about today:
//    { total, used, remaining, reset_at }.
test("parseTokenPlanRemains: normalizes total/used/remaining/reset_at", () => {
  const json = {
    total: 20000,
    used: 12345,
    remaining: 7655,
    reset_at: "2026-07-12T00:00:00Z",
  };
  const out = parseTokenPlanRemains(json, "minimax");
  assert.ok(out);
  assert.equal(out.provider, "minimax");
  assert.equal(out.used, 12345);
  assert.equal(out.total, 20000);
  assert.equal(out.remaining, 7655);
  assert.equal(out.usedPercent, 62); // 12345/20000 = 0.61725 → 62 (Math.round)
  assert.ok(out.resetAt instanceof Date);
  assert.equal(out.resetAt.toISOString(), "2026-07-12T00:00:00.000Z");
  assert.deepEqual(out.raw, json);
});

// 2. Common alternate spellings — e.g. quota-style APIs that use
//    `quota` / `used_quota` rather than `used`/`total`.
test("parseTokenPlanRemains: tolerates quota/used_quota spelling", () => {
  const json = { quota: 100, used_quota: 30 };
  const out = parseTokenPlanRemains(json, "minimax");
  assert.ok(out);
  assert.equal(out.total, 100);
  assert.equal(out.used, 30);
  assert.equal(out.remaining, 70);
  assert.equal(out.usedPercent, 30);
});

// 3. reset can come as an epoch-seconds number (some gateways).
test("parseTokenPlanRemains: parses epoch-seconds reset", () => {
  // 1752278400 sec = 2025-07-12T00:00:00Z (chosen to be an obvious hour boundary).
  const json = {
    total: 1000,
    used: 100,
    remaining: 900,
    reset_at: 1752278400,
  };
  const out = parseTokenPlanRemains(json, "minimax");
  assert.ok(out);
  assert.equal(out.resetAt.toISOString(), "2025-07-12T00:00:00.000Z");
});

// 3b. epoch-ms resets (the JavaScript convention) also work.
test("parseTokenPlanRemains: parses epoch-milliseconds reset", () => {
  const json = { total: 1000, used: 100, remaining: 900, reset_at: 1752278400000 };
  const out = parseTokenPlanRemains(json, "minimax");
  assert.ok(out);
  assert.equal(out.resetAt.toISOString(), "2025-07-12T00:00:00.000Z");
});

// 4. reset absent — still useful.
test("parseTokenPlanRemains: missing reset_at yields undefined resetAt", () => {
  const out = parseTokenPlanRemains({ total: 1000, used: 200, remaining: 800 }, "minimax");
  assert.ok(out);
  assert.equal(out.resetAt, undefined);
});

// 5. Missing total — can't show meaningful %, still useful as raw.
test("parseTokenPlanRemains: missing total yields usedPercent=null but used/remaining preserved", () => {
  const out = parseTokenPlanRemains({ used: 1234 }, "minimax");
  assert.ok(out);
  assert.equal(out.used, 1234);
  assert.equal(out.remaining, undefined);
  assert.equal(out.total, undefined);
  assert.equal(out.usedPercent, null);
});

// 6. Reject nonsense — `null`, `'string'`, missing used.
test("parseTokenPlanRemains: returns null for non-objects", () => {
  assert.equal(parseTokenPlanRemains(null, "minimax"), null);
  assert.equal(parseTokenPlanRemains("hello", "minimax"), null);
  assert.equal(parseTokenPlanRemains(42, "minimax"), null);
  assert.equal(parseTokenPlanRemains(undefined, "minimax"), null);
});

test("parseTokenPlanRemains: returns null when used is not a finite number", () => {
  assert.equal(parseTokenPlanRemains({}, "minimax"), null);
  assert.equal(parseTokenPlanRemains({ used: "oops" }, "minimax"), null);
  assert.equal(parseTokenPlanRemains({ used: NaN }, "minimax"), null);
  assert.equal(parseTokenPlanRemains({ used: -1 }, "minimax"), null); // negative used = garbage
});

// 7. Provider name is just stored, not interpreted.
//    (Multiple providers share the parser — keeps parser a pure function.)
test("parseTokenPlanRemains: stores the provider id verbatim", () => {
  const out = parseTokenPlanRemains({ total: 10, used: 2 }, "xiaomi-token-plan-cn");
  assert.ok(out);
  assert.equal(out.provider, "xiaomi-token-plan-cn");
});

// 8. MiniMax real shape: `{ model_remains: [...], base_resp: { status_code, ... } }`.
test("parseTokenPlanRemains: parses MiniMax model_remains[] + base_resp envelope", () => {
  const json = {
    model_remains: [
      {
        model_name: "general",
        current_interval_total_count: 1000,
        current_interval_usage_count: 370,
        current_interval_remaining_percent: 63,
        current_interval_status: 1,
        end_time: 1783735200000,
        remains_time: 3140347,
      },
      {
        model_name: "video",
        current_interval_total_count: 21,
        current_interval_usage_count: 0,
        current_interval_remaining_percent: 100,
        current_interval_status: 1,
        end_time: 1783872000000,
        remains_time: 139940347,
      },
    ],
    base_resp: { status_code: 0, status_msg: "success" },
  };
  const out = parseTokenPlanRemains(json, "minimax-cn");
  assert.ok(out);
  // Aggregated across all models in model_remains.
  assert.equal(out.used, 370);
  assert.equal(out.total, 1021); // 1000 + 21
  assert.equal(out.remaining, 651); // 1021 - 370
  assert.equal(out.usedPercent, 36); // 370/1021 = 36.2% → 36
  // Soonest reset wins (general: 1783735200000 < video: 1783872000000).
  assert.equal(out.resetAt.toISOString(), new Date(1783735200000).toISOString());
  // Provider-specific raw payload preserved for richer rendering later.
  assert.equal(out.raw.model_remains.length, 2);
});

test("parseTokenPlanRemains: non-zero base_resp.status_code → null", () => {
  const json = {
    model_remains: [],
    base_resp: { status_code: 2049, status_msg: "invalid api key" },
  };
  assert.equal(parseTokenPlanRemains(json, "minimax-cn"), null);
});

test("parseTokenPlanRemains: missing model_remains array → null (no usable used)", () => {
  // Defensive: not all providers may use the model_remains shape.
  assert.equal(parseTokenPlanRemains({ base_resp: { status_code: 0 } }, "minimax-cn"), null);
});

test("parseTokenPlanRemains: empty model_remains array → null", () => {
  assert.equal(
    parseTokenPlanRemains({ model_remains: [], base_resp: { status_code: 0 } }, "minimax-cn"),
    null,
  );
});

test("parseTokenPlanRemains: tolerates a single-model model_remains payload", () => {
  const json = {
    model_remains: [
      {
        model_name: "general",
        current_interval_total_count: 5000,
        current_interval_usage_count: 1234,
        current_interval_remaining_percent: 75,
        current_interval_status: 1,
        end_time: 1783735200000,
        remains_time: 3140347,
      },
    ],
    base_resp: { status_code: 0, status_msg: "success" },
  };
  const out = parseTokenPlanRemains(json, "minimax-cn");
  assert.ok(out);
  assert.equal(out.used, 1234);
  assert.equal(out.total, 5000);
  assert.equal(out.remaining, 3766);
  assert.equal(out.usedPercent, 25);
});

const MINIMAX_CFG = SUPPORTED_TOKEN_USAGE_PROVIDERS.minimax;

test("fetchTokenPlanRemains: GETs the documented URL with Bearer auth", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ total: 100, used: 10, remaining: 90 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const out = await fetchTokenPlanRemains({
    provider: MINIMAX_CFG,
    apiKey: "test-key",
    fetchImpl: fakeFetch,
  });
  assert.ok(out);
  assert.equal(out.used, 10);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /token_plan\/remains\/?$/);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
});

test("fetchTokenPlanRemains: throws on non-2xx with the status in the error", async () => {
  const fakeFetch = async () => new Response("oh no", { status: 401 });
  await assert.rejects(
    fetchTokenPlanRemains({
      provider: MINIMAX_CFG,
      apiKey: "bad",
      fetchImpl: fakeFetch,
    }),
    (err) => err instanceof Error && /401/.test(err.message),
  );
});

test("fetchTokenPlanRemains: returns null when apiKey is empty", async () => {
  const out = await fetchTokenPlanRemains({
    provider: MINIMAX_CFG,
    apiKey: "",
    fetchImpl: async () => {
      throw new Error("should not be called");
    },
  });
  assert.equal(out, null);
});

test("fetchTokenPlanRemains: returns null when JSON body doesn't have a usable used field", async () => {
  const fakeFetch = async () => new Response(JSON.stringify({}), { status: 200 });
  const out = await fetchTokenPlanRemains({
    provider: MINIMAX_CFG,
    apiKey: "ok",
    fetchImpl: fakeFetch,
  });
  assert.equal(out, null);
});
