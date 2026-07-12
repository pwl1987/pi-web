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

test("does not localize unrelated widgets or requests", async () => {
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

  const select = {
    type: "extension_ui_request",
    id: "s1",
    method: "select",
    title: "Type something.",
    options: ["Chat about this"],
  };
  const out2 = localizeExtensionUiRequest(select);
  assert.equal(out2.title, "Type something.");
  assert.deepEqual(out2.options, ["Chat about this"]);
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
