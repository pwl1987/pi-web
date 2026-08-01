import { test } from "node:test";
import assert from "node:assert/strict";
import { filterDroppableFiles } from "./drag-drop-filter.ts";

const mk = (name, size) => new File([new Uint8Array(size)], name, { type: "image/png" });

test("no limit returns all accepted", () => {
  const f = mk("a.png", 10);
  const r = filterDroppableFiles([f]);
  assert.deepEqual(r.accepted, [f]);
  assert.deepEqual(r.rejected, []);
});

test("splits accepted/rejected by size", () => {
  const small = mk("a.png", 1);
  const big = mk("b.png", 100);
  const r = filterDroppableFiles([small, big], { maxSizeBytes: 10 });
  assert.deepEqual(r.accepted, [small]);
  assert.deepEqual(r.rejected, [big]);
});

test("zero / negative limit disables filtering", () => {
  const big = mk("b.png", 100);
  assert.deepEqual(filterDroppableFiles([big], { maxSizeBytes: 0 }).accepted, [big]);
  assert.deepEqual(filterDroppableFiles([big], { maxSizeBytes: -1 }).accepted, [big]);
});
