// Pure unit test for the unified capability registry (no SDK import).
// Run: node --test --experimental-strip-types lib/capabilities/registry.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry, getCapabilityRegistry } from "./registry.ts";

function make(kind, id, enabled = true) {
  return { kind, id, name: id, source: { type: "local", id }, enabled };
}

test("register / list / query by kind", () => {
  const r = new CapabilityRegistry();
  r.register(make("extension", "extension:a"));
  r.register(make("skill", "skill:b", false));
  assert.equal(r.list().length, 2);
  assert.equal(r.list("extension").length, 1);
  assert.equal(r.get("skill:b")?.enabled, false);
  assert.equal(r.get("missing"), undefined);
});

test("setEnabled updates and notifies subscribers", () => {
  const r = new CapabilityRegistry();
  let notifications = 0;
  r.subscribe(() => {
    notifications++;
  });
  r.register(make("plugin", "plugin:x"));
  r.setEnabled("plugin:x", false);
  assert.equal(r.get("plugin:x")?.enabled, false);
  // register + setEnabled each bump the version once.
  assert.ok(notifications >= 2);
});

test("unregister removes and notifies", () => {
  const r = new CapabilityRegistry();
  let notifications = 0;
  r.subscribe(() => {
    notifications++;
  });
  r.register(make("subagent", "subagent:y"));
  assert.equal(r.list().length, 1);
  r.unregister("subagent:y");
  assert.equal(r.list().length, 0);
  assert.ok(notifications >= 2);
});

test("singleton is stable across getCapabilityRegistry()", () => {
  const a = getCapabilityRegistry();
  const b = getCapabilityRegistry();
  assert.equal(a, b);
});
