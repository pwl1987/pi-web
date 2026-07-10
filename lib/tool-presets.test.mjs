import assert from "node:assert/strict";
import test from "node:test";

import {
  toolsToToolNames,
  defaultToolEntries,
  getToolNamesForPreset,
  getPresetFromTools,
  BUILTIN_TOOL_NAMES,
  PRESET_DEFAULT,
  PRESET_FULL,
} from "./tool-presets.ts";

// --- toolsToToolNames ---

test("toolsToToolNames returns only active tool names", () => {
  const tools = [
    { name: "read", description: "", active: true },
    { name: "bash", description: "", active: false },
    { name: "edit", description: "", active: true },
  ];
  assert.deepEqual(toolsToToolNames(tools).sort(), ["edit", "read"]);
});

test("toolsToToolNames returns empty when nothing active", () => {
  const tools = [
    { name: "read", description: "", active: false },
    { name: "bash", description: "", active: false },
  ];
  assert.deepEqual(toolsToToolNames(tools), []);
});

test("toolsToToolNames includes extension tools when active", () => {
  const tools = [
    { name: "read", description: "", active: true },
    { name: "web_search", description: "search the web", active: true },
    { name: "subagents", description: "", active: false },
  ];
  assert.deepEqual(toolsToToolNames(tools).sort(), ["read", "web_search"]);
});

// --- defaultToolEntries ---

test("defaultToolEntries seeds from DEFAULT preset (read/bash/edit/write active)", () => {
  const entries = defaultToolEntries();
  const active = new Set(toolsToToolNames(entries));
  assert.deepEqual([...active].sort(), [...PRESET_DEFAULT].sort());
});

test("defaultToolEntries covers all built-in tool names", () => {
  const entries = defaultToolEntries();
  const names = new Set(entries.map((e) => e.name));
  for (const name of PRESET_FULL) {
    assert.ok(names.has(name), `should include ${name}`);
  }
});

// --- getToolNamesForPreset / getPresetFromTools round-trip ---

test("getToolNamesForPreset returns the right arrays", () => {
  assert.deepEqual(getToolNamesForPreset("none"), []);
  assert.deepEqual([...getToolNamesForPreset("default")].sort(), [...PRESET_DEFAULT].sort());
  assert.deepEqual([...getToolNamesForPreset("full")].sort(), [...PRESET_FULL].sort());
});

test("getPresetFromTools detects none", () => {
  assert.equal(getPresetFromTools([]), "none");
  assert.equal(getPresetFromTools([{ name: "read", description: "", active: false }]), "none");
});

test("getPresetFromTools ignores extension tools when matching", () => {
  const tools = [
    ...PRESET_DEFAULT.map((n) => ({ name: n, description: "", active: true })),
    { name: "web_search", description: "", active: true },
  ];
  // Even with an extension tool active, the built-in signature matches "default".
  assert.equal(getPresetFromTools(tools), "default");
});

// --- BUILTIN_TOOL_NAMES ---

test("BUILTIN_TOOL_NAMES matches PRESET_FULL", () => {
  for (const name of PRESET_FULL) {
    assert.ok(BUILTIN_TOOL_NAMES.has(name), `BUILTIN_TOOL_NAMES should include ${name}`);
  }
  assert.ok(!BUILTIN_TOOL_NAMES.has("web_search"), "extension tool should not be built-in");
});
