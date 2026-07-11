// pi-web extension: Git Status
// Demonstrates all three contribution types: action, panel, and label.
//
// This source is compiled to index.js (ESM, react/react-dom externalized) so it
// can be dynamically imported by pi-web at runtime. Uses window.React.

const React = (window as unknown as { React: typeof import("react") }).React;

// Minimal context types (matches pi-web's extension API contract).
interface RuntimeContext {
  state: {
    selectedSession?: { id: string; cwd?: string; name?: string } | null;
    selectedCwd?: string | null;
  };
  focusPrompt: () => void;
  openFilePanel: () => void;
  openExtensionPanel: (qualifiedId: string, title?: string) => void;
}
interface PanelContext {
  session?: { id: string; cwd?: string; name?: string } | null;
  cwd?: string;
  state: RuntimeContext["state"];
  requestRender: () => void;
}
interface LabelContext {
  session?: { id: string; cwd?: string; name?: string; worktreeBranch?: string } | null;
  cwd?: string;
  state: RuntimeContext["state"];
}

// Minimal types to avoid importing from pi-web at build time.
interface GitInfo {
  branch: string | null;
  modified: number;
  staged: number;
  untracked: number;
}

/** Fetch git status for a cwd via the pi-web API. */
async function fetchGitStatus(cwd?: string): Promise<GitInfo | null> {
  if (!cwd) return null;
  try {
    const res = await fetch(`/api/extensions/git-status?cwd=${encodeURIComponent(cwd)}`);
    if (!res.ok) return null;
    return (await res.json()) as GitInfo;
  } catch {
    return null;
  }
}

function GitPanel({ cwd }: { cwd?: string }) {
  const [info, setInfo] = React.useState<GitInfo | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGitStatus(cwd).then((data) => {
      if (!cancelled) {
        setInfo(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  if (loading) {
    return React.createElement(
      "div",
      { style: { padding: 16, color: "var(--text-muted)", fontSize: 13 } },
      "Loading git status…",
    );
  }
  if (!info) {
    return React.createElement(
      "div",
      { style: { padding: 16, color: "var(--text-dim)", fontSize: 13 } },
      "Not a git repository.",
    );
  }

  return React.createElement(
    "div",
    { style: { padding: 16, display: "flex", flexDirection: "column", gap: 8 } },
    React.createElement(
      "div",
      {
        style: {
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        },
      },
      React.createElement(
        "svg",
        {
          width: 14,
          height: 14,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        },
        React.createElement("line", { x1: 6, y1: 3, x2: 6, y2: 15 }),
        React.createElement("circle", { cx: 18, cy: 6, r: 3 }),
        React.createElement("circle", { cx: 6, cy: 18, r: 3 }),
        React.createElement("path", { d: "M18 9a9 9 0 0 1-9 9" }),
      ),
      info.branch || "(detached HEAD)",
    ),
    React.createElement(
      "div",
      { style: { display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)" } },
      React.createElement("span", null, `${info.modified} modified`),
      React.createElement("span", null, `${info.staged} staged`),
      React.createElement("span", null, `${info.untracked} untracked`),
    ),
  );
}

const gitStatusExtension = {
  apiVersion: 1 as const,
  name: "Git Status",
  activate: () => ({
    actions: [
      {
        id: "show-status",
        title: "Show Git Status",
        description: "Open the Git status panel in the sidebar",
        enabled: (ctx: RuntimeContext) => !!ctx.state.selectedCwd,
        disabledReason: (ctx: RuntimeContext) =>
          ctx.state.selectedCwd ? undefined : "No project selected",
        run: (ctx: RuntimeContext) => {
          ctx.openExtensionPanel("git-status:panel", "Git");
        },
      },
    ],
    workspacePanels: [
      {
        id: "panel",
        title: "Git",
        order: 100,
        icon: React.createElement(
          "svg",
          {
            width: 14,
            height: 14,
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
          React.createElement("line", { x1: 6, y1: 3, x2: 6, y2: 15 }),
          React.createElement("circle", { cx: 18, cy: 6, r: 3 }),
          React.createElement("circle", { cx: 6, cy: 18, r: 3 }),
          React.createElement("path", { d: "M18 9a9 9 0 0 1-9 9" }),
        ),
        render: (ctx: PanelContext) => React.createElement(GitPanel, { cwd: ctx.cwd }),
      },
    ],
    workspaceLabels: [
      {
        id: "branch-label",
        items: (ctx: LabelContext) => {
          // Read branch from session data (worktreeBranch field).
          const session = ctx.session as { worktreeBranch?: string } | null | undefined;
          const branch = session?.worktreeBranch;
          if (!branch) return [];
          return [
            {
              type: "text" as const,
              text: branch,
              icon: React.createElement(
                "svg",
                {
                  width: 9,
                  height: 9,
                  viewBox: "0 0 24 24",
                  fill: "none",
                  stroke: "currentColor",
                  strokeWidth: 2.4,
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                },
                React.createElement("line", { x1: 6, y1: 3, x2: 6, y2: 15 }),
                React.createElement("circle", { cx: 18, cy: 6, r: 3 }),
                React.createElement("circle", { cx: 6, cy: 18, r: 3 }),
                React.createElement("path", { d: "M18 9a9 9 0 0 1-9 9" }),
              ),
            },
          ];
        },
      },
    ],
  }),
};

export default gitStatusExtension;
