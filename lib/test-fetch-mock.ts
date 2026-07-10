// Shared test helpers for vitest component/hook tests.
//
// Kept framework-agnostic (just vi + fetch) so any test file can import
// it regardless of its jsdom pragma.

import { vi } from "vitest";

/**
 * Queue a sequence of mock fetch responses. Each call to `fetch()`
 * returns the next response in order. The response shape matches what
 * the components expect: { ok, status, json }.
 *
 * Example:
 *   mockFetchSequence([
 *     { body: { pinnedDirs: [...] } },   // initial GET
 *     { body: { removed: true } },         // DELETE response
 *   ]);
 */
export function mockFetchSequence(
  responses: { body: unknown; status?: number }[],
): void {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: (r.status ?? 200) === 200,
      status: r.status ?? 200,
      json: async () => r.body,
    } as unknown as Response);
  }
  globalThis.fetch = fn as unknown as typeof fetch;
}

/**
 * Queue a single mock fetch response that repeats indefinitely (every
 * call to `fetch()` returns the same shape). Useful for hooks that
 * re-fetch on bus events where the response doesn't change between
 * calls.
 */
export function mockFetchAlways(
  body: unknown,
  status = 200,
): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status === 200,
    status,
    json: async () => body,
  } as unknown as Response) as unknown as typeof fetch;
}
