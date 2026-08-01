import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildSessionContext } = await jiti.import("./session-reader.ts");

function userEntry(id, parentId, content, timestamp = "2026-01-01T00:00:00.000Z") {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "user",
      content,
    },
  };
}

function assistantEntry(id, parentId, text, timestamp = "2026-01-01T00:00:00.000Z") {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "assistant",
      provider: "test",
      model: "test-model",
      content: [{ type: "text", text }],
    },
  };
}

test("renders full branch history with compaction at its original entry position", () => {
  const entries = [
    userEntry("u1", null, "old user request"),
    assistantEntry("a1", "u1", "old assistant answer"),
    userEntry("u2", "a1", "kept user request"),
    {
      type: "compaction",
      id: "cmp",
      parentId: "u2",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "old exchange summary",
      firstKeptEntryId: "u2",
      tokensBefore: 123,
    },
    userEntry("u3", "cmp", "after compaction"),
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.entryIds, ["u1", "a1", "u2", "cmp", "u3"]);
  assert.deepEqual(
    context.messages.map((message) => [message.role, message.customType, message.content]),
    [
      ["user", undefined, "old user request"],
      ["assistant", undefined, [{ type: "text", text: "old assistant answer" }]],
      ["user", undefined, "kept user request"],
      ["custom", "compaction", "old exchange summary"],
      ["user", undefined, "after compaction"],
    ],
  );
});

test("preserves hidden custom messages so the UI can render them collapsed", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      type: "custom_message",
      id: "c1",
      parentId: "u1",
      timestamp: "2026-01-01T00:00:01.000Z",
      customType: "extension_debug",
      content: "hidden extension payload",
      display: false,
      details: { source: "test" },
    },
    assistantEntry("a1", "c1", "done"),
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.entryIds, ["u1", "c1", "a1"]);
  assert.equal(context.messages[1].role, "custom");
  assert.equal(context.messages[1].customType, "extension_debug");
  assert.equal(context.messages[1].display, false);
  assert.equal(context.messages[1].content, "hidden extension payload");
});

test("preserves valid epoch timestamps on synthetic UI messages", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      type: "compaction",
      id: "cmp",
      parentId: "u1",
      timestamp: "1970-01-01T00:00:00.000Z",
      summary: "epoch summary",
      firstKeptEntryId: "u1",
      tokensBefore: 10,
    },
  ];

  const context = buildSessionContext(entries);

  assert.equal(context.messages[1].role, "custom");
  assert.equal(context.messages[1].customType, "compaction");
  assert.equal(context.messages[1].timestamp, 0);
});

test("P1: listAllSessions paginates by modified desc with limit/offset", async () => {
  const pi = await jiti.import("./pi.ts");
  const { listAllSessions } = await jiti.import("./session-reader.ts");

  // 注入可控 adapter：listAll 返回 5 个会话（cwd 留空，避免 resolveProject 真跑）。
  pi.registerPiAdapter({
    agentDir: "/tmp",
    SessionManager: {
      listAll: async () => [
        {
          id: "s1",
          path: "/tmp/s1.jsonl",
          cwd: "",
          name: "a",
          created: new Date(0),
          modified: new Date("2026-01-01T00:00:01.000Z"),
          messageCount: 1,
          parentSessionPath: null,
        },
        {
          id: "s2",
          path: "/tmp/s2.jsonl",
          cwd: "",
          name: "b",
          created: new Date(0),
          modified: new Date("2026-01-01T00:00:05.000Z"),
          messageCount: 1,
          parentSessionPath: null,
        },
        {
          id: "s3",
          path: "/tmp/s3.jsonl",
          cwd: "",
          name: "c",
          created: new Date(0),
          modified: new Date("2026-01-01T00:00:03.000Z"),
          messageCount: 1,
          parentSessionPath: null,
        },
        {
          id: "s4",
          path: "/tmp/s4.jsonl",
          cwd: "",
          name: "d",
          created: new Date(0),
          modified: new Date("2026-01-01T00:00:02.000Z"),
          messageCount: 1,
          parentSessionPath: null,
        },
        {
          id: "s5",
          path: "/tmp/s5.jsonl",
          cwd: "",
          name: "e",
          created: new Date(0),
          modified: new Date("2026-01-01T00:00:04.000Z"),
          messageCount: 1,
          parentSessionPath: null,
        },
      ],
    },
  });

  const all = await listAllSessions();
  assert.equal(all.length, 5);

  // 默认（无参）返回全量。
  const paged = await listAllSessions({ limit: 2, offset: 0 });
  // 按 modified 降序：s2(05) > s5(04) > s3(03) > s4(02) > s1(01)
  assert.deepEqual(
    paged.map((s) => s.id),
    ["s2", "s5"],
  );

  const page2 = await listAllSessions({ limit: 2, offset: 2 });
  assert.deepEqual(
    page2.map((s) => s.id),
    ["s3", "s4"],
  );

  const last = await listAllSessions({ limit: 2, offset: 4 });
  assert.deepEqual(
    last.map((s) => s.id),
    ["s1"],
  );
});

