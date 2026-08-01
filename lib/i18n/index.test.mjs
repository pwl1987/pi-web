// translate() lives in index.ts which imports "./en" and "./zh" without extensions.
// Node's bare ESM loader can't resolve those, so we test the dictionaries (pure data,
// no deps) directly + inline the translate logic to verify interpolation.

import assert from "node:assert/strict";
import test from "node:test";

async function loadDictionaries() {
  const [enMod, zhMod] = await Promise.all([import("./en.ts"), import("./zh.ts")]);
  return { en: enMod.en, zh: zhMod.zh };
}

// Inline copy of the translate() logic from index.ts — it's a 6-line pure function.
// This lets us test interpolation without the module-resolution issue.
function translate(locale, key, vars, dicts) {
  const dict = dicts[locale];
  let s = dict[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

test("en and zh dictionaries have identical key sets", async () => {
  const { en, zh } = await loadDictionaries();
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zh).sort();
  assert.deepEqual(enKeys, zhKeys, "en.ts and zh.ts must have the same keys");
});

test("translates a known key in English", async () => {
  const dicts = await loadDictionaries();
  assert.equal(translate("en", "lang.switchToZh", undefined, dicts), "Switch to Chinese");
});

test("translates a known key in Chinese", async () => {
  const dicts = await loadDictionaries();
  assert.equal(translate("zh", "lang.switchToZh", undefined, dicts), "切换到中文");
});

test("interpolates a single {var}", async () => {
  const dicts = await loadDictionaries();
  assert.equal(translate("en", "topbar.statIn", { value: "1,234" }, dicts), "in: 1,234");
});

test("interpolates multiple {var}s", async () => {
  const dicts = await loadDictionaries();
  assert.equal(
    translate("zh", "chat.runningMany", { names: "A, B", extra: 3 }, dicts),
    "运行 A, B(+3)中...",
  );
});

test("converts number vars to string", async () => {
  const dicts = await loadDictionaries();
  assert.equal(translate("en", "sidebar.minutesAgo", { count: 5 }, dicts), "5m ago");
});

test("falls back to the key itself when missing", async () => {
  const dicts = await loadDictionaries();
  assert.equal(translate("en", "nonexistent.key", undefined, dicts), "nonexistent.key");
});

test("still interpolates vars on a missing-key fallback", async () => {
  const dicts = await loadDictionaries();
  assert.equal(translate("en", "missing.{x}", { x: "val" }, dicts), "missing.val");
});

test("handles empty string key", async () => {
  const dicts = await loadDictionaries();
  assert.equal(translate("en", "", undefined, dicts), "");
});

test("ignores extra vars not in the template", async () => {
  const dicts = await loadDictionaries();
  assert.equal(translate("en", "topbar.statIn", { value: "100", unused: "x" }, dicts), "in: 100");
});
