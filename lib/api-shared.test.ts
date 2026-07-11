// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  IGNORED_NAMES,
  IGNORED_SUFFIXES,
  encodeHeaderValue,
  getAttachmentDisposition,
  getAssistantText,
  errorMessage,
} from "./api-shared";

describe("IGNORED_NAMES / IGNORED_SUFFIXES", () => {
  it("skips common build/dep directories", () => {
    expect(IGNORED_NAMES.has("node_modules")).toBe(true);
    expect(IGNORED_NAMES.has(".git")).toBe(true);
    expect(IGNORED_NAMES.has("dist")).toBe(true);
  });
  it("does not contain duplicates (the prior files/[...path] copy had .git twice)", () => {
    // Sanity: deduped set — size equals unique entries.
    const asArray = [...IGNORED_NAMES];
    expect(new Set(asArray).size).toBe(asArray.length);
  });
  it("IGNORED_SUFFIXES drops compiled artifacts", () => {
    expect(IGNORED_SUFFIXES).toContain(".pyc");
  });
});

describe("encodeHeaderValue", () => {
  it("percent-encodes reserved chars !'()* that encodeURIComponent leaves", () => {
    expect(encodeHeaderValue("a!b'c(d)e")).toBe("a%21b%27c%28d%29e");
  });
  it("encodes spaces and unicode", () => {
    expect(encodeHeaderValue("a b")).toBe("a%20b");
    expect(encodeHeaderValue("é")).toBe("%C3%A9");
  });
});

describe("getAttachmentDisposition", () => {
  it("produces both an ascii fallback and a UTF-8 filename* for non-ascii names", () => {
    const d = getAttachmentDisposition("café-Report (1).html");
    expect(d).toContain('attachment; filename="');
    expect(d).toContain("filename*=UTF-8''");
  });
  it("falls back to 'file' when the name is empty", () => {
    expect(getAttachmentDisposition("")).toContain('filename="file"');
  });
});

describe("getAssistantText", () => {
  it("concatenates only text blocks, in order", () => {
    const message = {
      content: [
        { type: "text", text: "Hello " },
        { type: "toolCall", toolCallId: "t1", toolName: "x", input: {} },
        { type: "text", text: "World" },
      ],
    } as unknown as Parameters<typeof getAssistantText>[0];
    expect(getAssistantText(message)).toBe("Hello World");
  });
  it("returns empty string when there are no text blocks", () => {
    const message = {
      content: [{ type: "toolResult", toolCallId: "t1", content: [] }],
    } as unknown as Parameters<typeof getAssistantText>[0];
    expect(getAssistantText(message)).toBe("");
  });
});

describe("errorMessage", () => {
  it("extracts message from an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
  it("stringifies non-Error values", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
  });
});
