import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./plugin-ui-i18n.ts");
}

test("localizes rpiv-todo overlay widget chrome without touching task labels", async () => {
  const { localizeExtensionUiRequest } = await loadSubject();
  const req = {
    type: "extension_ui_request",
    id: "w1",
    method: "setWidget",
    widgetKey: "rpiv-todos",
    widgetLines: [
      "● 任务清单 (2/5)",
      "├─ ○ completed feature",
      "├─ ● working on docs",
      "+3 more (2 completed, 1 pending)",
    ],
    widgetPlacement: "aboveEditor",
  };
  const out = localizeExtensionUiRequest(req);
  assert.equal(out.method, "setWidget");
  assert.equal(out.widgetKey, "rpiv-todos");
  // Heading localized.
  assert.match(out.widgetLines[0], /任务清单 \(2\/5\)/);
  // User-authored task label containing "completed" is untouched.
  assert.equal(out.widgetLines[1], "├─ ○ completed feature");
  // Summary chrome localized.
  assert.match(out.widgetLines[3], /更多/);
  assert.match(out.widgetLines[3], /已完成/);
  assert.match(out.widgetLines[3], /待处理/);
  assert.doesNotMatch(out.widgetLines[3], /completed/);
});

test("localizes rpiv-ask-user-question custom UI chrome", async () => {
  const { localizeExtensionUiRequest } = await loadSubject();
  const req = {
    type: "extension_ui_request",
    id: "c1",
    method: "custom",
    lines: ["❯ 问题 1", "  › Type something.", "  › Chat about this", "Option A (Recommended)"],
  };
  const out = localizeExtensionUiRequest(req);
  assert.equal(out.method, "custom");
  assert.match(out.lines[1], /输入内容/);
  assert.match(out.lines[2], /聊聊这个/);
  assert.match(out.lines[3], /（推荐）/);
  assert.doesNotMatch(out.lines[1], /Type something\./);
});

test("does not localize unrelated widgets", async () => {
  const { localizeExtensionUiRequest } = await loadSubject();
  const widget = {
    type: "extension_ui_request",
    id: "w2",
    method: "setWidget",
    widgetKey: "some-other-widget",
    widgetLines: ["Todos (0/0)", "+1 more (1 pending)"],
  };
  const out = localizeExtensionUiRequest(widget);
  // Other widgets are left untouched (scoped to rpiv-todos).
  assert.equal(out.widgetLines[0], "Todos (0/0)");
});

test("already-Chinese text is a no-op", async () => {
  const { localizeExtensionUiRequest } = await loadSubject();
  const req = {
    type: "extension_ui_request",
    id: "c2",
    method: "custom",
    lines: ["任务清单", "输入内容", "聊聊这个"],
  };
  const out = localizeExtensionUiRequest(req);
  assert.deepEqual(out.lines, req.lines);
});

test("localizes pi-landstrip sandbox panel chrome", async () => {
  const { localizeExtensionUiRequest } = await loadSubject();
  const req = {
    type: "extension_ui_request",
    id: "s1",
    method: "custom",
    lines: [
      'Read blocked: "/home/user/.pi/agent/npm/node_modules/superpower..."',
      "[s] Allow for this session only",
      "esc  Abort (keep blocked)",
      "",
      "                                Permanent",
      "",
      " P  Allow for this project  -> .pi/sandbox.json",
      " A  Allow for all projects  -> ~/.pi/agent/sandbox.json",
      "",
      "navigate  enter select  esc dismiss",
    ],
  };
  const out = localizeExtensionUiRequest(req);
  assert.equal(out.method, "custom");
  assert.match(out.lines[0], /读取被阻止：/);
  assert.match(out.lines[1], /仅允许本次会话/);
  assert.match(out.lines[2], /中止（保持阻止）/);
  assert.match(out.lines[4], /永久/);
  assert.match(out.lines[6], /允许此项目/);
  assert.match(out.lines[7], /允许所有项目/);
  assert.match(out.lines[9], /导航/);
  assert.match(out.lines[9], /回车/);
  assert.match(out.lines[9], /选择/);
  assert.match(out.lines[9], /关闭/);
});

test("localizes pi-permission-system confirm dialog", async () => {
  const { localizeExtensionUiRequest } = await loadSubject();
  const req = {
    type: "extension_ui_request",
    id: "p1",
    method: "confirm",
    title: "Permission Required",
    message:
      "Permission Required Current agent requested access to skill 'systematic-debugging' via '/home/user/.pi/agent/npm/node_modules/superpowers-zh/skills/systematic-debugging/SKILL.md'. Allow this read?",
  };
  const out = localizeExtensionUiRequest(req);
  assert.equal(out.method, "confirm");
  assert.match(out.title, /需要权限/);
  assert.match(out.message, /需要权限/);
  assert.match(out.message, /允许此读取操作？/);
  assert.doesNotMatch(out.title, /Permission Required/);
});

test("does not localize non-permission confirm dialogs", async () => {
  const { localizeExtensionUiRequest } = await loadSubject();
  const req = {
    type: "extension_ui_request",
    id: "c3",
    method: "confirm",
    title: "Delete File",
    message: "Are you sure you want to delete this file?",
  };
  const out = localizeExtensionUiRequest(req);
  assert.equal(out.title, "Delete File");
  assert.equal(out.message, "Are you sure you want to delete this file?");
});

