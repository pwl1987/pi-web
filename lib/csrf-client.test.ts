// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

// Client-side CSRF helpers. readCsrfToken() parses the __Host-pi-csrf cookie
// from document.cookie; csrfHeaders() merges the X-CSRF-Token header into a
// fetch headers init. These are pure w.r.t. the injected document mock.
const { readCsrfToken, CSRF_HEADER, CSRF_COOKIE, csrfHeaders } = await import("./csrf-client");

// Minimal document shim — the real client runs in the browser; here we inject
// a controllable cookie string.
function setDocumentCookie(value: string) {
  (globalThis as unknown as { document?: { cookie: string } }).document = { cookie: value };
}
function clearDocument() {
  delete (globalThis as unknown as { document?: unknown }).document;
}

describe("readCsrfToken", () => {
  beforeEach(clearDocument);

  it("reads the token when the csrf cookie is present", () => {
    setDocumentCookie("__Host-pi-csrf=abc-123; other=zzz");
    expect(readCsrfToken()).toBe("abc-123");
  });

  it("handles the csrf cookie at the end of the cookie string", () => {
    setDocumentCookie("theme=dark; __Host-pi-csrf=token-xyz");
    expect(readCsrfToken()).toBe("token-xyz");
  });

  it("returns null when the cookie is absent", () => {
    setDocumentCookie("theme=dark; lang=en");
    expect(readCsrfToken()).toBeNull();
  });

  it("returns null when document is undefined (SSR)", () => {
    clearDocument();
    expect(readCsrfToken()).toBeNull();
  });

  it("does not match a similarly-named cookie (prefix safety)", () => {
    setDocumentCookie("not__Host-pi-csrf=evil; __Host-pi-csrf=good");
    expect(readCsrfToken()).toBe("good");
  });
});

describe("csrfHeaders", () => {
  it("adds the X-CSRF-Token header when a token is available", () => {
    setDocumentCookie("__Host-pi-csrf=t1");
    const headers = csrfHeaders({ "Content-Type": "application/json" });
    expect(headers[CSRF_HEADER]).toBe("t1");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("preserves caller headers and does not throw when token is missing", () => {
    clearDocument();
    const headers = csrfHeaders({ "Content-Type": "application/json" });
    expect(headers[CSRF_HEADER]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("constants", () => {
  it("exports the canonical header and cookie names", () => {
    expect(CSRF_HEADER).toBe("X-CSRF-Token");
    expect(CSRF_COOKIE).toBe("__Host-pi-csrf");
  });
});

// keep vi import referenced for future mock usage
void vi;
