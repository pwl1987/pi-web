/**
 * Tests for lib/csrf.ts — CSRF double-submit cookie protection.
 * Seams under test:
 *   1. setCsrfCookie(response) — sets __Host-pi-csrf cookie with correct attributes
 *   2. validateCsrf(req) — validates token in production, skips in dev
 *   3. CSRF_COOKIE / CSRF_HEADER constants — correct values
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextResponse } from "next/server";

// Import after setting up env stubs
import { setCsrfCookie, validateCsrf, CSRF_COOKIE, CSRF_HEADER } from "./csrf";

describe("CSRF_COOKIE / CSRF_HEADER constants", () => {
  it("CSRF_COOKIE uses __Host- prefix for cookie prefix security", () => {
    expect(CSRF_COOKIE).toBe("__Host-pi-csrf");
  });

  it("CSRF_HEADER is X-CSRF-Token", () => {
    expect(CSRF_HEADER).toBe("X-CSRF-Token");
  });
});

describe("setCsrfCookie", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets the CSRF cookie on a response", () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = NextResponse.json({ ok: true });
    const cookieRes = setCsrfCookie(res);

    // Verify cookie was set by checking Set-Cookie header
    const setCookie = cookieRes.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain(CSRF_COOKIE);
  });

  it("cookie has correct attributes: path=/api, sameSite=lax, httpOnly=false", () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = NextResponse.json({ ok: true });
    const cookieRes = setCsrfCookie(res);
    const setCookie = (cookieRes.headers.get("set-cookie") ?? "").toLowerCase();

    expect(setCookie).toContain("path=/api");
    // sameSite reported as "lax" (lowercase) by Node.js NextResponse
    expect(setCookie).toMatch(/samesite=lax/);
    expect(setCookie).toContain("max-age=86400"); // 24 hours
    // httpOnly is NOT set (false is default, so it won't appear in the string)
  });

  it("sets secure flag in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = NextResponse.json({ ok: true });
    const cookieRes = setCsrfCookie(res);
    const setCookie = cookieRes.headers.get("set-cookie") ?? "";

    expect(setCookie).toContain("Secure");
  });

  it("does NOT set secure flag in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = NextResponse.json({ ok: true });
    const cookieRes = setCsrfCookie(res);
    const setCookie = cookieRes.headers.get("set-cookie") ?? "";

    expect(setCookie).not.toContain("Secure");
  });

  it("preserves the original response status and body", () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = NextResponse.json({ hello: "world" }, { status: 201 });
    const cookieRes = setCsrfCookie(res);

    expect(cookieRes.status).toBe(201);
  });
});

describe("validateCsrf", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null (passes) in development mode regardless of tokens", () => {
    vi.stubEnv("NODE_ENV", "development");
    const req = new Request("https://example.com/api/test", {
      method: "POST",
    });

    expect(validateCsrf(req)).toBeNull();
  });

  it("returns 403 when no CSRF cookie is present", () => {
    vi.stubEnv("NODE_ENV", "production");
    const req = new Request("https://example.com/api/test", {
      method: "POST",
      headers: {
        [CSRF_HEADER]: "some-token",
      },
    });

    const result = validateCsrf(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it("returns 403 when no CSRF header is present", () => {
    vi.stubEnv("NODE_ENV", "production");
    const req = new Request("https://example.com/api/test", {
      method: "POST",
      headers: {
        cookie: `${CSRF_COOKIE}=some-token`,
      },
    });

    const result = validateCsrf(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it("returns 403 when token mismatch", () => {
    vi.stubEnv("NODE_ENV", "production");
    const req = new Request("https://example.com/api/test", {
      method: "POST",
      headers: {
        cookie: `${CSRF_COOKIE}=cookie-token`,
        [CSRF_HEADER]: "header-different-token",
      },
    });

    const result = validateCsrf(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it("returns null when tokens match (valid)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const matchingToken = "abc-123-def";
    const req = new Request("https://example.com/api/test", {
      method: "POST",
      headers: {
        cookie: `${CSRF_COOKIE}=${matchingToken}`,
        [CSRF_HEADER]: matchingToken,
      },
    });

    const result = validateCsrf(req);
    expect(result).toBeNull();
  });

  it("returns 403 when cookie has extra whitespace around token", () => {
    vi.stubEnv("NODE_ENV", "production");
    const req = new Request("https://example.com/api/test", {
      method: "POST",
      headers: {
        cookie: `${CSRF_COOKIE}= token-with-spaces ; other=value`,
        [CSRF_HEADER]: "token-with-spaces",
      },
    });

    const result = validateCsrf(req);
    expect(result).toBeNull();
  });

  it("returns 403 when cookie value is empty", () => {
    vi.stubEnv("NODE_ENV", "production");
    const req = new Request("https://example.com/api/test", {
      method: "POST",
      headers: {
        cookie: `${CSRF_COOKIE}=`,
        [CSRF_HEADER]: "some-token",
      },
    });

    const result = validateCsrf(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});
