// agent-orchestrator 持久化单测：node --test --experimental-strip-types
// 验证快照 upsert / 读取 / 排序 / 清空；使用独立临时目录隔离。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-persist-"));
process.once("exit", () => {
  try {
    rmSync(process.env.PI_CODING_AGENT_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const { saveOrchestratorSnapshot, loadAllOrchestratorSnapshots, clearOrchestratorSnapshots } =
  await import("./persistence.ts");

test("save 后 load 可还原（含快照内容）", () => {
  const snap = {
    id: "orch_a",
    updatedAt: 100,
    status: "awaiting_confirm",
    messages: [{ id: "m1" }],
  };
  saveOrchestratorSnapshot(snap);
  const all = loadAllOrchestratorSnapshots();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "orch_a");
  assert.deepEqual(all[0].snapshot, snap);
});

test("upsert 按 id 原地更新，不新增记录", () => {
  const v1 = { id: "orch_b", updatedAt: 200, status: "discussing" };
  const v2 = { id: "orch_b", updatedAt: 300, status: "awaiting_confirm" };
  saveOrchestratorSnapshot(v1);
  saveOrchestratorSnapshot(v2);
  const all = loadAllOrchestratorSnapshots();
  const b = all.find((r) => r.id === "orch_b");
  assert.equal(all.filter((r) => r.id === "orch_b").length, 1);
  assert.equal(b.snapshot.status, "awaiting_confirm");
  assert.equal(b.updatedAt, 300);
});

test("按 updatedAt 升序返回", () => {
  clearOrchestratorSnapshots();
  saveOrchestratorSnapshot({ id: "x", updatedAt: 500 });
  saveOrchestratorSnapshot({ id: "y", updatedAt: 400 });
  saveOrchestratorSnapshot({ id: "z", updatedAt: 600 });
  const order = loadAllOrchestratorSnapshots().map((r) => r.id);
  assert.deepEqual(order, ["y", "x", "z"]);
});

test("clear 后返回空", () => {
  saveOrchestratorSnapshot({ id: "w", updatedAt: 700 });
  assert.ok(loadAllOrchestratorSnapshots().length >= 1);
  clearOrchestratorSnapshots();
  assert.deepEqual(loadAllOrchestratorSnapshots(), []);
});
