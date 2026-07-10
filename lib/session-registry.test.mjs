import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./session-registry.ts");
}

// Each test gets a clean globalThis state so registry/locks/listeners don't
// bleed between tests.
function resetGlobals() {
  delete globalThis.__piSessions;
  delete globalThis.__piStartLocks;
  delete globalThis.__piRunningListeners;
}

test.beforeEach(() => resetGlobals());
test.afterEach(() => resetGlobals());

// Minimal mock session handle for registry/broadcaster tests.
function mockSession(id, { running = false, alive = true } = {}) {
  return {
    sessionId: id,
    isRunning: () => running,
    isAlive: () => alive,
    destroy: () => {},
  };
}

// --- Registry basics ---

test("getRegistry returns the same Map instance across calls", async () => {
  const { getRegistry } = await loadSubject();
  const a = getRegistry();
  const b = getRegistry();
  assert.equal(a, b, "should be the same instance (globalThis-backed)");
});

test("getRpcSession returns undefined for unknown id", async () => {
  const { getRpcSession } = await loadSubject();
  assert.equal(getRpcSession("nonexistent"), undefined);
});

test("getRpcSession returns a session that was added to the registry", async () => {
  const { getRegistry, getRpcSession } = await loadSubject();
  const session = mockSession("s1");
  getRegistry().set("s1", session);
  assert.equal(getRpcSession("s1"), session);
});

// --- getRunningRpcSessionIds ---

test("getRunningRpcSessionIds returns only running sessions", async () => {
  const { getRegistry, getRunningRpcSessionIds } = await loadSubject();
  getRegistry().set("idle", mockSession("idle", { running: false }));
  getRegistry().set("busy", mockSession("busy", { running: true }));
  const ids = getRunningRpcSessionIds();
  assert.deepEqual(ids, ["busy"]);
});

test("getRunningRpcSessionIds returns empty array when no sessions are running", async () => {
  const { getRunningRpcSessionIds } = await loadSubject();
  assert.deepEqual(getRunningRpcSessionIds(), []);
});

test("getRunningRpcSessionIds uses sessionId or registry key as fallback", async () => {
  const { getRegistry, getRunningRpcSessionIds } = await loadSubject();
  // Session with empty sessionId falls back to registry key.
  getRegistry().set("fallback-key", mockSession("", { running: true }));
  const ids = getRunningRpcSessionIds();
  assert.deepEqual(ids, ["fallback-key"]);
});

// --- notifyRunningChange dedup ---

test("notifyRunningChange broadcasts when the running set changes", async () => {
  const { getRegistry, subscribeRunningSessions, notifyRunningChange, _resetRunningSnapshot } = await loadSubject();
  _resetRunningSnapshot();

  let received = null;
  subscribeRunningSessions((ids) => { received = ids; });

  getRegistry().set("s1", mockSession("s1", { running: true }));
  notifyRunningChange();

  assert.deepEqual(received, ["s1"]);
});

test("notifyRunningChange does NOT broadcast when the running set is unchanged", async () => {
  const { getRegistry, subscribeRunningSessions, notifyRunningChange, _resetRunningSnapshot } = await loadSubject();
  _resetRunningSnapshot();

  let callCount = 0;
  subscribeRunningSessions(() => { callCount++; });

  getRegistry().set("s1", mockSession("s1", { running: true }));
  notifyRunningChange();
  assert.equal(callCount, 1, "first call should broadcast");

  // Same set — should not broadcast again.
  notifyRunningChange();
  assert.equal(callCount, 1, "second call with same set should NOT broadcast");
});

test("notifyRunningChange broadcasts again after a session stops running", async () => {
  const { getRegistry, subscribeRunningSessions, notifyRunningChange, _resetRunningSnapshot } = await loadSubject();
  _resetRunningSnapshot();

  const events = [];
  subscribeRunningSessions((ids) => { events.push([...ids]); });

  const session = mockSession("s1", { running: true });
  getRegistry().set("s1", session);
  notifyRunningChange();
  assert.equal(events.length, 1);

  // Simulate session stopping.
  getRegistry().delete("s1");
  notifyRunningChange();
  assert.equal(events.length, 2);
  assert.deepEqual(events[1], []);
});

test("notifyRunningChange handles multiple subscribers", async () => {
  const { getRegistry, subscribeRunningSessions, notifyRunningChange, _resetRunningSnapshot } = await loadSubject();
  _resetRunningSnapshot();

  let a = null, b = null;
  subscribeRunningSessions((ids) => { a = ids; });
  subscribeRunningSessions((ids) => { b = ids; });

  getRegistry().set("s1", mockSession("s1", { running: true }));
  notifyRunningChange();

  assert.deepEqual(a, ["s1"]);
  assert.deepEqual(b, ["s1"]);
});

test("notifyRunningChange ignores a throwing listener", async () => {
  const { getRegistry, subscribeRunningSessions, notifyRunningChange, _resetRunningSnapshot } = await loadSubject();
  _resetRunningSnapshot();

  let goodReceived = null;
  subscribeRunningSessions(() => { throw new Error("boom"); });
  subscribeRunningSessions((ids) => { goodReceived = ids; });

  getRegistry().set("s1", mockSession("s1", { running: true }));
  // Should not throw despite the bad listener.
  notifyRunningChange();
  assert.deepEqual(goodReceived, ["s1"]);
});

// --- subscribeRunningSessions ---

test("subscribeRunningSessions returns an unsubscribe function", async () => {
  const { subscribeRunningSessions, notifyRunningChange, _resetRunningSnapshot } = await loadSubject();
  _resetRunningSnapshot();

  let received = [];
  const unsub = subscribeRunningSessions((ids) => { received = ids; });
  assert.equal(typeof unsub, "function");

  unsub();
  notifyRunningChange();
  // After unsubscribe, no more callbacks.
  assert.deepEqual(received, []);
});

// --- getLocks ---

test("getLocks returns the same Map instance across calls", async () => {
  const { getLocks } = await loadSubject();
  const a = getLocks();
  const b = getLocks();
  assert.equal(a, b);
});

test("getLocks stores and retrieves in-flight start promises", async () => {
  const { getLocks } = await loadSubject();
  const locks = getLocks();
  const promise = Promise.resolve({ session: mockSession("s1"), realSessionId: "s1" });
  locks.set("s1", promise);
  assert.equal(locks.get("s1"), promise);
  locks.delete("s1");
  assert.equal(locks.has("s1"), false);
});
