// S5 加固单测：node --test --experimental-strip-types
// 覆盖 installLocalExtension 的受信根校验（不真实建链，仅验证抛错语义）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installLocalExtension } from "./discovery.ts";

function makeExtDir(dir) {
  mkdirSync(join(dir, "pkg"), { recursive: true });
  writeFileSync(
    join(dir, "pkg", "package.json"),
    JSON.stringify({ name: "x", piWeb: { extensions: [{ id: "x", module: "index.js" }] } }),
  );
  return join(dir, "pkg");
}

test("installLocalExtension: 受信根外目录抛错（S5 越界拒绝）", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-ext-"));
  try {
    const outside = makeExtDir(dir);
    // 把 home 指向一个临时目录，使 outside 不在受信根内
    const fakeHome = mkdtempSync(join(tmpdir(), "fake-home-"));
    const orig = process.env.HOME;
    process.env.HOME = fakeHome; // ~/.pi-web 将落在 fake-home 下，outside 不在其内
    try {
      assert.throws(() => installLocalExtension(outside), /trusted extensions root/);
    } finally {
      if (orig === undefined) delete process.env.HOME;
      else process.env.HOME = orig;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installLocalExtension: 不存在目录抛错", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-ext-"));
  try {
    assert.throws(() => installLocalExtension(join(dir, "nope")), /does not exist/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
