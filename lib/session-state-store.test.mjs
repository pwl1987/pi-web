import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidPinnedDir, isValidEntry, addPinnedDir } from "./session-state-store.ts";

test("isValidPinnedDir accepts absolute, rejects relative/traversal", () => {
  assert.equal(isValidPinnedDir({ path: "/abs/dir", pinnedAt: 1 }), true);
  assert.equal(isValidPinnedDir({ path: "/abs/dir", pinnedAt: 1, alias: "x" }), true);
  assert.equal(isValidPinnedDir({ path: "../escape", pinnedAt: 1 }), false);
  assert.equal(isValidPinnedDir({ path: "/a/../b", pinnedAt: 1 }), false);
  assert.equal(isValidPinnedDir({ path: "relative", pinnedAt: 1 }), false);
  assert.equal(isValidPinnedDir({ path: "/a b", pinnedAt: 1 }), true); // 空格路径合法，应接受
  assert.equal(isValidPinnedDir({ path: "/a", pinnedAt: "x" }), false);
  assert.equal(isValidPinnedDir({}), false);
  assert.equal(isValidPinnedDir({ path: "/a" }), false); // missing pinnedAt
});

test("isValidEntry rejects path-traversal sessionId", () => {
  assert.equal(isValidEntry({ sessionId: "abc.jsonl", lastActive: 1, toolsDisabled: false }), true);
  assert.equal(isValidEntry({ sessionId: "../evil", lastActive: 1, toolsDisabled: false }), false);
  assert.equal(isValidEntry({ sessionId: "a/b", lastActive: 1, toolsDisabled: false }), false);
  assert.equal(isValidEntry({ sessionId: "", lastActive: 1, toolsDisabled: false }), false);
  assert.equal(isValidEntry({ sessionId: "x" }), false);
});

test("addPinnedDir no-ops on invalid path (no persistence, no throw)", () => {
  const r = addPinnedDir("../bad");
  assert.equal(r.path, "../bad");
  assert.equal(r.alias, undefined);
});
