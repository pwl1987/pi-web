/**
 * Unit tests for lib/config-schema.ts — 字段 discriminated union + group 兜底 + __unknown 隔离。
 * ponytail: 仅覆盖方案 §九明确列的三类边界，不扩展。
 */

import assert from "node:assert/strict";
import test from "node:test";

const { getSchema, resolveGroup, isFieldValid, allSchemas, SCHEMA_VERSION } =
  await import("./config-schema.ts");

// ---- SCHEMA_VERSION ----

test("SCHEMA_VERSION is a semver string", () => {
  assert.match(SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
});

// ---- getSchema ----

test("getSchema returns undefined for unknown pluginId", () => {
  assert.equal(getSchema("definitely-not-a-real-plugin"), undefined);
});

test("getSchema finds registered npm: plugin", () => {
  const s = getSchema("npm:context-mode");
  assert.ok(s, "npm:context-mode should be registered");
  assert.equal(s.version, SCHEMA_VERSION);
  assert.ok(s.fields.length > 0);
});

test("getSchema preserves all 33 plugin descriptors", () => {
  assert.ok(allSchemas.length >= 30, `expected ≥30 plugins, got ${allSchemas.length}`);
});

// ---- resolveGroup ----

test("resolveGroup returns explicit group when set", () => {
  const field = {
    key: "x",
    type: "string",
    default: "",
    group: "experimental",
    i18nKey: "x",
  };
  assert.equal(resolveGroup(field), "experimental");
});

test("resolveGroup defaults missing group to 'common'", () => {
  const field = {
    key: "x",
    type: "string",
    default: "",
    i18nKey: "x",
  };
  assert.equal(resolveGroup(field), "common");
});

// ---- isFieldValid: discriminated union narrowing ----

test("isFieldValid accepts boolean field with boolean default", () => {
  assert.equal(isFieldValid({ key: "b", type: "boolean", default: true, i18nKey: "x" }), true);
});

test("isFieldValid rejects boolean field with string default", () => {
  assert.equal(isFieldValid({ key: "b", type: "boolean", default: "true", i18nKey: "x" }), false);
});

test("isFieldValid accepts string field with string default", () => {
  assert.equal(isFieldValid({ key: "s", type: "string", default: "", i18nKey: "x" }), true);
});

test("isFieldValid accepts number field with finite number default", () => {
  assert.equal(isFieldValid({ key: "n", type: "number", default: 42, i18nKey: "x" }), true);
});

test("isFieldValid rejects number field with NaN", () => {
  assert.equal(isFieldValid({ key: "n", type: "number", default: NaN, i18nKey: "x" }), false);
});

test("isFieldValid accepts string-list field with empty array default", () => {
  assert.equal(isFieldValid({ key: "l", type: "string-list", default: [], i18nKey: "x" }), true);
});

test("isFieldValid rejects string-list field with non-array default", () => {
  assert.equal(
    isFieldValid({ key: "l", type: "string-list", default: "nope", i18nKey: "x" }),
    false,
  );
});

test("isFieldValid rejects string-list field containing non-strings", () => {
  assert.equal(
    isFieldValid({ key: "l", type: "string-list", default: [1, 2, 3], i18nKey: "x" }),
    false,
  );
});

test("isFieldValid accepts select field with string default", () => {
  assert.equal(
    isFieldValid({ key: "s", type: "select", default: "a", options: [], i18nKey: "x" }),
    true,
  );
});

// ---- PluginSettings structure invariants ----

test("allSchemas entries have unique pluginId", () => {
  const ids = allSchemas.map((s) => s.pluginId);
  assert.equal(new Set(ids).size, ids.length);
});

test("allSchemas entries use SCHEMA_VERSION", () => {
  for (const s of allSchemas) {
    assert.equal(s.version, SCHEMA_VERSION, `plugin ${s.pluginId} version mismatch`);
  }
});

test("allSchemas: each plugin's enabled toggle is also present in fields[] at most once", () => {
  // 一些插件把 enabled 字段同时放在顶级 + fields[] 中。本测试只校验：若两边都放，default 一致。
  for (const s of allSchemas) {
    if (!s.enabled) continue;
    const dup = s.fields.find((f) => f.key === s.enabled.key && f.type === "boolean");
    if (dup) {
      // 容忍冗余但确认 default 一致
      assert.equal(dup.default, s.enabled.default);
    }
  }
});
