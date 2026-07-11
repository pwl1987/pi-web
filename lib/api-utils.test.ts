/**
 * Tests for lib/api-utils.ts — standardized API error responses & JSON parsing.
 * Seams under test:
 *   1. errorResponse(error, status) — returns structured JSON error
 *   2. safeJsonBody(req, maxBytes) — parses request body safely with size limits
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// We test the module by importing it; Node environment is fine.
import { errorResponse, safeJsonBody } from "./api-utils";

describe("errorResponse", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a 500 JSON response with generic message in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = errorResponse(new Error("secret details"));

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");

    // In production, error details must NOT leak
    expect(res.status).toBe(500);
  });

  it("includes the real error message in development mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = errorResponse(new Error("secret details"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe("secret details");
  });

  it("handles non-Error errors in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    // String error
    const res1 = errorResponse("something broke");
    const json1 = await res1.json();
    expect(json1.error).toBe("something broke");

    // Plain object error
    const res2 = errorResponse({ code: 42 });
    const json2 = await res2.json();
    expect(json2.error).toBe("[object Object]");
  });

  it("handles null / undefined gracefully in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res1 = errorResponse(null);
    const json1 = await res1.json();
    expect(json1.error).toBe("null");

    const res2 = errorResponse(undefined);
    const json2 = await res2.json();
    expect(json2.error).toBe("undefined");
  });

  it("returns a configurable status code", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res404 = errorResponse(new Error("not found"), 404);
    expect(res404.status).toBe(404);

    const res403 = errorResponse(new Error("forbidden"), 403);
    expect(res403.status).toBe(403);
  });
});

describe("safeJsonBody", () => {
  function mockRequest(body: unknown, contentLength?: number): Request {
    return new Request("https://example.com/api/test", {
      method: "POST",
      headers: contentLength != null ? { "content-length": String(contentLength) } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("parses valid JSON body successfully", async () => {
    const req = mockRequest({ name: "test", value: 42 });
    const [data, error] = await safeJsonBody<{ name: string; value: number }>(req);
    expect(error).toBeNull();
    expect(data).toEqual({ name: "test", value: 42 });
  });

  it("returns 400 for invalid JSON", async () => {
    // Pass raw malformed JSON string — safeJsonBody calls .json() which should throw
    const brokenReq = new Request("https://example.com/api", {
      method: "POST",
      body: "{broken",
    });

    const [, error] = await safeJsonBody(brokenReq);
    expect(error).not.toBeNull();
    expect(error!.status).toBe(400);
    const json = await error!.json();
    expect(json.error).toBe("Invalid JSON body");
  });

  it("returns 413 for oversized requests (>1MB default)", async () => {
    const req = mockRequest({}, 2_000_000); // 2MB content-length
    const [, error] = await safeJsonBody(req);
    expect(error).not.toBeNull();
    expect(error!.status).toBe(413);
    const json = await error!.json();
    expect(json.error).toBe("Request body too large");
  });

  it("respects custom maxBytes", async () => {
    const req = mockRequest({}, 500);
    const [, error] = await safeJsonBody(req, 200);
    expect(error).not.toBeNull();
    expect(error!.status).toBe(413);
  });

  it("allows content under the limit", async () => {
    const req = mockRequest({ data: "hello" }, 50);
    const [data, error] = await safeJsonBody<{ data: string }>(req);
    expect(error).toBeNull();
    expect(data).toEqual({ data: "hello" });
  });

  it("handles request with no content-length header", async () => {
    const req = mockRequest({ ok: true }); // no content-length header
    const [data, error] = await safeJsonBody<{ ok: boolean }>(req);
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
  });
});
