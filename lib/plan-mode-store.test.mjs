// plan-mode-store 单测：node --test --experimental-strip-types
// 覆盖 planSessionLinks 的 linkPlanSession / unlinkPlanSession / getPlanLink 三个新 API。
// 仅 mock localStorage，不依赖 React；模块顶层只 import React 钩子，不调用，故安全。

import assert from "node:assert/strict";
import test from "node:test";

class MockStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const storage = new MockStorage();
globalThis.window = { localStorage: storage };

// 每次测试前清空全局 store 和 storage，避免 __piPlanModeStore 缓存导致测试相互污染。
async function loadFresh() {
  delete globalThis.__piPlanModeStore;
  storage.clear();
  return import("./plan-mode-store.ts");
}

test("linkPlanSession 写入并可通过 getPlanLink 读出", async () => {
  const { linkPlanSession, getPlanLink } = await loadFresh();
  linkPlanSession("pi-1", { orchestratorId: "orch-a", cwd: "/tmp/proj" });
  const entry = getPlanLink("pi-1");
  assert.deepEqual(entry, { orchestratorId: "orch-a", cwd: "/tmp/proj" });
});

test("getPlanSessionLinks 多个 sessionId 独立存储", async () => {
  const { linkPlanSession, getPlanLink } = await loadFresh();
  linkPlanSession("pi-1", { orchestratorId: "orch-a", cwd: "/tmp/a" });
  linkPlanSession("pi-2", { orchestratorId: "orch-b", cwd: "/tmp/b" });
  assert.equal(getPlanLink("pi-1").orchestratorId, "orch-a");
  assert.equal(getPlanLink("pi-2").orchestratorId, "orch-b");
  assert.equal(getPlanLink("pi-3"), undefined);
});

test("unlinkPlanSession 删除指定链接且不影响其他", async () => {
  const { linkPlanSession, unlinkPlanSession, getPlanLink } = await loadFresh();
  linkPlanSession("pi-1", { orchestratorId: "orch-a", cwd: "/tmp/a" });
  linkPlanSession("pi-2", { orchestratorId: "orch-b", cwd: "/tmp/b" });
  unlinkPlanSession("pi-1");
  assert.equal(getPlanLink("pi-1"), undefined);
  assert.equal(getPlanLink("pi-2").orchestratorId, "orch-b");
});

test("unlinkPlanSession 不存在的 key 不抛错", async () => {
  const { unlinkPlanSession } = await loadFresh();
  // 不应抛
  unlinkPlanSession("never-existed");
  unlinkPlanSession("");
});

test("linkPlanSession 空入参静默忽略", async () => {
  const { linkPlanSession, getPlanLink } = await loadFresh();
  linkPlanSession("", { orchestratorId: "x", cwd: "/y" });
  linkPlanSession("pi-1", { orchestratorId: "", cwd: "/y" });
  assert.equal(getPlanLink(""), undefined);
  assert.equal(getPlanLink("pi-1"), undefined);
});

test("持久化：link 后 localStorage 立即可见，hydrate 后内存重建", async () => {
  const { linkPlanSession } = await import("./plan-mode-store.ts");
  // 用新 store 实例（避免上面 fixture 的 cache 干扰）
  delete globalThis.__piPlanModeStore;
  storage.clear();
  linkPlanSession("pi-persist", { orchestratorId: "orch-p", cwd: "/tmp/p" });
  // localStorage 应已写入
  const raw = storage.getItem("pi-plan-mode");
  assert.ok(raw, "persisted entry must exist");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      "persisted JSON.parse failed: " +
        (e instanceof Error ? e.message : String(e)) +
        " raw=" +
        raw,
    );
  }
  assert.deepEqual(parsed.planSessionLinks, {
    "pi-persist": { orchestratorId: "orch-p", cwd: "/tmp/p" },
  });

  // 模拟刷新：清掉 in-memory store，重新 import 让 hydrate() 重建
  delete globalThis.__piPlanModeStore;
  // 注意：第二次 import 会拿到缓存的模块实例，因此调用的是同一个 class。
  // 但 __piPlanModeStore 已删，下次 getPlanModeStore() 会 new 一个新实例，
  // hydrate() 由 usePlanMode 的 useEffect 触发——此处我们手动模拟。
  const storeModule = await import("./plan-mode-store.ts");
  const store = storeModule.getPlanModeStore();
  // 手动调 hydrate（测试环境无 React useEffect）
  store.hydrate();
  assert.deepEqual(store.getState().planSessionLinks, {
    "pi-persist": { orchestratorId: "orch-p", cwd: "/tmp/p" },
  });
});

test("hydrate 时旧版本无 planSessionLinks 字段也能正常 hydrate（兜底空对象）", async () => {
  // 模拟旧版本 localStorage 数据：没有 planSessionLinks
  delete globalThis.__piPlanModeStore;
  storage.clear();
  storage.setItem(
    "pi-plan-mode",
    JSON.stringify({ planMode: false, orchestratorId: null, planStatus: "idle" }),
  );
  const storeModule = await import("./plan-mode-store.ts");
  const store = storeModule.getPlanModeStore();
  store.hydrate();
  assert.deepEqual(store.getState().planSessionLinks, {});
});
