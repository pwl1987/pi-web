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
  // Names of plugins this one is designed to work *with* (e.g. pi-rtk
  // complements context-mode). Surfaced in the Plugins panel.
  complements?: string[];
  // Names of plugins this one is *incompatible* with. If two enabled plugins
  // reference each other here, validatePluginCompatibility() reports a conflict.
  conflicts?: string[];
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
    complements: ["pi-rtk"],
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
  {
    source: "npm:gentle-pi",
    name: "gentle-pi",
    description: "Spec-driven harness with SDD/OpenSpec, strict TDD evidence and review guardrails",
    tier: "recommended",
  },
  {
    source: "npm:@plannotator/pi-extension",
    name: "@plannotator/pi-extension",
    description: "Interactive plan review with annotations, review code/PRs",
    tier: "recommended",
  },
  {
    source: "npm:pi-landstrip",
    name: "pi-landstrip",
    description: "Landlock-based OS sandboxing with interactive permission prompts",
    tier: "recommended",
  },
  {
    source: "npm:pi-agent-browser-native",
    name: "pi-agent-browser-native",
    description: "Browser automation as a native tool for UI end-to-end checks",
    tier: "recommended",
  },
  {
    source: "npm:superpowers-zh",
    name: "superpowers-zh",
    description: "Chinese engineering-methodology skill set (superpowers full translation)",
    tier: "recommended",
  },
  {
    source: "npm:@raindrop-ai/pi-agent",
    name: "@raindrop-ai/pi-agent",
    description: "Observability tracing for sessions, turns, LLM calls and tool executions",
    tier: "recommended",
  },
  {
    source: "npm:@gotgenes/pi-permission-system",
    name: "@gotgenes/pi-permission-system",
    description: "Declarative tool-level permission enforcement (allow/deny/ask)",
    tier: "recommended",
  },
  {
    source: "npm:latchkey",
    name: "latchkey",
    description: "Inject API credentials into requests without hardcoding secrets",
    tier: "recommended",
  },
  {
    source: "npm:@ayulab/pi-rewind",
    name: "@ayulab/pi-rewind",
    description: "/rewind checkpoint navigation for fast agent-side rollbacks",
    tier: "recommended",
  },
  {
    source: "npm:@dietrichgebert/ponytail",
    name: "@dietrichgebert/ponytail",
    description: "Lazy senior-dev discipline — prefer reuse and deletion over new code",
    tier: "recommended",
  },
  {
    source: "npm:pi-rtk",
    name: "pi-rtk",
    description:
      "Token reduction by intelligently filtering tool output (60-90%) — complements context-mode",
    tier: "recommended",
    complements: ["context-mode"],
  },
];

// Merged set used by the installer and the status route.
export const ALL_PLUGINS: RecommendedPlugin[] = [...DEFAULT_PLUGINS, ...RECOMMENDED_PLUGINS];

/**
 * Declarative compatibility check for the plugin set.
 *
 * This is the layer pi-web owns: we cannot unit-test the actual pi-agent
 * runtime interaction between two extensions, but we CAN guarantee the
 * management layer never activates a known-incompatible pair, and that plugins
 * meant to work together are explicitly marked via `complements`.
 *
 * A pair is *conflicting* when one plugin lists the other's `name` in its
 * `conflicts` array while both are present in the set. Returns a list of
 * human-readable conflict messages; an empty array means the set is valid.
 */
export function validatePluginCompatibility(plugins: RecommendedPlugin[]): string[] {
  const byName = new Map(plugins.map((p) => [p.name, p]));
  const errors: string[] = [];
  const seenSources = new Set<string>();
  const seenNames = new Set<string>();

  for (const p of plugins) {
    if (seenSources.has(p.source)) {
      errors.push(`Duplicate plugin source: ${p.source}`);
    }
    seenSources.add(p.source);
    if (seenNames.has(p.name)) {
      errors.push(`Duplicate plugin name: ${p.name}`);
    }
    seenNames.add(p.name);

    for (const conflict of p.conflicts ?? []) {
      if (byName.has(conflict)) {
        errors.push(
          `Conflict: "${p.name}" declares incompatibility with "${conflict}", ` +
            `but both are enabled in the plugin set`,
        );
      }
    }
  }

  return errors;
}
