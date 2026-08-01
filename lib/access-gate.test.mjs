// access-gate 单测：node --test --experimental-strip-types
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { sha256Hex, safeEqualHex, extractProvidedToken, verifyAccessToken } from "./access-gate.ts";

function hash(s) {
  return createHash("sha256").update(s).digest("hex");
}

const VALID = "s3cr3t-token";
const VALID_HASH = hash(VALID);

test("verifyAccessToken: 有效纯令牌放行（返回 null）", async () => {
  const r = await verifyAccessToken(VALID, VALID_HASH);
  assert.equal(r, null);
});

test("verifyAccessToken: 错误令牌 → bad-token", async () => {
  const r = await verifyAccessToken("wrong", VALID_HASH);
  assert.equal(r, "bad-token");
});

test("verifyAccessToken: 缺失令牌 → missing-token", async () => {
  const r = await verifyAccessToken(null, VALID_HASH);
  assert.equal(r, "missing-token");
});

test("verifyAccessToken: 未配置哈希 → no-token-configured（D2 强制拒绝）", async () => {
  const r = await verifyAccessToken(VALID, undefined);
  assert.equal(r, "no-token-configured");
});

test("verifyAccessToken: 空字符串哈希视为未配置", async () => {
  const r = await verifyAccessToken(VALID, "");
  assert.equal(r, "no-token-configured");
});

test("extractProvidedToken: 三源优先级 Authorization > cookie > query", () => {
  assert.equal(extractProvidedToken({ authorization: `Bearer ${VALID}` }), VALID);
  assert.equal(extractProvidedToken({ authorization: null, cookieToken: VALID }), VALID);
  assert.equal(
    extractProvidedToken({ authorization: null, cookieToken: null, queryToken: VALID }),
    VALID,
  );
  assert.equal(extractProvidedToken({}), null);
});

test("extractProvidedToken: 去除 Bearer 前缀（大小写不敏感）", () => {
  assert.equal(extractProvidedToken({ authorization: `bEaReR ${VALID}` }), VALID);
});

test("safeEqualHex: 不等长直接 false", () => {
  assert.equal(safeEqualHex("abc", "abcd"), false);
});

test("sha256Hex: 与 node crypto 一致", async () => {
  const v = "hello";
  assert.equal(await sha256Hex(v), hash(v));
});
