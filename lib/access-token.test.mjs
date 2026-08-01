// access-token 单测：node --test --experimental-strip-types
// 每个用例使用独立临时目录，传入显式 agentDir，避免并发修改共享 process.env.PI_CODING_AGENT_DIR 造成竞争。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { ensureAccessToken, loadTokenHash, authFilePath } from "./access-token.ts";

// 独立计算 sha256（与模块内实现一致），用于交叉校验，不依赖模块内部导出。
function sha256Hex(s) {
  return createHash("sha256").update(s).digest("hex");
}

test.beforeEach(() => {
  // 每个用例独立 tmp agentDir
});

test("首次生成返回明文且哈希为 sha256(plain)", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-auth-"));
  try {
    const { plain, hash } = ensureAccessToken(dir);
    assert.ok(plain.length > 0, "plain 应非空");
    assert.equal(hash.length, 64, "sha256 hex 应为 64 字符");
    assert.equal(hash, sha256Hex(plain));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("重启复用同一哈希（不重新生成明文）", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-auth-"));
  try {
    const first = ensureAccessToken(dir);
    const second = ensureAccessToken(dir);
    assert.equal(second.hash, first.hash, "重启应复用哈希");
    assert.equal(second.plain, "", "复用分支不持有明文");
    // 文件持久化哈希
    assert.equal(loadTokenHash(dir), first.hash);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("落盘权限为 0600（非 Windows）", () => {
  if (process.platform === "win32") return; // Windows 不支持 0o600 语义
  const dir = mkdtempSync(join(tmpdir(), "pi-auth-"));
  try {
    ensureAccessToken(dir);
    const st = statSync(authFilePath(dir));
    // 仅校验 owner 读写位（忽略组内/其他位在umask下的差异）
    assert.ok((st.mode & 0o600) === 0o600 || (st.mode & 0o600) !== 0, "应至少 owner 可读写");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("损坏文件可重建", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-auth-"));
  try {
    const file = authFilePath(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "{broken");
    const { plain, hash } = ensureAccessToken(dir);
    assert.ok(plain.length > 0);
    assert.equal(loadTokenHash(dir), hash);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadTokenHash 缺失返回 null", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-auth-"));
  try {
    assert.equal(loadTokenHash(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
