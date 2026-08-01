import assert from "node:assert/strict";
import test from "node:test";

// reparentSessionHeader is a pure function that rewrites only the first line
// (the session header JSON) of a .jsonl file, leaving every subsequent byte
// untouched. This avoids the prior bug where the whole file was split, joined,
// and rewritten — normalizing line endings and re-serializing large files just
// to change one header field.
const { reparentSessionHeader } = await import("./session-reparent.ts");

test("replaces the parentSession field in the header line and preserves the rest verbatim", () => {
  const original =
    '{"type":"session","id":"a","parentSession":"/old/parent.jsonl"}\n' +
    '{"type":"message","id":"m1"}\n' +
    '{"type":"message","id":"m2"}\n';
  const result = reparentSessionHeader(original, "/new/parent.jsonl");
  const [headerLine, ...rest] = result.split("\n");
  assert.equal(JSON.parse(headerLine).parentSession, "/new/parent.jsonl");
  // The remainder must be byte-identical to the input's tail.
  assert.equal(rest.join("\n"), original.split("\n").slice(1).join("\n"));
});

test("sets parentSession to undefined when newParent is undefined (detach from tree)", () => {
  const original = '{"type":"session","id":"a","parentSession":"/old.jsonl"}\n{"type":"message"}\n';
  const result = reparentSessionHeader(original, undefined);
  const header = JSON.parse(result.split("\n")[0]);
  assert.equal(header.parentSession, undefined);
});

test("only rewrites the header of a session line; leaves non-session first line unchanged", () => {
  // A file whose first line isn't a session header should be returned unchanged.
  const original = '{"type":"message","id":"m0"}\n{"type":"message","id":"m1"}\n';
  const result = reparentSessionHeader(original, "/new.jsonl");
  assert.equal(result, original);
});

test("preserves a trailing newline and exact bytes of message lines", () => {
  const messageBlock = '{"type":"message","id":"m1","content":"hi\\nthere"}\n'.repeat(500);
  const original = '{"type":"session","id":"a","parentSession":"/o.jsonl"}\n' + messageBlock;
  const result = reparentSessionHeader(original, "/n.jsonl");
  // Everything after the first newline is untouched.
  assert.equal(result.slice(result.indexOf("\n") + 1), messageBlock);
});

test("returns the input unchanged when the header line is not valid JSON", () => {
  const original = 'not-json-at-all\n{"type":"message"}\n';
  const result = reparentSessionHeader(original, "/new.jsonl");
  assert.equal(result, original);
});

// ============================================================================
// L3：外键从「绝对路径」收敛为「cwd 相对键」 <encodedCwd>/<id>.jsonl
//   - 迁移必须幂等：已是相对键则原样返回
//   - 旧绝对路径则重写为相对键
//   - 无 parent / orchestrator marker 不受影响
//   - 相对键必须能被 idToPath 解析回真实文件（否则树结构会断）
// ============================================================================

const { reparentHeader, toParentKey } = await import("./session-reparent.ts");

// SDK 真实布局：<agentDir>/sessions/<--encodedCwd-->/<timestamp>_<id>.jsonl
// 相对键 = `<--encodedCwd-->/<id>.jsonl`（保留 SDK 目录名，确保与 idToPath 解析一致）

test("L3: 旧绝对路径父键被重写为 cwd 相对键", () => {
  const header = {
    type: "session",
    id: "child-1",
    timestamp: "2024-01-01T00:00:00.000Z",
    cwd: "/home/user/proj",
    parentSession:
      "/home/user/.pi/agent/sessions/--home-user-proj--/2024-01-01T00-00-00-000Z_parent-1.jsonl",
  };
  const out = reparentHeader(header);
  assert.equal(out.parentSession, "--home-user-proj--/parent-1.jsonl");
  // 其它字段完好
  assert.equal(out.id, "child-1");
  assert.equal(out.cwd, "/home/user/proj");
});

test("L3: 已是相对键则原样返回（幂等，不二次改写）", () => {
  const header = {
    type: "session",
    id: "child-2",
    cwd: "/home/user/proj",
    parentSession: "--home-user-proj--/parent-1.jsonl",
  };
  const out = reparentHeader(header);
  assert.equal(out.parentSession, "--home-user-proj--/parent-1.jsonl");
});

test("L3: orchestrator 虚拟根 marker 不受迁移影响", () => {
  const header = {
    type: "session",
    id: "plan-1",
    cwd: "/home/user/proj",
    parentSession: "orchestrator:orch-abc",
  };
  const out = reparentHeader(header);
  assert.equal(out.parentSession, "orchestrator:orch-abc");
});

