import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * CSRF protection for Next.js API Route Handlers.
 *
 * Strategy: double-submit cookie pattern.
 * - On first request, the server sets a SameSite=Lax csrf cookie and returns
 *   its value in a response header.
 * - The client reads the cookie value and sends it as `X-CSRF-Token` header
 *   on every mutating request (POST/PUT/PATCH/DELETE).
 * - The server verifies the header matches the cookie.
 *
 * Since Next.js Route Handlers don't have built-in CSRF protection (unlike
 * Server Actions), this middleware-style helper is applied per-route.
 */

const CSRF_COOKIE = "__Host-pi-csrf";
const CSRF_HEADER = "X-CSRF-Token";

function generateToken(): string {
  return crypto.randomUUID();
}

/** Set the CSRF cookie on a response. Call this on GET responses that the
 *  client will use to bootstrap the token. */
export function setCsrfCookie(response: NextResponse): NextResponse {
  response.cookies.set(CSRF_COOKIE, generateToken(), {
    httpOnly: false, // client needs to read it
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
    maxAge: 60 * 60 * 24, // 24 hours
  });
  return response;
}

/**
 * 是否启用 CSRF 防护。
 *
 * 历史：早期仅在 NODE_ENV==="production" 时校验，开发模式完全放行，导致
 * 本地服务一旦暴露即无状态变更防护（对抗性评审 S2）。现改为**默认全环境开启**，
 * 仅当显式设置 `PI_WEB_DISABLE_CSRF=1` 时才降级放行（与 S1 的 `PI_WEB_DISABLE_AUTH`
 * 同理，防止自锁门外/本地联调不便）。
 */
function csrfEnabled(): boolean {
  return process.env.PI_WEB_DISABLE_CSRF !== "1";
}

/** Validate the CSRF token on mutating requests.
 *  Returns null if valid, or a 403 response if invalid. */
export function validateCsrf(req: NextRequest | Request): NextResponse | null {
  if (!csrfEnabled()) return null;

  const cookieToken = req.headers
    .get("cookie")
    ?.split(";")
    .find((c) => c.trim().startsWith(`${CSRF_COOKIE}=`))
    ?.split("=")[1]
    ?.trim();

  const headerToken = req.headers.get(CSRF_HEADER);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  return null;
}

export { CSRF_COOKIE, CSRF_HEADER };