// ============================================================================
// L3：parentSessionId 解析兼容「cwd 相对键」新格式 + 旧「绝对路径」格式回退
//   - 新格式：header.parentSession 是 `<encodedCwd>/<id>.jsonl`，直接用 idToPath 解析
//   - 旧格式：绝对路径，沿用 pathToId 映射（向后兼容，迁移完成前不破坏）
//   - 解析失败（路径失效/孤儿）时返回 undefined，而非伪造一个查无此人的 ID
// ============================================================================

const { resolveParentId } = await jiti.import("./session-reader.ts");

test("L3: 新相对键父外键能被解析为父会话 ID", () => {
  const info = {
    id: "child-1",
    cwd: "/home/user/proj",
    // 新格式：相对键 <--encodedCwd-->/<id>.jsonl
    parentSessionPath: "--home-user-proj--/parent-1.jsonl",
  };
  // byKey: 相对键 → 父会话 id
  const byKey = new Map([["--home-user-proj--/parent-1.jsonl", "parent-1"]]);
  const byPath = new Map();
  assert.equal(resolveParentId(info, byKey, byPath), "parent-1");
});

test("L3: 旧绝对路径父外键回退 pathToId 映射仍可解析", () => {
  const info = {
    id: "child-2",
    cwd: "/home/user/proj",
    parentSessionPath:
      "/home/user/.pi/agent/sessions/--home-user-proj--/2024-01-01T00-00-00-000Z_parent-2.jsonl",
  };
  const byKey = new Map();
  const byPath = new Map([
    [
      "/home/user/.pi/agent/sessions/--home-user-proj--/2024-01-01T00-00-00-000Z_parent-2.jsonl",
      "parent-2",
    ],
  ]);
  assert.equal(resolveParentId(info, byKey, byPath), "parent-2");
});

test("L3: 旧绝对路径迁移后失效（cwd 不同路径不存在）解析为 undefined，不伪造孤儿 ID", () => {
  const info = {
    id: "child-3",
    cwd: "/home/user/proj",
    // 旧绝对路径指向已迁移走的目录，byPath 中查不到
    parentSessionPath: "/old/nowhere/sessions/parent-3.jsonl",
  };
  const byKey = new Map();
  const byPath = new Map(); // 空：旧路径已失效
  assert.equal(resolveParentId(info, byKey, byPath), undefined);
});

test("L3: orchestrator marker 解析为 undefined（交由 orchestratorParentId 分支）", () => {
  const info = { id: "plan-1", cwd: "/home/user/proj", parentSessionPath: "orchestrator:orch-xyz" };
  const byKey = new Map();
  const byPath = new Map();
  assert.equal(resolveParentId(info, byKey, byPath), undefined);
});

test("L3: 无父外键返回 undefined", () => {
  const info = { id: "root", cwd: "/home/user/proj", parentSessionPath: null };
  assert.equal(resolveParentId(info, new Map(), new Map()), undefined);
});
