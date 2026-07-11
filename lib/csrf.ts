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

/** Validate the CSRF token on mutating requests.
 *  Returns null if valid, or a 403 response if invalid. */
export function validateCsrf(req: NextRequest | Request): NextResponse | null {
  // Skip CSRF check in development for convenience
  if (process.env.NODE_ENV !== "production") return null;

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
