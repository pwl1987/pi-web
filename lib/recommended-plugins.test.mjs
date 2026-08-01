// Verification that the token-saving plugin set (context-mode, pi-rtk,
// pi-caveman) can coexist without conflict, and that the complementary /
// conflicting relationships are explicitly declared.
//
// Scope note: pi-web manages plugin installation/status but cannot launch a
// pi-agent to exercise the two extensions' runtime interaction here. This test
// guards the layer pi-web owns — the management contract — by asserting the
// pair is declared complementary (never conflicting) and that the whole set
// passes validatePluginCompatibility(). A future regression that marks them as
// conflicting, or introduces a duplicate source/name, fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_PLUGINS, validatePluginCompatibility } from "./recommended-plugins.ts";

test("context-mode and pi-rtk are both present in the plugin set", () => {
  const names = new Set(ALL_PLUGINS.map((p) => p.name));
  assert.ok(names.has("context-mode"), "context-mode must be present");
  assert.ok(names.has("pi-rtk"), "pi-rtk must be present");
});

test("pi-caveman is present and declared complementary to context-mode and pi-rtk", () => {
  const names = new Set(ALL_PLUGINS.map((p) => p.name));
  assert.ok(names.has("pi-caveman"), "pi-caveman must be present");

  const caveman = ALL_PLUGINS.find((p) => p.name === "pi-caveman");
  assert.ok(caveman, "pi-caveman must exist");
  assert.ok(
    caveman.complements?.includes("context-mode"),
    "pi-caveman should complement context-mode",
  );
  assert.ok(caveman.complements?.includes("pi-rtk"), "pi-caveman should complement pi-rtk");

  // None of the three token-saving plugins conflict with each other.
  const three = ["pi-caveman", "context-mode", "pi-rtk"];
  for (const name of three) {
    const p = ALL_PLUGINS.find((q) => q.name === name);
    for (const other of three) {
      if (other !== name) {
        assert.ok(!p.conflicts?.includes(other), `${name} must not conflict with ${other}`);
      }
    }
  }
});

test("pi-caveman declares the other Caveman forks as conflicts", () => {
  const caveman = ALL_PLUGINS.find((p) => p.name === "pi-caveman");
  assert.ok(caveman, "pi-caveman must exist");
  for (const fork of ["@viartemev/pi-caveman", "@kulapard/pi-caveman", "@nielpattin/pi-caveman"]) {
    assert.ok(
      caveman.conflicts?.includes(fork),
      `pi-caveman should declare conflict with fork ${fork}`,
    );
  }
});

test("context-mode and pi-rtk are declared complementary, not conflicting", () => {
  const contextMode = ALL_PLUGINS.find((p) => p.name === "context-mode");
  const piRtk = ALL_PLUGINS.find((p) => p.name === "pi-rtk");

  assert.ok(contextMode && piRtk, "both plugins must exist");

  // Each lists the other as a complement (coexist by design).
  assert.ok(
    contextMode.complements?.includes("pi-rtk"),
    "context-mode should declare pi-rtk as a complement",
  );
  assert.ok(
    piRtk.complements?.includes("context-mode"),
    "pi-rtk should declare context-mode as a complement",
  );

  // Neither declares the other as a conflict.
  assert.ok(
    !contextMode.conflicts?.includes("pi-rtk"),
    "context-mode must not declare pi-rtk as a conflict",
  );
  assert.ok(
    !piRtk.conflicts?.includes("context-mode"),
    "pi-rtk must not declare context-mode as a conflict",
  );
});

test("plugin compatibility validation passes with no conflicts", () => {
  const errors = validatePluginCompatibility(ALL_PLUGINS);
  assert.deepEqual(
    errors,
    [],
    `Expected no compatibility conflicts, got: ${JSON.stringify(errors)}`,
  );
});

test("every plugin has a unique source and name", () => {
  const sources = ALL_PLUGINS.map((p) => p.source);
  const names = ALL_PLUGINS.map((p) => p.name);
  assert.equal(new Set(sources).size, sources.length, "plugin sources must be unique");
  assert.equal(new Set(names).size, names.length, "plugin names must be unique");
});

test("every complement reference points to a real plugin name", () => {
  const names = new Set(ALL_PLUGINS.map((p) => p.name));
  for (const p of ALL_PLUGINS) {
    for (const c of p.complements ?? []) {
      assert.ok(
        names.has(c),
        `plugin "${p.name}" complements "${c}", but no plugin with that name exists ` +
          `(complements must reference another plugin's name, e.g. "@hypabolic/pi-hypa")`,
      );
    }
  }
});
