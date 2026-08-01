import assert from "node:assert";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const jiti = (await import("jiti")).default;
const jitiImport = jiti();

const fileCachePath = fileURLToPath(new URL("./file-cache.ts", import.meta.url));
const { getCachedFileList, setCachedFileList, getCachedFileMeta, setCachedFileMeta } =
  await jitiImport.import(fileCachePath);

// 重置 globalThis 缓存，避免测试间串扰。
function resetCaches() {
  globalThis.__piFileListCache = new Map();
  globalThis.__piFileMetaCache = new Map();
}

test("P4: list cache misses then hits within TTL and same dir mtime", () => {
  resetCaches();
  const dir = "/tmp/dir";
  assert.equal(getCachedFileList(dir, 100), null);

  setCachedFileList(dir, 100, [{ name: "a" }]);
  assert.deepEqual(getCachedFileList(dir, 100), [{ name: "a" }]);
});

test("P4: list cache invalidates when dir mtime changes", () => {
  resetCaches();
  const dir = "/tmp/dir2";
  setCachedFileList(dir, 100, [{ name: "a" }]);
  // 目录内容变化（mtime 不同）→ 缓存失效，返回 null。
  assert.equal(getCachedFileList(dir, 101), null);
});

test("P4: list cache invalidates after TTL elapses", async () => {
  resetCaches();
  const dir = "/tmp/dir3";
  setCachedFileList(dir, 50, [{ name: "a" }]);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 10_000; // 远超 1500ms TTL
    assert.equal(getCachedFileList(dir, 50), null);
  } finally {
    Date.now = realNow;
  }
});

test("P4: meta cache hits only when file mtime matches and within TTL", () => {
  resetCaches();
  const file = "/tmp/file.txt";
  const payload = { size: 10, language: "ts" };
  assert.equal(getCachedFileMeta(file, 200), null);

  setCachedFileMeta(file, 200, payload);
  assert.deepEqual(getCachedFileMeta(file, 200), payload);

  // mtime 变化 → 失效。
  assert.equal(getCachedFileMeta(file, 201), null);
});
