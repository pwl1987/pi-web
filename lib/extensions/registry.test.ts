/**
 * Tests for lib/extensions/registry.ts — the singleton that holds all loaded
 * extensions and their qualified contributions.
 *
 * Seams under test:
 *   1. register() validates apiVersion, calls activate(), qualifies ids
 *   2. Query API (getActions / getWorkspacePanels / getWorkspaceLabelItems)
 *      filters, sorts, and flattens contributions
 *   3. list() / unregister() bookkeeping
 *
 * Migrated from registry.test.mjs (node:test) because the subject's runtime
 * value import of ./event-bus (extensionless) cannot resolve under Node's ESM
 * loader, even with --experimental-strip-types. Vitest's vite-based module
 * resolution handles extensionless imports natively, matching how the bundler
 * resolves them in production.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import type { ExtensionRuntimeContext, PiWebExtension, WorkspaceLabelContext } from "./types";
import { ExtensionRegistry } from "./registry";

// Minimal mock contexts for action/label queries.
const ctx: ExtensionRuntimeContext = {
  state: { selectedCwd: "/proj" },
  focusPrompt: () => {},
  openFilePanel: () => {},
  openExtensionPanel: () => {},
};
const labelCtx: WorkspaceLabelContext = {
  session: { id: "s1", cwd: "/proj" },
  cwd: "/proj",
  state: ctx.state,
};

// --- Registration validation ---

describe("ExtensionRegistry.register — validation", () => {
  it("registers an extension with all three contribution types", () => {
    const reg = new ExtensionRegistry();
    reg.register(
      {
        apiVersion: 1,
        name: "Test",
        activate: () => ({
          actions: [{ id: "act", title: "Action", run: () => {} }],
          workspacePanels: [{ id: "panel", title: "Panel", render: () => null }],
          workspaceLabels: [{ id: "label", items: () => [{ type: "text", text: "T" }] }],
        }),
      },
      { id: "test-ext", source: "bundled" },
    );

    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0].actionCount).toBe(1);
    expect(reg.list()[0].panelCount).toBe(1);
    expect(reg.list()[0].labelCount).toBe(1);
  });

  it("rejects invalid extension id (uppercase)", () => {
    const reg = new ExtensionRegistry();
    expect(() =>
      reg.register(
        { apiVersion: 1, name: "X", activate: () => ({}) },
        { id: "My-Ext", source: "local" },
      ),
    ).toThrow(/Invalid extension id/);
  });

  it("rejects empty extension id", () => {
    const reg = new ExtensionRegistry();
    expect(() =>
      reg.register({ apiVersion: 1, name: "X", activate: () => ({}) }, { id: "", source: "local" }),
    ).toThrow(/Invalid extension id/);
  });

  it("rejects extension id starting with a digit", () => {
    const reg = new ExtensionRegistry();
    expect(() =>
      reg.register(
        { apiVersion: 1, name: "X", activate: () => ({}) },
        { id: "1abc", source: "local" },
      ),
    ).toThrow(/Invalid extension id/);
  });

  it("rejects apiVersion !== 1", () => {
    const reg = new ExtensionRegistry();
    expect(() =>
      reg.register(
        // Cast: apiVersion is a literal `1` in the type; we deliberately
        // pass an invalid value to exercise the runtime guard.
        { apiVersion: 2 as 1, name: "X", activate: () => ({}) },
        { id: "ext", source: "local" },
      ),
    ).toThrow(/Unsupported extension API version/);
  });

  it("rejects duplicate extension id", () => {
    const reg = new ExtensionRegistry();
    const ext: PiWebExtension = { apiVersion: 1, name: "X", activate: () => ({}) };
    reg.register(ext, { id: "dup", source: "local" });
    expect(() => reg.register(ext, { id: "dup", source: "local" })).toThrow(
      /Duplicate extension id/,
    );
  });

  it("rejects invalid local contribution id", () => {
    const reg = new ExtensionRegistry();
    expect(() =>
      reg.register(
        {
          apiVersion: 1,
          name: "X",
          activate: () => ({ actions: [{ id: "BAD ID", title: "A", run: () => {} }] }),
        },
        { id: "ext", source: "local" },
      ),
    ).toThrow(/Invalid contribution id/);
  });

  it("rejects duplicate qualified contribution id within same extension", () => {
    const reg = new ExtensionRegistry();
    expect(() =>
      reg.register(
        {
          apiVersion: 1,
          name: "X",
          activate: () => ({
            actions: [
              { id: "same", title: "A", run: () => {} },
              { id: "same", title: "B", run: () => {} },
            ],
          }),
        },
        { id: "ext", source: "local" },
      ),
    ).toThrow(/Duplicate contribution id/);
  });
});

// --- Query logic ---

describe("ExtensionRegistry.getActions", () => {
  it("returns enabled actions", () => {
    const reg = new ExtensionRegistry();
    reg.register(
      {
        apiVersion: 1,
        name: "X",
        activate: () => ({ actions: [{ id: "a", title: "Run", run: () => {} }] }),
      },
      { id: "ext", source: "local" },
    );
    const actions = reg.getActions(ctx);
    expect(actions).toHaveLength(1);
    expect(actions[0].title).toBe("Run");
    expect(actions[0].qualifiedId).toBe("ext:a");
  });

  it("includes disabled actions that have a disabledReason", () => {
    const reg = new ExtensionRegistry();
    reg.register(
      {
        apiVersion: 1,
        name: "X",
        activate: () => ({
          actions: [
            {
              id: "a",
              title: "Disabled",
              enabled: () => false,
              disabledReason: () => "No project",
              run: () => {},
            },
          ],
        }),
      },
      { id: "ext", source: "local" },
    );
    const actions = reg.getActions(ctx);
    expect(actions).toHaveLength(1);
  });

  it("excludes disabled actions without a disabledReason", () => {
    const reg = new ExtensionRegistry();
    reg.register(
      {
        apiVersion: 1,
        name: "X",
        activate: () => ({
          actions: [{ id: "a", title: "Hidden", enabled: () => false, run: () => {} }],
        }),
      },
      { id: "ext", source: "local" },
    );
    const actions = reg.getActions(ctx);
    expect(actions).toHaveLength(0);
  });

  it("sorts by title", () => {
    const reg = new ExtensionRegistry();
    reg.register(
      {
        apiVersion: 1,
        name: "X",
        activate: () => ({
          actions: [
            { id: "z", title: "Zebra", run: () => {} },
            { id: "a", title: "Apple", run: () => {} },
          ],
        }),
      },
      { id: "ext", source: "local" },
    );
    const actions = reg.getActions(ctx);
    expect(actions[0].title).toBe("Apple");
    expect(actions[1].title).toBe("Zebra");
  });
});

describe("ExtensionRegistry.getWorkspacePanels", () => {
  it("sorts by order (default 1000)", () => {
    const reg = new ExtensionRegistry();
    reg.register(
      {
        apiVersion: 1,
        name: "X",
        activate: () => ({
          workspacePanels: [
            { id: "b", title: "B-default", render: () => null },
            { id: "a", title: "A-first", order: 100, render: () => null },
          ],
        }),
      },
      { id: "ext", source: "local" },
    );
    const panels = reg.getWorkspacePanels();
    expect(panels[0].title).toBe("A-first");
    expect(panels[1].title).toBe("B-default");
  });

  it("falls back to title sort when order is equal", () => {
    const reg = new ExtensionRegistry();
    reg.register(
      {
        apiVersion: 1,
        name: "X",
        activate: () => ({
          workspacePanels: [
            { id: "b", title: "Zeta", order: 500, render: () => null },
            { id: "a", title: "Alpha", order: 500, render: () => null },
          ],
        }),
      },
      { id: "ext", source: "local" },
    );
    const panels = reg.getWorkspacePanels();
    expect(panels[0].title).toBe("Alpha");
    expect(panels[1].title).toBe("Zeta");
  });
});

describe("ExtensionRegistry.getWorkspaceLabelItems", () => {
  it("filters visible === false", () => {
    const reg = new ExtensionRegistry();
    reg.register(
      {
        apiVersion: 1,
        name: "X",
        activate: () => ({
          workspaceLabels: [
            { id: "shown", items: () => [{ type: "text", text: "hi" }] },
            { id: "hidden", visible: () => false, items: () => [{ type: "text", text: "no" }] },
          ],
        }),
      },
      { id: "ext", source: "local" },
    );
    const items = reg.getWorkspaceLabelItems(labelCtx);
    expect(items).toHaveLength(1);
    expect(items[0].item.type).toBe("text");
    // Narrow the union — only the "text" variant carries the text field.
    const item = items[0].item;
    expect(item.type === "text" && item.text).toBe("hi");
  });

  it("filters out empty items arrays", () => {
    const reg = new ExtensionRegistry();
    reg.register(
      {
        apiVersion: 1,
        name: "X",
        activate: () => ({
          workspaceLabels: [
            { id: "empty", items: () => [] },
            { id: "full", items: () => [{ type: "text", text: "x" }] },
          ],
        }),
      },
      { id: "ext", source: "local" },
    );
    const items = reg.getWorkspaceLabelItems(labelCtx);
    expect(items).toHaveLength(1);
  });

  it("flattens multiple contributions", () => {
    const reg = new ExtensionRegistry();
    reg.register(
      {
        apiVersion: 1,
        name: "X",
        activate: () => ({
          workspaceLabels: [
            {
              id: "a",
              items: () => [
                { type: "text", text: "1" },
                { type: "text", text: "2" },
              ],
            },
            { id: "b", items: () => [{ type: "text", text: "3" }] },
          ],
        }),
      },
      { id: "ext", source: "local" },
    );
    const items = reg.getWorkspaceLabelItems(labelCtx);
    expect(items).toHaveLength(3);
  });
});

describe("ExtensionRegistry.getActionDisabledReason", () => {
  it("returns reason when disabled", () => {
    const reg = new ExtensionRegistry();
    reg.register(
      {
        apiVersion: 1,
        name: "X",
        activate: () => ({
          actions: [
            {
              id: "a",
              title: "A",
              enabled: () => false,
              disabledReason: () => "No project",
              run: () => {},
            },
          ],
        }),
      },
      { id: "ext", source: "local" },
    );
    const action = reg.getActions(ctx)[0];
    expect(reg.getActionDisabledReason(action, ctx)).toBe("No project");
  });

  it("returns undefined when enabled", () => {
    const reg = new ExtensionRegistry();
    reg.register(
      {
        apiVersion: 1,
        name: "X",
        activate: () => ({ actions: [{ id: "a", title: "A", run: () => {} }] }),
      },
      { id: "ext", source: "local" },
    );
    const action = reg.getActions(ctx)[0];
    expect(reg.getActionDisabledReason(action, ctx)).toBeUndefined();
  });
});

// --- list / unregister ---

describe("ExtensionRegistry.list / unregister", () => {
  it("list returns contribution counts", () => {
    const reg = new ExtensionRegistry();
    reg.register(
      {
        apiVersion: 1,
        name: "Multi",
        activate: () => ({
          actions: [
            { id: "a1", title: "A1", run: () => {} },
            { id: "a2", title: "A2", run: () => {} },
          ],
          workspacePanels: [{ id: "p1", title: "P1", render: () => null }],
        }),
      },
      { id: "multi", source: "local" },
    );
    const info = reg.list()[0];
    expect(info.name).toBe("Multi");
    expect(info.actionCount).toBe(2);
    expect(info.panelCount).toBe(1);
    expect(info.labelCount).toBe(0);
  });

  it("unregister removes contributions from queries", () => {
    const reg = new ExtensionRegistry();
    reg.register(
      {
        apiVersion: 1,
        name: "X",
        activate: () => ({ actions: [{ id: "a", title: "A", run: () => {} }] }),
      },
      { id: "ext", source: "local" },
    );
    expect(reg.getActions(ctx)).toHaveLength(1);
    reg.unregister("ext");
    expect(reg.getActions(ctx)).toHaveLength(0);
    expect(reg.list()).toHaveLength(0);
  });
});
