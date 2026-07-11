import assert from "node:assert/strict";
import test from "node:test";

// Shared agent-command allowlist extracted from app/api/agent/[id]/route.ts so
// both the [id] and the /new routes enforce the same gate.
const { ALLOWED_AGENT_COMMANDS, isAllowedAgentCommand } = await import("./allowed-commands.ts");

test("ALLOWED_AGENT_COMMANDS includes core prompt lifecycle commands", () => {
  for (const cmd of ["prompt", "abort", "get_state", "fork", "compact", "set_model"]) {
    assert.ok(ALLOWED_AGENT_COMMANDS.has(cmd), `expected allowlist to include ${cmd}`);
  }
});

test("isAllowedAgentCommand returns true for a known command", () => {
  assert.equal(isAllowedAgentCommand("prompt"), true);
});

test("isAllowedAgentCommand returns false for an arbitrary/unknown command", () => {
  assert.equal(isAllowedAgentCommand("nonsense"), false);
});

test("isAllowedAgentCommand returns false for an empty string", () => {
  assert.equal(isAllowedAgentCommand(""), false);
});

test("isAllowedAgentCommand returns false for ensure_session (internal pseudo-command, never dispatched to the agent)", () => {
  // agent/new special-cases ensure_session to NOT call session.send; it must
  // therefore not be treated as a dispatchable command by the shared gate.
  assert.equal(isAllowedAgentCommand("ensure_session"), false);
});
