import assert from "node:assert/strict";
import test from "node:test";

// reparentSessionHeader is a pure function that rewrites only the first line
// (the session header JSON) of a .jsonl file, leaving every subsequent byte
// untouched. This avoids the prior bug where the whole file was split, joined,
// and rewritten — normalizing line endings and re-serializing large files just
// to change one header field.
const { reparentSessionHeader } = await import("./session-reparent.ts");

test("replaces the parentSession field in the header line and preserves the rest verbatim", () => {
  const original =
    '{"type":"session","id":"a","parentSession":"/old/parent.jsonl"}\n' +
    '{"type":"message","id":"m1"}\n' +
    '{"type":"message","id":"m2"}\n';
  const result = reparentSessionHeader(original, "/new/parent.jsonl");
  const [headerLine, ...rest] = result.split("\n");
  assert.equal(JSON.parse(headerLine).parentSession, "/new/parent.jsonl");
  // The remainder must be byte-identical to the input's tail.
  assert.equal(rest.join("\n"), original.split("\n").slice(1).join("\n"));
});

test("sets parentSession to undefined when newParent is undefined (detach from tree)", () => {
  const original = '{"type":"session","id":"a","parentSession":"/old.jsonl"}\n{"type":"message"}\n';
  const result = reparentSessionHeader(original, undefined);
  const header = JSON.parse(result.split("\n")[0]);
  assert.equal(header.parentSession, undefined);
});

test("only rewrites the header of a session line; leaves non-session first line unchanged", () => {
  // A file whose first line isn't a session header should be returned unchanged.
  const original = '{"type":"message","id":"m0"}\n{"type":"message","id":"m1"}\n';
  const result = reparentSessionHeader(original, "/new.jsonl");
  assert.equal(result, original);
});

test("preserves a trailing newline and exact bytes of message lines", () => {
  const messageBlock = '{"type":"message","id":"m1","content":"hi\\nthere"}\n'.repeat(500);
  const original = '{"type":"session","id":"a","parentSession":"/o.jsonl"}\n' + messageBlock;
  const result = reparentSessionHeader(original, "/n.jsonl");
  // Everything after the first newline is untouched.
  assert.equal(result.slice(result.indexOf("\n") + 1), messageBlock);
});

test("returns the input unchanged when the header line is not valid JSON", () => {
  const original = 'not-json-at-all\n{"type":"message"}\n';
  const result = reparentSessionHeader(original, "/new.jsonl");
  assert.equal(result, original);
});
