// Recommended plugins — a curated list that pi-web auto-installs if missing.
// Users can still remove or disable any of them from the Plugins panel.

export interface RecommendedPlugin {
  source: string;
  name: string;
  description: string;
}

export const RECOMMENDED_PLUGINS: RecommendedPlugin[] = [
  {
    source: "npm:pi-subagents",
    name: "pi-subagents",
    description: "Delegate tasks to subagents with chains, parallel execution",
  },
  {
    source: "npm:pi-web-access",
    name: "pi-web-access",
    description: "Web search, URL fetching, GitHub cloning, PDF extraction",
  },
  {
    source: "npm:pi-mcp-adapter",
    name: "pi-mcp-adapter",
    description: "MCP server adapter — connect to any MCP server",
  },
  {
    source: "npm:context-mode",
    name: "context-mode",
    description: "Context window optimization — saves up to 98% of context",
  },
  {
    source: "npm:@hypabolic/pi-hypa",
    name: "@hypabolic/pi-hypa",
    description: "Hypa compression for shell/file/grep output",
  },
  {
    source: "npm:@juicesharp/rpiv-ask-user-question",
    name: "@juicesharp/rpiv-ask-user-question",
    description: "Structured questionnaire when the model would otherwise guess",
  },
  {
    source: "npm:@juicesharp/rpiv-todo",
    name: "@juicesharp/rpiv-todo",
    description: "Todo list with live overlay, survives reload and compaction",
  },
];
