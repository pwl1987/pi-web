// Shared helpers extracted from API route handlers to eliminate duplication.
//
// These are pure functions used across multiple app/api route handlers. Only a
// type import for AssistantMessage is pulled in, so the module is usable from
// both Next route handlers and tests.

import type { AssistantMessage } from "@earendil-works/pi-ai/compat";

const NON_PRINTABLE_OR_DELIM = /[^\x20-\x7E]|[":;\\\r\n]/g;
const RFC5987_RESERVED = /['!()*]/g;

// Directory and artifact names skipped when listing files or building the file
// index. Shared by the files list route and the file-index route non-git
// fallback. Git-tracked repos rely on .gitignore instead.
const IGNORED_NAME_LIST = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "__pycache__",
  ".turbo",
  ".cache",
  "coverage",
  ".pytest_cache",
  ".mypy_cache",
  "target",
  "vendor",
  ".DS_Store",
];

export const IGNORED_NAMES: ReadonlySet<string> = new Set(IGNORED_NAME_LIST);

export const IGNORED_SUFFIXES: readonly string[] = [".pyc"];

// RFC 5987 encoder for Content-Disposition filename parameters: encodes the
// value plus reserved punctuation that encodeURIComponent leaves intact.
export function encodeHeaderValue(value: string): string {
  return encodeURIComponent(value).replace(RFC5987_RESERVED, (ch) => {
    const hex = ch.charCodeAt(0).toString(16).toUpperCase();
    return "%" + hex;
  });
}

// Build a Content-Disposition header with an ASCII fallback filename (correctly
// quoted per RFC 6266) and a UTF-8 RFC 5987 filename* parameter.
// `disposition` defaults to "attachment"; pass "inline" for browserside preview
// (e.g. the /api/files route that streams content into the viewer).
export function getAttachmentDisposition(
  fileName: string,
  disposition: "attachment" | "inline" = "attachment",
): string {
  const printable = fileName.replace(NON_PRINTABLE_OR_DELIM, "_");
  const fallback = printable.length > 0 ? printable : "file";
  const encoded = encodeHeaderValue(fileName);
  return `${disposition}; filename=${JSON.stringify(fallback)}; filename*=UTF-8''${encoded}`;
}

// Concatenate the text blocks of an assistant message.
export function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

// Coerce a caught error into a message string for user-facing responses.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
