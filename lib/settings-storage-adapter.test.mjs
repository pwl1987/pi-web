/**
 * Unit tests for lib/settings-storage-adapter.ts — public API 契约。
 * ponytail: 仅测导出符号；normalize 是私有辅助函数。
 */

import assert from "node:assert/strict";
import test from "node:test";

const { defaultAdapter, LocalStorageAdapter } = await import("./settings-storage-adapter.ts");

// ---- defaultAdapter contract ----

test("defaultAdapter is a SettingsStorageAdapter instance", () => {
  assert.equal(typeof defaultAdapter.read, "function");
  assert.equal(typeof defaultAdapter.write, "function");
  assert.equal(typeof defaultAdapter.subscribe, "function");
});

test("defaultAdapter.subscribe returns a working unsubscribe", () => {
  const calls = [];
  const unsub = defaultAdapter.subscribe("test-plugin", (s) => calls.push(s));
  assert.equal(typeof unsub, "function");
  // 重复 unsub 不抛错
  unsub();
  unsub();
});

test("defaultAdapter.read returns null for unknown pluginId", async () => {
  // ponytail: 不依赖 localStorage 的具体内容；node:test 环境无 localStorage → read 应返回 null
  const result = await defaultAdapter.read("__never_written_test_plugin__");
  assert.equal(result, null);
});

// ---- LocalStorageAdapter class ----

test("LocalStorageAdapter is instantiable", () => {
  const a = new LocalStorageAdapter();
  assert.ok(a instanceof LocalStorageAdapter);
  assert.equal(typeof a.read, "function");
  assert.equal(typeof a.write, "function");
  assert.equal(typeof a.subscribe, "function");
});

test("LocalStorageAdapter.read returns null in absence of localStorage", async () => {
  const a = new LocalStorageAdapter();
  const r = await a.read("__absent__");
  assert.equal(r, null);
});
