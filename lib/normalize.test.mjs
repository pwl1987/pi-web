import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./normalize.ts");
}

test("maps pi file-format toolCall to internal format", async () => {
  const { normalizeToolCalls } = await loadSubject();
  const msg = {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "tc-1",
        name: "write_file",
        arguments: { path: "/a.ts", content: "x" },
      },
    ],
  };
  const result = normalizeToolCalls(msg);
  const block = result.content[0];
  assert.equal(block.type, "toolCall");
  assert.equal(block.toolCallId, "tc-1");
  assert.equal(block.toolName, "write_file");
  assert.deepEqual(block.input, { path: "/a.ts", content: "x" });
});

test("does not re-normalize already-correct toolCall blocks", async () => {
  const { normalizeToolCalls } = await loadSubject();
  const msg = {
    role: "assistant",
    content: [{ type: "toolCall", toolCallId: "tc-1", toolName: "read", input: { path: "/b" } }],
  };
  const result = normalizeToolCalls(msg);
  const block = result.content[0];
  assert.equal(block.toolCallId, "tc-1");
  assert.equal(block.toolName, "read");
  assert.deepEqual(block.input, { path: "/b" });
});

test("passes through non-assistant messages unchanged", async () => {
  const { normalizeToolCalls } = await loadSubject();
  const msg = { role: "user", content: "hello" };
  const result = normalizeToolCalls(msg);
  assert.equal(result, msg, "should return the same reference");
});

test("passes through assistant messages with non-array content", async () => {
  const { normalizeToolCalls } = await loadSubject();
  const msg = { role: "assistant", content: "text" };
  const result = normalizeToolCalls(msg);
  assert.equal(result, msg, "should return the same reference");
});

test("passes through non-toolCall blocks unchanged", async () => {
  const { normalizeToolCalls } = await loadSubject();
  const textBlock = { type: "text", text: "hi" };
  const msg = { role: "assistant", content: [textBlock] };
  const result = normalizeToolCalls(msg);
  assert.equal(result.content[0], textBlock, "text block should be the same reference");
});

test("defaults missing fields to empty values", async () => {
  const { normalizeToolCalls } = await loadSubject();
  const msg = {
    role: "assistant",
    content: [{ type: "toolCall" }], // no id/name/arguments at all
  };
  const result = normalizeToolCalls(msg);
  const block = result.content[0];
  assert.equal(block.toolCallId, "");
  assert.equal(block.toolName, "");
  assert.deepEqual(block.input, {});
});

test("handles toolCall with only id (no name/arguments)", async () => {
  const { normalizeToolCalls } = await loadSubject();
  const msg = {
    role: "assistant",
    content: [{ type: "toolCall", id: "only-id" }],
  };
  const result = normalizeToolCalls(msg);
  const block = result.content[0];
  assert.equal(block.toolCallId, "only-id");
  assert.equal(block.toolName, "");
  assert.deepEqual(block.input, {});
});

test("prefers internal field names when both exist", async () => {
  const { normalizeToolCalls } = await loadSubject();
  const msg = {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "file-id",
        name: "file-name",
        arguments: { a: 1 },
        toolCallId: "internal-id",
        toolName: "internal-name",
        input: { b: 2 },
      },
    ],
  };
  const result = normalizeToolCalls(msg);
  const block = result.content[0];
  assert.equal(block.toolCallId, "internal-id", "should prefer toolCallId over id");
  assert.equal(block.toolName, "internal-name", "should prefer toolName over name");
  assert.deepEqual(block.input, { b: 2 }, "should prefer input over arguments");
});

test("mixes toolCall and text blocks correctly", async () => {
  const { normalizeToolCalls } = await loadSubject();
  const msg = {
    role: "assistant",
    content: [
      { type: "text", text: "Let me read the file." },
      { type: "toolCall", id: "tc", name: "read", arguments: { path: "/x" } },
      { type: "text", text: "Done." },
    ],
  };
  const result = normalizeToolCalls(msg);
  assert.equal(result.content[0].type, "text");
  assert.equal(result.content[1].toolCallId, "tc");
  assert.equal(result.content[2].type, "text");
});
