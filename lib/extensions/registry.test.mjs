import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./registry.ts");
}

// Minimal mock context for action/label queries.
const ctx = {
  state: { selectedCwd: "/proj" },
  focusPrompt: () => {},
  openFilePanel: () => {},
  openExtensionPanel: () => {},
};
const labelCtx = { session: { id: "s1", cwd: "/proj" }, cwd: "/proj", state: ctx.state };

// --- Registration validation ---

test("registers an extension with all three contribution types", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  reg.register({
    apiVersion: 1,
    name: "Test",
    activate: () => ({
      actions: [{ id: "act", title: "Action", run: () => {} }],
      workspacePanels: [{ id: "panel", title: "Panel", render: () => null }],
      workspaceLabels: [{ id: "label", items: () => [{ type: "text", text: "T" }] }],
    }),
  }, { id: "test-ext", source: "bundled" });

  assert.equal(reg.list().length, 1);
  assert.equal(reg.list()[0].actionCount, 1);
  assert.equal(reg.list()[0].panelCount, 1);
  assert.equal(reg.list()[0].labelCount, 1);
});

test("rejects invalid extension id (uppercase)", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  assert.throws(
    () => reg.register({ apiVersion: 1, name: "X", activate: () => ({}) }, { id: "My-Ext", source: "local" }),
    /Invalid extension id/,
  );
});

test("rejects empty extension id", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  assert.throws(
    () => reg.register({ apiVersion: 1, name: "X", activate: () => ({}) }, { id: "", source: "local" }),
    /Invalid extension id/,
  );
});

test("rejects extension id starting with a digit", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  assert.throws(
    () => reg.register({ apiVersion: 1, name: "X", activate: () => ({}) }, { id: "1abc", source: "local" }),
    /Invalid extension id/,
  );
});

test("rejects apiVersion !== 1", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  assert.throws(
    () => reg.register({ apiVersion: 2, name: "X", activate: () => ({}) }, { id: "ext", source: "local" }),
    /Unsupported extension API version/,
  );
});

test("rejects duplicate extension id", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  const ext = { apiVersion: 1, name: "X", activate: () => ({}) };
  reg.register(ext, { id: "dup", source: "local" });
  assert.throws(
    () => reg.register(ext, { id: "dup", source: "local" }),
    /Duplicate extension id/,
  );
});

test("rejects invalid local contribution id", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  assert.throws(
    () => reg.register({
      apiVersion: 1, name: "X",
      activate: () => ({ actions: [{ id: "BAD ID", title: "A", run: () => {} }] }),
    }, { id: "ext", source: "local" }),
    /Invalid contribution id/,
  );
});

test("rejects duplicate qualified contribution id within same extension", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  assert.throws(
    () => reg.register({
      apiVersion: 1, name: "X",
      activate: () => ({
        actions: [
          { id: "same", title: "A", run: () => {} },
          { id: "same", title: "B", run: () => {} },
        ],
      }),
    }, { id: "ext", source: "local" }),
    /Duplicate contribution id/,
  );
});

// --- Query logic ---

test("getActions returns enabled actions", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  reg.register({
    apiVersion: 1, name: "X",
    activate: () => ({ actions: [{ id: "a", title: "Run", run: () => {} }] }),
  }, { id: "ext", source: "local" });
  const actions = reg.getActions(ctx);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].title, "Run");
  assert.equal(actions[0].qualifiedId, "ext:a");
});

test("getActions includes disabled actions that have a disabledReason", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  reg.register({
    apiVersion: 1, name: "X",
    activate: () => ({
      actions: [{
        id: "a", title: "Disabled",
        enabled: () => false,
        disabledReason: () => "No project",
        run: () => {},
      }],
    }),
  }, { id: "ext", source: "local" });
  const actions = reg.getActions(ctx);
  assert.equal(actions.length, 1, "disabled action with reason should be visible");
});

test("getActions excludes disabled actions without a disabledReason", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  reg.register({
    apiVersion: 1, name: "X",
    activate: () => ({
      actions: [{ id: "a", title: "Hidden", enabled: () => false, run: () => {} }],
    }),
  }, { id: "ext", source: "local" });
  const actions = reg.getActions(ctx);
  assert.equal(actions.length, 0, "disabled action without reason should be hidden");
});

test("getActions sorts by title", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  reg.register({
    apiVersion: 1, name: "X",
    activate: () => ({
      actions: [
        { id: "z", title: "Zebra", run: () => {} },
        { id: "a", title: "Apple", run: () => {} },
      ],
    }),
  }, { id: "ext", source: "local" });
  const actions = reg.getActions(ctx);
  assert.equal(actions[0].title, "Apple");
  assert.equal(actions[1].title, "Zebra");
});

