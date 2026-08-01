import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { walkDirectory } from "./file-walk.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pi-walk-"));

test("collects files recursively and respects ignored names/suffixes", () => {
  const root = tmp();
  try {
    fs.mkdirSync(path.join(root, "sub"));
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.writeFileSync(path.join(root, "a.txt"), "x");
    fs.writeFileSync(path.join(root, "b.log"), "x");
    fs.writeFileSync(path.join(root, "node_modules", "c.txt"), "x");
    fs.writeFileSync(path.join(root, "sub", "d.txt"), "x");
    const { files, hardTruncated } = walkDirectory(root, {
      ignoredNames: new Set(["node_modules"]),
      ignoredSuffixes: [".log"],
    });
    assert.equal(hardTruncated, false);
    assert.deepEqual(files.sort(), ["a.txt", "sub/d.txt"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("per-directory entry cap truncates but keeps sibling dirs (BFS fairness)", () => {
  const root = tmp();
  try {
    fs.writeFileSync(path.join(root, "a.txt"), "x");
    const big = path.join(root, "big");
    const small = path.join(root, "small");
    fs.mkdirSync(big);
    fs.mkdirSync(small);
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(big, `f${i}.txt`), "x");
    fs.writeFileSync(path.join(small, "g.txt"), "x");
    const { files, hardTruncated } = walkDirectory(root, {
      maxDirEntries: 3,
      ignoredNames: new Set(),
      ignoredSuffixes: [],
    });
    assert.equal(hardTruncated, true);
    // 巨型目录被截断后，同级 small 仍被正常处理。
    assert.ok(files.includes("small/g.txt"));
    assert.ok(files.includes("a.txt"));
    assert.equal(files.length, 5); // a.txt + 3 from big (capped) + small/g.txt
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("global hard cap stops the walk", () => {
  const root = tmp();
  try {
    for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(root, `f${i}.txt`), "x");
    const { files, hardTruncated } = walkDirectory(root, {
      walkHardCap: 4,
      ignoredNames: new Set(),
      ignoredSuffixes: [],
    });
    assert.equal(hardTruncated, true);
    assert.equal(files.length, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
