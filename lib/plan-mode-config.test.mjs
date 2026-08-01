// plan-mode-config 单测：node --test --experimental-strip-types
// 每个用例使用独立临时目录，传入显式 agentDir，避免并发修改共享 process.env.PI_CODING_AGENT_DIR 造成竞争。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadPlanModelConfig,
  savePlanModelConfig,
  resolveRoleModelId,
} from "./plan-mode-config.ts";

const makeDir = () => mkdtempSync(join(tmpdir(), "pi-plan-cfg-"));

test("resolveRoleModelId 优先级：角色默认 > 配置映射 > 全局默认", () => {
  assert.equal(resolveRoleModelId("architect", "openai/gpt-4o", {}), "openai/gpt-4o");
  assert.equal(
    resolveRoleModelId("architect", undefined, { architect: "anthropic/claude" }),
    "anthropic/claude",
  );
  // 角色默认优先于配置映射
  assert.equal(
    resolveRoleModelId("architect", "openai/gpt-4o", { architect: "anthropic/claude" }),
    "openai/gpt-4o",
  );
  // 都无 → undefined（回退全局默认）
  assert.equal(resolveRoleModelId("architect", undefined, {}), undefined);
});

test("save/load 往返且原子落盘", () => {
  const dir = makeDir();
  const map = { architect: "openai/gpt-4o", qa: "openai/gpt-4o-mini" };
  savePlanModelConfig(map, dir);
  const file = join(dir, "pi-web-plan-config.json");
  assert.equal(existsSync(file), true);
  // 损坏的值被过滤，仅保留 string 映射
  assert.deepEqual(loadPlanModelConfig(dir), map);
  rmSync(dir, { recursive: true, force: true });
});

test("load 缺失文件返回空对象（best-effort）", () => {
  const emptyDir = makeDir();
  assert.deepEqual(loadPlanModelConfig(emptyDir), {});
  rmSync(emptyDir, { recursive: true, force: true });
});

test("save 忽略空/非字符串值", () => {
  const dir = makeDir();
  const map = { a: "  openai/gpt-4o  ", b: "", c: 123, d: "keep" };
  savePlanModelConfig(map, dir);
  assert.deepEqual(loadPlanModelConfig(dir), {
    a: "openai/gpt-4o",
    d: "keep",
  });
  rmSync(dir, { recursive: true, force: true });
});
