// Plugin integration for pi-web.
//
// Plugins are split into two tiers:
// - DEFAULT_PLUGINS: required for core UI features. The Subagents API route
//   (app/api/subagents) and the Todo panel (components/TodoPanel.tsx +
//   lib/task-entry-resolver.ts) depend on these packages being present, so they
//   are always auto-installed and should not be removed.
// - RECOMMENDED_PLUGINS: optional productivity/quality packages that are
//   auto-installed on first start; users may still remove or disable any of
//   them from the Plugins panel.
//
// ALL_PLUGINS is the merged set consumed by the auto-installer
// (lib/plugin-auto-install.ts) and the /api/plugins/recommended route.

export type PluginTier = "default" | "recommended";

export interface RecommendedPlugin {
  source: string;
  name: string;
  description: string;
  tier: PluginTier;
}

// Core, UI-critical plugins — always installed, not user-removable.
export const DEFAULT_PLUGINS: RecommendedPlugin[] = [
  {
    source: "npm:pi-subagents",
    name: "pi-subagents",
    description: "Delegate tasks to subagents with chains, parallel execution",
    tier: "default",
  },
  {
    source: "npm:@juicesharp/rpiv-todo",
    name: "@juicesharp/rpiv-todo",
    description: "Todo list with live overlay, survives reload and compaction",
    tier: "default",
  },
];

// Optional plugins — auto-installed but user-removable.
export const RECOMMENDED_PLUGINS: RecommendedPlugin[] = [
  {
    source: "npm:pi-web-access",
    name: "pi-web-access",
    description: "Web search, URL fetching, GitHub cloning, PDF extraction",
    tier: "recommended",
  },
  {
    source: "npm:pi-mcp-adapter",
    name: "pi-mcp-adapter",
    description: "MCP server adapter — connect to any MCP server",
    tier: "recommended",
  },
  {
    source: "npm:context-mode",
    name: "context-mode",
    description: "Context window optimization — saves up to 98% of context",
    tier: "recommended",
  },
  {
    source: "npm:@juicesharp/rpiv-ask-user-question",
    name: "@juicesharp/rpiv-ask-user-question",
    description: "Structured questionnaire when the model would otherwise guess",
    tier: "recommended",
  },
  {
    source: "npm:pi-lens",
    name: "pi-lens",
    description: "Real-time code feedback — LSP, linters, formatters, type-checking",
    tier: "recommended",
  },
  {
    source: "npm:pi-simplify",
    name: "pi-simplify",
    description: "Review recently changed code for clarity and maintainability",
    tier: "recommended",
  },
  {
    source: "npm:pi-shazam",
    name: "pi-shazam",
    description: "Native codebase awareness — 7 structural analysis tools",
    tier: "recommended",
  },
  {
    source: "npm:pi-hermes-memory",
    name: "pi-hermes-memory",
    description: "Persistent memory + session search + secret scanning (368 tests)",
    tier: "recommended",
  },
  {
    source: "npm:cc-safety-net",
    name: "cc-safety-net",
    description: "Block destructive git and filesystem commands before execution",
    tier: "recommended",
  },
  {
    source: "npm:@juicesharp/rpiv-advisor",
    name: "@juicesharp/rpiv-advisor",
    description: "Second-opinion reviewer model before the agent acts",
    tier: "recommended",
  },
];

// Merged set used by the installer and the status route.
export const ALL_PLUGINS: RecommendedPlugin[] = [...DEFAULT_PLUGINS, ...RECOMMENDED_PLUGINS];
