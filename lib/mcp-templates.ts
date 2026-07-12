// Built-in MCP server templates for quick reuse in the config panel.
// Each template maps directly onto the mcp.json `mcpServers` entry shape
// (see app/api/mcp-config/route.ts McpServerEntry), so "apply" just copies
// these fields into the add/edit form.

export interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  auth?: string;
  lifecycle?: string;
  idleTimeout?: number;
  requestTimeoutMs?: number;
}

export interface McpTemplate {
  id: string;
  label: string;
  description: string;
  builtin: boolean;
  server: McpServerEntry;
  /** Default server name suggested when applying this template. */
  defaultName: string;
}

export const BUILTIN_MCP_TEMPLATES: McpTemplate[] = [
  {
    id: "filesystem",
    label: "Filesystem",
    description: "Local file read/write operations under a given directory.",
    builtin: true,
    defaultName: "filesystem",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      lifecycle: "lazy",
    },
  },
  {
    id: "github",
    label: "GitHub",
    description: "Search repos, manage issues and PRs via the GitHub API.",
    builtin: true,
    defaultName: "github",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "" },
      lifecycle: "lazy",
    },
  },
  {
    id: "fetch",
    label: "Fetch",
    description: "Retrieve and convert web content to markdown/structured text.",
    builtin: true,
    defaultName: "fetch",
    server: {
      command: "uvx",
      args: ["mcp-server-fetch"],
      lifecycle: "lazy",
    },
  },
  {
    id: "git",
    label: "Git",
    description: "Read, search and manipulate local git repositories.",
    builtin: true,
    defaultName: "git",
    server: {
      command: "uvx",
      args: ["mcp-server-git"],
      lifecycle: "lazy",
    },
  },
  {
    id: "memory",
    label: "Memory (Knowledge Graph)",
    description: "Persistent knowledge-graph memory across sessions.",
    builtin: true,
    defaultName: "memory",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      lifecycle: "lazy",
    },
  },
  {
    id: "remote-sse",
    label: "Remote (URL)",
    description: "Connect to a remote MCP server over HTTP/SSE.",
    builtin: true,
    defaultName: "remote",
    server: {
      url: "https://",
      headers: {},
      lifecycle: "lazy",
    },
  },
  {
    id: "sequential-thinking",
    label: "Sequential Thinking",
    description: "Structured step-by-step reasoning and problem decomposition.",
    builtin: true,
    defaultName: "sequential-thinking",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      lifecycle: "lazy",
    },
  },
  {
    id: "puppeteer",
    label: "Puppeteer",
    description: "Browser automation, scraping and screenshot capture.",
    builtin: true,
    defaultName: "puppeteer",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-puppeteer"],
      lifecycle: "lazy",
    },
  },
  {
    id: "postgres",
    label: "PostgreSQL",
    description: "Query and inspect a PostgreSQL database.",
    builtin: true,
    defaultName: "postgres",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      env: { POSTGRES_CONNECTION_STRING: "" },
      lifecycle: "lazy",
    },
  },
  {
    id: "sqlite",
    label: "SQLite",
    description: "Query and manage a local SQLite database file.",
    builtin: true,
    defaultName: "sqlite",
    server: {
      command: "uvx",
      args: ["mcp-server-sqlite", "--db-path", "~/notes.db"],
      lifecycle: "lazy",
    },
  },
  {
    id: "brave-search",
    label: "Brave Search",
    description: "Web search via the Brave Search API.",
    builtin: true,
    defaultName: "brave-search",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: { BRAVE_API_KEY: "" },
      lifecycle: "lazy",
    },
  },
  {
    id: "slack",
    label: "Slack",
    description: "Read channels, send messages and manage Slack workspaces.",
    builtin: true,
    defaultName: "slack",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: { SLACK_BOT_TOKEN: "", SLACK_TEAM_ID: "" },
      lifecycle: "lazy",
    },
  },
  {
    id: "google-maps",
    label: "Google Maps",
    description: "Geocoding, routes and places via the Google Maps API.",
    builtin: true,
    defaultName: "google-maps",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-google-maps"],
      env: { GOOGLE_MAPS_API_KEY: "" },
      lifecycle: "lazy",
    },
  },
  {
    id: "time",
    label: "Time",
    description: "Local and timezone-aware time conversion utilities.",
    builtin: true,
    defaultName: "time",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-time"],
      lifecycle: "lazy",
    },
  },
  {
    id: "docker",
    label: "Docker",
    description: "Manage containers, images and volumes via the Docker daemon.",
    builtin: true,
    defaultName: "docker",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-docker"],
      lifecycle: "lazy",
    },
  },
  {
    id: "context7",
    label: "Context7",
    description: "Fetch up-to-date library docs and code examples by prompt.",
    builtin: true,
    defaultName: "context7",
    server: {
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      lifecycle: "lazy",
    },
  },
  {
    id: "notion",
    label: "Notion",
    description: "Search and manage Notion pages via the Notion API.",
    builtin: true,
    defaultName: "notion",
    server: {
      command: "npx",
      args: ["-y", "mcp-notion-server"],
      env: { OPENAPI_MCP_HEADERS: "" },
      lifecycle: "lazy",
    },
  },
  {
    id: "desktop-commander",
    label: "Desktop Commander",
    description: "Filesystem and terminal control with permission scoping.",
    builtin: true,
    defaultName: "desktop-commander",
    server: {
      command: "npx",
      args: ["-y", "@wonderwhy-er/desktop-commander-mcp"],
      lifecycle: "lazy",
    },
  },
  {
    id: "playwright",
    label: "Playwright",
    description: "Browser automation via Playwright (accessibility snapshots, no vision model).",
    builtin: true,
    defaultName: "playwright",
    server: {
      command: "npx",
      args: ["-y", "@playwright/mcp"],
      lifecycle: "lazy",
    },
  },
  {
    id: "chrome-devtools",
    label: "Chrome DevTools",
    description: "Drive Chrome/Chromium through the DevTools protocol.",
    builtin: true,
    defaultName: "chrome-devtools",
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-chrome-devtools"],
      lifecycle: "lazy",
    },
  },
  {
    id: "browserbase",
    label: "Browserbase",
    description: "Cloud browser sessions and automation via Browserbase.",
    builtin: true,
    defaultName: "browserbase",
    server: {
      command: "npx",
      args: ["-y", "@browserbasehq/mcp"],
      env: { BROWSERBASE_API_KEY: "", BROWSERBASE_PROJECT_ID: "" },
      lifecycle: "lazy",
    },
  },
  {
    id: "codegraph",
    label: "CodeGraph",
    description:
      "Local code knowledge graph (tree-sitter + SQLite). Run `codegraph init` in your project first.",
    builtin: true,
    defaultName: "codegraph",
    server: {
      command: "npx",
      args: ["-y", "@colbymchenry/codegraph", "serve", "--mcp"],
      lifecycle: "lazy",
    },
  },
];