test("getWorkspacePanels sorts by order (default 1000)", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  reg.register({
    apiVersion: 1, name: "X",
    activate: () => ({
      workspacePanels: [
        { id: "b", title: "B-default", render: () => null },
        { id: "a", title: "A-first", order: 100, render: () => null },
      ],
    }),
  }, { id: "ext", source: "local" });
  const panels = reg.getWorkspacePanels();
  assert.equal(panels[0].title, "A-first");
  assert.equal(panels[1].title, "B-default");
});

test("getWorkspacePanels falls back to title sort when order is equal", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  reg.register({
    apiVersion: 1, name: "X",
    activate: () => ({
      workspacePanels: [
        { id: "b", title: "Zeta", order: 500, render: () => null },
        { id: "a", title: "Alpha", order: 500, render: () => null },
      ],
    }),
  }, { id: "ext", source: "local" });
  const panels = reg.getWorkspacePanels();
  assert.equal(panels[0].title, "Alpha");
  assert.equal(panels[1].title, "Zeta");
});

test("getWorkspaceLabelItems filters visible === false", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  reg.register({
    apiVersion: 1, name: "X",
    activate: () => ({
      workspaceLabels: [
        { id: "shown", items: () => [{ type: "text", text: "hi" }] },
        { id: "hidden", visible: () => false, items: () => [{ type: "text", text: "no" }] },
      ],
    }),
  }, { id: "ext", source: "local" });
  const items = reg.getWorkspaceLabelItems(labelCtx);
  assert.equal(items.length, 1);
  assert.equal(items[0].item.text, "hi");
});

test("getWorkspaceLabelItems filters out empty items arrays", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  reg.register({
    apiVersion: 1, name: "X",
    activate: () => ({
      workspaceLabels: [
        { id: "empty", items: () => [] },
        { id: "full", items: () => [{ type: "text", text: "x" }] },
      ],
    }),
  }, { id: "ext", source: "local" });
  const items = reg.getWorkspaceLabelItems(labelCtx);
  assert.equal(items.length, 1);
});

test("getWorkspaceLabelItems flattens multiple contributions", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  reg.register({
    apiVersion: 1, name: "X",
    activate: () => ({
      workspaceLabels: [
        { id: "a", items: () => [{ type: "text", text: "1" }, { type: "text", text: "2" }] },
        { id: "b", items: () => [{ type: "text", text: "3" }] },
      ],
    }),
  }, { id: "ext", source: "local" });
  const items = reg.getWorkspaceLabelItems(labelCtx);
  assert.equal(items.length, 3);
});

test("getActionDisabledReason returns reason when disabled", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  reg.register({
    apiVersion: 1, name: "X",
    activate: () => ({
      actions: [{
        id: "a", title: "A",
        enabled: () => false,
        disabledReason: () => "No project",
        run: () => {},
      }],
    }),
  }, { id: "ext", source: "local" });
  const action = reg.getActions(ctx)[0];
  assert.equal(reg.getActionDisabledReason(action, ctx), "No project");
});

test("getActionDisabledReason returns undefined when enabled", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  reg.register({
    apiVersion: 1, name: "X",
    activate: () => ({ actions: [{ id: "a", title: "A", run: () => {} }] }),
  }, { id: "ext", source: "local" });
  const action = reg.getActions(ctx)[0];
  assert.equal(reg.getActionDisabledReason(action, ctx), undefined);
});

// --- list / unregister ---

test("list returns contribution counts", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  reg.register({
    apiVersion: 1, name: "Multi",
    activate: () => ({
      actions: [{ id: "a1", title: "A1", run: () => {} }, { id: "a2", title: "A2", run: () => {} }],
      workspacePanels: [{ id: "p1", title: "P1", render: () => null }],
    }),
  }, { id: "multi", source: "local" });
  const info = reg.list()[0];
  assert.equal(info.name, "Multi");
  assert.equal(info.actionCount, 2);
  assert.equal(info.panelCount, 1);
  assert.equal(info.labelCount, 0);
});

test("unregister removes contributions from queries", async () => {
  const { ExtensionRegistry } = await loadSubject();
  const reg = new ExtensionRegistry();
  reg.register({
    apiVersion: 1, name: "X",
    activate: () => ({ actions: [{ id: "a", title: "A", run: () => {} }] }),
  }, { id: "ext", source: "local" });
  assert.equal(reg.getActions(ctx).length, 1);
  reg.unregister("ext");
  assert.equal(reg.getActions(ctx).length, 0);
  assert.equal(reg.list().length, 0);
});