test("L3: 无 parent 的 header 原样返回", () => {
  const header = { type: "session", id: "root-1", cwd: "/home/user/proj" };
  const out = reparentHeader(header);
  assert.equal(out.parentSession, undefined);
  assert.equal(out.id, "root-1");
});

test("L3: 含空格的 cwd 编码段原样保留（保证 round-trip 一致性）", () => {
  const legacy =
    "/home/user/.pi/agent/sessions/--home-user-my project---/2024-01-01T00-00-00-000Z_parent-x.jsonl";
  const header = {
    type: "session",
    id: "child-x",
    cwd: "/home/user/my project/",
    parentSession: legacy,
  };
  const out = reparentHeader(header);
  // 相对键完整保留 SDK 的编码目录名 + 纯 id，不重新编码（避免双编码漂移）
  assert.equal(out.parentSession, "--home-user-my project---/parent-x.jsonl");
  // id 部分与解析侧契约：<encodedCwd>/<id>.jsonl
  const idPart = out.parentSession.split("/")[1];
  assert.equal(idPart, "parent-x.jsonl");
});

test("L3: toParentKey 用 cwd + id 构造相对键（与 reparentHeader 产出一致）", () => {
  // 注意：toParentKey 仅用于「新写入」场景，需复刻 SDK 编码规则。
  // 这里只断言形状；编码一致性由 SDK 同款 encode 保证。
  const key = toParentKey("/home/user/proj", "parent-1");
  assert.ok(key.endsWith("/parent-1.jsonl"));
  assert.ok(key.startsWith("--"));
});

// ============================================================================
// L3 渐进迁移器 ensureReparented（注入 listPaths，不触真 SDK）
// ============================================================================

const { ensureReparented } = await import("./session-reparent.ts");
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeSessionFile(dir, name, parentValue) {
  const path = join(dir, name);
  const header = { type: "session", id: name.replace(".jsonl", ""), cwd: "/home/user/proj" };
  if (parentValue !== undefined) header.parentSession = parentValue;
  writeFileSync(path, JSON.stringify(header) + "\n" + '{"type":"message"}\n');
  return path;
}

test("L3: ensureReparented 把遗留绝对路径迁移为相对键，且只跑一次（guard）", async () => {
  const dir = mkdtempSync(join(tmpdir(), "l3-"));
  const legacy = makeSessionFile(
    dir,
    "child.jsonl",
    "/home/user/.pi/agent/sessions/--home-user-proj--/2024-01-01T00-00-00-000Z_parent.jsonl",
  );
  const alreadyKey = makeSessionFile(dir, "child2.jsonl", "--home-user-proj--/parent.jsonl");
  const noParent = makeSessionFile(dir, "root.jsonl", undefined);

  // 清 guard 状态
  globalThis.__piReparentedAt = undefined;
  const listPaths = async () => [{ path: legacy }, { path: alreadyKey }, { path: noParent }];

  const r1 = await ensureReparented(listPaths);
  assert.equal(r1.migrated, 1); // 仅 legacy 被迁移
  assert.equal(r1.skipped, 2); // 已是键 + 无 parent 跳过

  // 再跑一次，guard 未过期 → 直接 null（不重复迁移）
  const r2 = await ensureReparented(listPaths);
  assert.equal(r2, null);

  // 校验文件确实被改写
  const migrated = JSON.parse(
    (await import("node:fs")).readFileSync(legacy, "utf8").split("\n")[0],
  );
  assert.equal(migrated.parentSession, "--home-user-proj--/parent.jsonl");
});

test("L3: ensureReparented 单文件损坏不阻断整次扫描", async () => {
  const dir = mkdtempSync(join(tmpdir(), "l3-err-"));
  const broken = join(dir, "broken.jsonl");
  writeFileSync(broken, "not-json-at-all\n");
  const ok = makeSessionFile(
    dir,
    "ok.jsonl",
    "/home/user/.pi/agent/sessions/--home-user-proj--/2024-01-01T00-00-00-000Z_parent.jsonl",
  );
  globalThis.__piReparentedAt = undefined;
  const listPaths = async () => [{ path: broken }, { path: ok }];
  const r = await ensureReparented(listPaths);
  // 非 session 头的损坏文件被安全跳过（不计入 errors），ok 文件仍被迁移
  assert.equal(r.errors, 0);
  assert.equal(r.migrated, 1);
});