test("sandbox localization is idempotent on already-Chinese text", async () => {
  const { localizeExtensionUiRequest } = await loadSubject();
  const req = {
    type: "extension_ui_request",
    id: "s2",
    method: "custom",
    lines: ["读取被阻止：", "[s] 仅允许本次会话", "中止（保持阻止）", "永久"],
  };
  const out = localizeExtensionUiRequest(req);
  assert.deepEqual(out.lines, req.lines);
});

test("localizes select dialog chrome", async () => {
  const { localizeExtensionUiRequest } = await loadSubject();
  const req = {
    type: "extension_ui_request",
    id: "sel1",
    method: "select",
    title: "Select Configuration Mode",
    options: ["Default", "Enabled", "Disabled", "Custom"],
  };
  const out = localizeExtensionUiRequest(req);
  assert.equal(out.method, "select");
  assert.match(out.title, /选择.*配置.*模式/);
  assert.deepEqual(out.options, ["默认", "已启用", "已禁用", "Custom"]);
});

test("localizes input dialog chrome", async () => {
  const { localizeExtensionUiRequest } = await loadSubject();
  const req = {
    type: "extension_ui_request",
    id: "inp1",
    method: "input",
    title: "Enter API Key",
    placeholder: "Enter your API key (Required)",
  };
  const out = localizeExtensionUiRequest(req);
  assert.equal(out.method, "input");
  assert.match(out.title, /输入.*API.*键/);
  assert.match(out.placeholder, /输入.*your.*API.*key.*\(必填\)/);
});

test("localizes editor dialog chrome", async () => {
  const { localizeExtensionUiRequest } = await loadSubject();
  const req = {
    type: "extension_ui_request",
    id: "ed1",
    method: "editor",
    title: "Edit Configuration",
    prefill: '{\n  "enabled": true\n}',
  };
  const out = localizeExtensionUiRequest(req);
  assert.equal(out.method, "editor");
  assert.match(out.title, /编辑.*配置/);
});

test("localizes custom panel render error", async () => {
  const { localizeExtensionUiRequest } = await loadSubject();
  const req = {
    type: "extension_ui_request",
    id: "err1",
    method: "custom",
    lines: [
      "Extension custom UI render failed: Cannot read properties of undefined (reading 'columns')",
    ],
  };
  const out = localizeExtensionUiRequest(req);
  assert.equal(out.method, "custom");
  assert.match(out.lines[0], /扩展自定义 UI 渲染失败/);
  assert.match(out.lines[0], /无法读取未定义的属性/);
  assert.doesNotMatch(out.lines[0], /Extension custom UI render failed/);
});

test("localizes non-permission confirm dialog with common words", async () => {
  const { localizeExtensionUiRequest } = await loadSubject();
  const req = {
    type: "extension_ui_request",
    id: "c4",
    method: "confirm",
    title: "Save Changes",
    message: "Are you sure you want to save these changes?",
  };
  const out = localizeExtensionUiRequest(req);
  assert.equal(out.method, "confirm");
  assert.match(out.title, /保存.*更改/);
});

test("select 值反向映射：汉化后 resolveSelectValue 还原英文原值（permission-system 场景）", async () => {
  const { localizeExtensionUiRequest, resolveSelectValue, _clearSelectValueMapsForTest } =
    await loadSubject();
  _clearSelectValueMapsForTest();
  // 模拟 @gotgenes/pi-permission-system 的 select 请求（4 个固定英文选项）
  const req = {
    type: "extension_ui_request",
    id: "perm-sel-1",
    method: "select",
    title: "Permission Required\nAllow this read?",
    options: ["Yes", "Yes, for this session", "No", "No, provide reason"],
  };
  const out = localizeExtensionUiRequest(req);
  // 显示文本已汉化
  assert.deepEqual(out.options, ["是", "是，仅本次会话", "否", "否，请提供原因"]);
  // 用户点击"是"（汉化显示值）→ resolveSelectValue 还原成英文 "Yes"
  assert.equal(resolveSelectValue("perm-sel-1", "是"), "Yes");
  // 消费即清：再次查询返回原值（无映射）
  assert.equal(resolveSelectValue("perm-sel-1", "是"), "是");
});

test("select 值反向映射：未汉化的选项原样回传", async () => {
  const { localizeExtensionUiRequest, resolveSelectValue, _clearSelectValueMapsForTest } =
    await loadSubject();
  _clearSelectValueMapsForTest();
  const req = {
    type: "extension_ui_request",
    id: "perm-sel-2",
    method: "select",
    title: "Pick option",
    options: ["Custom", "Option A"], // 无通用词，不汉化
  };
  const out = localizeExtensionUiRequest(req);
  assert.deepEqual(out.options, ["Custom", "Option A"]);
  // 无汉化 → 无映射 → 原样返回
  assert.equal(resolveSelectValue("perm-sel-2", "Custom"), "Custom");
});

test("select 值反向映射：无映射的 request id 原样返回", async () => {
  const { resolveSelectValue, _clearSelectValueMapsForTest } = await loadSubject();
  _clearSelectValueMapsForTest();
  assert.equal(resolveSelectValue("never-registered", "任意值"), "任意值");
});
