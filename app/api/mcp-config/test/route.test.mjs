// S3 加固单测：node --test --experimental-strip-types
// 覆盖命令白名单与参数危险字符校验（纯逻辑，不实际 spawn）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { isCommandAllowed, isArgsSafe } from "../../../../lib/mcp-probe-guard.ts";

test("isCommandAllowed: 白名单内基名放行", () => {
  assert.equal(isCommandAllowed("node"), true);
  assert.equal(isCommandAllowed("npx"), true);
  assert.equal(isCommandAllowed("python3"), true);
});

test("isCommandAllowed: 绝对/相对路径拒绝", () => {
  assert.equal(isCommandAllowed("/bin/bash"), false);
  assert.equal(isCommandAllowed("./evil"), false);
  assert.equal(isCommandAllowed("..\\evil"), false);
});

test("isCommandAllowed: 空/空白拒绝", () => {
  assert.equal(isCommandAllowed(""), false);
  assert.equal(isCommandAllowed("   "), false);
});

test("isArgsSafe: 含路径分隔符/选项前缀/元字符拒绝", () => {
  assert.equal(isArgsSafe(["--version"]), false);
  assert.equal(isArgsSafe(["foo;rm -rf /"]), false);
  assert.equal(isArgsSafe(["$(id)"]), false);
  assert.equal(isArgsSafe(["a|b"]), false);
  assert.equal(isArgsSafe(["../etc"]), false);
});

test("isArgsSafe: 安全参数放行", () => {
  assert.equal(isArgsSafe(undefined), true);
  assert.equal(isArgsSafe(["-y"]), true);
  assert.equal(isArgsSafe([]), true);
});
