// Thin client-side wrapper around fetch for the app's standard JSON + CSRF
// mutating requests. Replaces the repeated pattern:
//
//   const res = await fetch(url, {
//     method,
//     headers: csrfHeaders({ "Content-Type": "application/json" }),
//     body: JSON.stringify(body),
//   });
//   const d = (await res.json().catch(() => ({}))) as SomeType;
//
// with a single call that returns the status, ok flag, and parsed body:
//
//   const { ok, status, data } = await csrfFetchJson(url, { method, body });
//   if (!ok || data.error) { setError(data.error ?? `HTTP ${status}`); return; }
//
// Client-only (depends on lib/csrf-client, which no-ops under SSR).

import { csrfHeaders } from "@/lib/csrf-client";

export interface CsrfFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Object body; automatically JSON-stringified. Omit for requests without a body. */
  body?: unknown;
  /** Extra headers merged after the CSRF header. */
  headers?: Record<string, string>;
}

export interface CsrfFetchResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T;
}

export async function csrfFetchJson<T = Record<string, unknown>>(
  url: string,
  options: CsrfFetchOptions = {},
): Promise<CsrfFetchResult<T>> {
  const { method = "POST", body, headers } = options;
  const res = await fetch(url, {
    method,
    headers: csrfHeaders({ "Content-Type": "application/json", ...headers }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}
