// S4 加固单测：node --test --experimental-strip-types
// 覆盖 npm 包名白名单校验。
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPackageNameSafe } from "./skill-pkg-guard.ts";

test("isPackageNameSafe: 标准包名放行", () => {
  assert.equal(isPackageNameSafe("my-skill"), true);
  assert.equal(isPackageNameSafe("@scope/my-skill"), true);
  assert.equal(isPackageNameSafe("my-skill@1.2.3"), true);
  assert.equal(isPackageNameSafe("@scope/my-skill@1.0.0"), true);
});

test("isPackageNameSafe: 选项注入/路径/空格拒绝", () => {
  assert.equal(isPackageNameSafe("--ignore-scripts"), false);
  assert.equal(isPackageNameSafe("pkg --ignore-scripts"), false);
  assert.equal(isPackageNameSafe("../../etc/passwd"), false);
  assert.equal(isPackageNameSafe("a;b"), false);
  assert.equal(isPackageNameSafe(""), false);
  assert.equal(isPackageNameSafe("   "), false);
});
