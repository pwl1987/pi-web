import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidGitRefName } from "./git-ref.ts";

test("accepts normal branch names", () => {
  assert.equal(isValidGitRefName("main"), true);
  assert.equal(isValidGitRefName("feature/login"), true);
  assert.equal(isValidGitRefName("release-1.2"), true);
  assert.equal(isValidGitRefName("a_b/c.d"), true);
});

test("rejects empty and overly long names", () => {
  assert.equal(isValidGitRefName(""), false);
  assert.equal(isValidGitRefName("x".repeat(251)), false);
});

test("rejects traversal and unsafe characters", () => {
  assert.equal(isValidGitRefName(".."), false);
  assert.equal(isValidGitRefName("feature/../main"), false);
  assert.equal(isValidGitRefName("a b"), false);
  assert.equal(isValidGitRefName("a\tb"), false);
  assert.equal(isValidGitRefName("-bad"), false);
  assert.equal(isValidGitRefName("bad/"), false);
  assert.equal(isValidGitRefName("bad.lock"), false);
  assert.equal(isValidGitRefName(42), false);
});
