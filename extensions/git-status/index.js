// extensions/git-status/index.ts
var React = window.React;
async function fetchGitStatus(cwd) {
  if (!cwd) return null;
  try {
    const res = await fetch(`/api/extensions/git-status?cwd=${encodeURIComponent(cwd)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
function GitPanel({ cwd }) {
  const [info, setInfo] = React.useState(null);
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
      "Loading git status\u2026",
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
var gitStatusExtension = {
  apiVersion: 1,
  name: "Git Status",
  activate: () => ({
    actions: [
      {
        id: "show-status",
        title: "Show Git Status",
        description: "Open the Git status panel in the sidebar",
        enabled: (ctx) => !!ctx.state.selectedCwd,
        disabledReason: (ctx) => (ctx.state.selectedCwd ? void 0 : "No project selected"),
        run: (ctx) => {
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
        render: (ctx) => React.createElement(GitPanel, { cwd: ctx.cwd }),
      },
    ],
    workspaceLabels: [
      {
        id: "branch-label",
        items: (ctx) => {
          const session = ctx.session;
          const branch = session?.worktreeBranch;
          if (!branch) return [];
          return [
            {
              type: "text",
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
var index_default = gitStatusExtension;
export { index_default as default };
