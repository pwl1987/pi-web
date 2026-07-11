/**
 * Client-side CSRF token helpers.
 *
 * The server uses a double-submit cookie pattern (see `lib/csrf.ts`):
 * a `__Host-pi-csrf` cookie (httpOnly: false, so readable here) is planted on
 * a bootstrap GET, and every mutating request must echo its value as the
 * `X-CSRF-Token` header.
 *
 * These helpers are browser-only; `readCsrfToken` safely returns `null` when
 * `document` is undefined (SSR / non-browser).
 */

// Canonical names — kept in sync with lib/csrf.ts (server). Duplicated rather
// than imported to avoid pulling `next/server` into the client bundle.
export const CSRF_COOKIE = "__Host-pi-csrf";
export const CSRF_HEADER = "X-CSRF-Token";

/**
 * Read the CSRF token from `document.cookie`, or `null` if absent / in SSR.
 *
 * Parses defensively: cookies are `;`-separated, `name=value` pairs, with the
 * csrf cookie using the `__Host-` prefix. A leading `name=` boundary is
 * required so a similarly-suffixed cookie (`x__Host-pi-csrf`) cannot spoof it.
 */
export function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie;
  if (!cookies) return null;
  for (const part of cookies.split(";")) {
    const trimmed = part.trim();
    // Match `__Host-pi-csrf=...` but not `<anything>__Host-pi-csrf=...`.
    if (
      trimmed.startsWith(CSRF_COOKIE + "=") &&
      // Ensure the char before the name is a boundary (start of string).
      trimmed === `${CSRF_COOKIE}=` + trimmed.slice(CSRF_COOKIE.length + 1)
    ) {
      const value = trimmed.slice(CSRF_COOKIE.length + 1);
      return value || null;
    }
  }
  return null;
}

/**
 * Merge the CSRF header into a `HeadersInit`. Returns a new record; does not
 * mutate the input. If no token is available (SSR, cookie not yet planted),
 * the header is simply omitted — the server will 403 in production, which is
 * the correct safe failure mode.
 */
export function csrfHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = readCsrfToken();
  const headers: Record<string, string> = { ...extra };
  if (token) headers[CSRF_HEADER] = token;
  return headers;
}
