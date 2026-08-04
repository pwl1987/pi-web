import assert from "node:assert/strict";
import test from "node:test";

const { parseAgentsMd, serializeModules, composeAgentsMd, inferCategory } =
  await import("./agents-md-modules.ts");

const SAMPLE = [
  "# 项目概述",
  "这是一个示例项目。",
  "",
  "## 安全约束",
  "不要泄露密钥。禁止执行危险命令。",
  "",
  "## 输出格式",
  "使用中文回答。优先给出代码片段。",
  "",
  "## 本地化",
  "所有用户可见文案必须为中文。",
].join("\n");

test("parseAgentsMd splits by headings into modules with ids", () => {
  const mods = parseAgentsMd(SAMPLE);
  assert.ok(mods.length >= 4, "preamble + 3 headings");
  const ids = mods.map((m) => m.id);
  assert.ok(
    ids.every((id) => id.startsWith("agents-md.")),
    "ids prefixed",
  );
  assert.ok(new Set(ids).size === ids.length, "ids unique");
});

test("inferCategory maps headings to categories", () => {
  assert.equal(inferCategory("安全约束", "x"), "safety");
  assert.equal(inferCategory("输出格式", "x"), "output-format");
  assert.equal(inferCategory("本地化", "x"), "localization");
});

test("composeAgentsMd returns full content when no query (passthrough)", () => {
  const out = composeAgentsMd(SAMPLE);
  assert.ok(out.includes("不要泄露密钥"), "safety kept");
  assert.ok(out.includes("使用中文回答"), "format kept");
  assert.ok(out.includes("所有用户可见文案必须为中文"), "localization kept");
});

test("composeAgentsMd filters by userInput (dynamic submission)", () => {
  const out = composeAgentsMd(SAMPLE, { userInput: "请规定输出格式与代码风格" });
  assert.ok(out.includes("使用中文回答"), "format matched");
  assert.ok(!out.includes("不要泄露密钥"), "safety skipped (no safety keyword in query)");
});

test("composeAgentsMd honors enabledOverride (switch off)", () => {
  const mods = parseAgentsMd(SAMPLE);
  const safety = mods.find((m) => m.category === "safety");
  const out = composeAgentsMd(SAMPLE, { enabledOverride: { [safety.id]: false } });
  assert.ok(!out.includes("不要泄露密钥"), "disabled module omitted");
});

test("serializeModules round-trips headings", () => {
  const mods = parseAgentsMd(SAMPLE);
  const back = serializeModules(mods);
  assert.ok(back.includes("# 安全约束"), "heading restored");
  assert.ok(back.includes("不要泄露密钥"), "body restored");
});
