import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Each test gets an isolated temp dir via PI_CODING_AGENT_DIR so we never touch
// the real ~/.pi/agent. We set the env var before importing the module.

let tmpDir;

test.before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-web-state-"));
  process.env.PI_CODING_AGENT_DIR = tmpDir;
});

test.after(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

async function loadSubject() {
  return import("./session-state-store.ts");
}

function stateFile() {
  return join(tmpDir, "pi-web-state.json");
}

// --- loadSessionState ---

test("loadSessionState returns empty structure when file is missing", async () => {
  const { loadSessionState } = await loadSubject();
  const state = loadSessionState();
  assert.deepEqual(state, { version: 1, activeSessions: [] });
});

test("loadSessionState reads a valid file", async () => {
  const { loadSessionState } = await loadSubject();
  writeFileSync(stateFile(), JSON.stringify({
    version: 1,
    activeSessions: [{ sessionId: "abc", lastActive: 1000, toolsDisabled: false }],
  }));
  const state = loadSessionState();
  assert.equal(state.activeSessions.length, 1);
  assert.equal(state.activeSessions[0].sessionId, "abc");
});

test("loadSessionState returns empty on corrupt JSON", async () => {
  const { loadSessionState } = await loadSubject();
  writeFileSync(stateFile(), "{ this is not valid json }}}");
  const state = loadSessionState();
  assert.deepEqual(state, { version: 1, activeSessions: [] });
});

test("loadSessionState returns empty when version !== 1", async () => {
  const { loadSessionState } = await loadSubject();
  writeFileSync(stateFile(), JSON.stringify({ version: 99, activeSessions: [] }));
  const state = loadSessionState();
  assert.deepEqual(state, { version: 1, activeSessions: [] });
});

test("loadSessionState filters out invalid entries", async () => {
  const { loadSessionState } = await loadSubject();
  writeFileSync(stateFile(), JSON.stringify({
    version: 1,
    activeSessions: [
      { sessionId: "good", lastActive: 1, toolsDisabled: true },
      { sessionId: "no-lastActive", toolsDisabled: false },          // missing field
      { sessionId: "bad-type", lastActive: "x", toolsDisabled: false }, // wrong type
      null,
      "not-an-object",
    ],
  }));
  const state = loadSessionState();
  assert.equal(state.activeSessions.length, 1);
  assert.equal(state.activeSessions[0].sessionId, "good");
});

// --- saveSessionState ---

test("saveSessionState writes a file that loadSessionState can read back", async () => {
  const { saveSessionState, loadSessionState } = await loadSubject();
  saveSessionState({
    version: 1,
    activeSessions: [{ sessionId: "round-trip", lastActive: 42, toolsDisabled: true }],
  });
  assert.ok(existsSync(stateFile()));
  const loaded = loadSessionState();
  assert.equal(loaded.activeSessions[0].sessionId, "round-trip");
  assert.equal(loaded.activeSessions[0].lastActive, 42);
});

// --- recordActiveSession ---

test("recordActiveSession adds a new entry", async () => {
  const { recordActiveSession, loadSessionState } = await loadSubject();
  // Start clean.
  writeFileSync(stateFile(), JSON.stringify({ version: 1, activeSessions: [] }));
  recordActiveSession("session-1", false);
  const state = loadSessionState();
  assert.equal(state.activeSessions.length, 1);
  assert.equal(state.activeSessions[0].sessionId, "session-1");
  assert.equal(state.activeSessions[0].toolsDisabled, false);
  assert.ok(state.activeSessions[0].lastActive > 0);
});

test("recordActiveSession updates an existing entry (refreshes lastActive)", async () => {
  const { recordActiveSession, loadSessionState } = await loadSubject();
  writeFileSync(stateFile(), JSON.stringify({
    version: 1,
    activeSessions: [{ sessionId: "dup", lastActive: 1000, toolsDisabled: false }],
  }));
  recordActiveSession("dup", true);
  const state = loadSessionState();
  assert.equal(state.activeSessions.length, 1, "should not duplicate");
  assert.ok(state.activeSessions[0].lastActive > 1000, "lastActive should be refreshed");
  assert.equal(state.activeSessions[0].toolsDisabled, true);
});

test("recordActiveSession records toolsDisabled correctly", async () => {
  const { recordActiveSession, loadSessionState } = await loadSubject();
  writeFileSync(stateFile(), JSON.stringify({ version: 1, activeSessions: [] }));
  recordActiveSession("tools-off", true);
  const state = loadSessionState();
  assert.equal(state.activeSessions[0].toolsDisabled, true);
});

test("recordActiveSession keeps at most MAX_ENTRIES (20) entries", async () => {
  const { recordActiveSession, loadSessionState } = await loadSubject();
  writeFileSync(stateFile(), JSON.stringify({ version: 1, activeSessions: [] }));
  // Add 25 sessions.
  for (let i = 0; i < 25; i++) {
    recordActiveSession(`s-${i}`, false);
  }
  const state = loadSessionState();
  assert.equal(state.activeSessions.length, 20, "should cap at 20");
  // Most recent (s-24) should be first; oldest (s-5..s-0) should be dropped.
  assert.equal(state.activeSessions[0].sessionId, "s-24");
  assert.equal(state.activeSessions[19].sessionId, "s-5");
});

test("recordActiveSession ignores empty sessionId", async () => {
  const { recordActiveSession, loadSessionState } = await loadSubject();
  writeFileSync(stateFile(), JSON.stringify({ version: 1, activeSessions: [] }));
  recordActiveSession("", false);
  const state = loadSessionState();
  assert.equal(state.activeSessions.length, 0);
});

// --- pruneStaleSessions ---

test("pruneStaleSessions removes entries not in validIds", async () => {
  const { pruneStaleSessions, loadSessionState } = await loadSubject();
  writeFileSync(stateFile(), JSON.stringify({
    version: 1,
    activeSessions: [
      { sessionId: "keep", lastActive: 1, toolsDisabled: false },
      { sessionId: "drop", lastActive: 2, toolsDisabled: false },
    ],
  }));
  pruneStaleSessions(new Set(["keep"]));
  const state = loadSessionState();
  assert.equal(state.activeSessions.length, 1);
  assert.equal(state.activeSessions[0].sessionId, "keep");
});

test("pruneStaleSessions does nothing when all are valid", async () => {
  const { pruneStaleSessions, loadSessionState } = await loadSubject();
  writeFileSync(stateFile(), JSON.stringify({
    version: 1,
    activeSessions: [{ sessionId: "a", lastActive: 1, toolsDisabled: false }],
  }));
  pruneStaleSessions(new Set(["a"]));
  const state = loadSessionState();
  assert.equal(state.activeSessions.length, 1);
});
