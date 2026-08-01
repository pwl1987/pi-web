import assert from "node:assert/strict";
import test from "node:test";

// Pure validators for config-write endpoints (models.json, mcp.json) so the
// shape checks are unit-testable without a running server.
const { validateModelsConfig, validateMcpServers } = await import("./config-validators.ts");

// ---- validateModelsConfig ----

test("validateModelsConfig accepts a well-formed config object", () => {
  const ok = validateModelsConfig({ providers: { openai: { models: [] } } });
  assert.equal(ok, null);
});

test("validateModelsConfig rejects a non-object body", () => {
  const err = validateModelsConfig("not-an-object");
  assert.match(err.error, /must be a JSON object/i);
  assert.equal(err.status, 400);
});

test("validateModelsConfig rejects an array", () => {
  const err = validateModelsConfig([]);
  assert.equal(err.status, 400);
});

test("validateModelsConfig rejects null", () => {
  const err = validateModelsConfig(null);
  assert.equal(err.status, 400);
});

// ---- validateMcpServers ----

test("validateMcpServers accepts valid stdio entries", () => {
  const ok = validateMcpServers({
    fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
  });
  assert.equal(ok, null);
});

test("validateMcpServers accepts valid url entries", () => {
  const ok = validateMcpServers({ remote: { url: "https://example.com/sse" } });
  assert.equal(ok, null);
});

test("validateMcpServers rejects a non-object", () => {
  const err = validateMcpServers("x");
  assert.equal(err.status, 400);
});

test("validateMcpServers rejects a stdio entry with empty command", () => {
  const err = validateMcpServers({ bad: { command: "" } });
  assert.match(err.error, /command/i);
  assert.equal(err.status, 400);
});

test("validateMcpServers rejects when args is not a string array", () => {
  const err = validateMcpServers({ bad: { command: "npx", args: ["ok", 123] } });
  assert.equal(err.status, 400);
});

test("validateMcpServers rejects a server entry that is neither stdio nor url", () => {
  const err = validateMcpServers({ bad: {} });
  assert.match(err.error, /command.*url/i);
  assert.equal(err.status, 400);
});
