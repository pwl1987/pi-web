import { NextResponse } from "next/server";

/** Standardized error response helper for all API routes.
 *  In production, returns a generic message; in dev, includes the real error.
 *  Prevents internal error details from leaking to clients. */
export function errorResponse(error: unknown, status = 500): NextResponse {
  const message =
    process.env.NODE_ENV === "development"
      ? error instanceof Error
        ? error.message
        : String(error)
      : "Internal server error";
  return NextResponse.json({ error: message }, { status });
}

/** Safely parse a JSON request body with a max size limit (default 1 MB).
 *  Returns a tuple of [parsed, errorResponse] — if errorResponse is set,
 *  the caller should return it immediately. */
export async function safeJsonBody<T = unknown>(
  req: Request,
  maxBytes = 1_048_576,
): Promise<[T, null] | [null, NextResponse]> {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) {
    return [null, NextResponse.json({ error: "Request body too large" }, { status: 413 })];
  }
  try {
    const body = await req.json();
    return [body as T, null];
  } catch {
    return [null, NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })];
  }
}
