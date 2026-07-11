// Per-plugin configuration descriptors for the system-default (pinned) plugin
// set, plus any other plugin that exposes user-tunable settings through
// pi-web. Each descriptor drives an independent config page rendered by
// components/PluginConfigPage.tsx — the page is data-driven, so every plugin
// in the manifest gets its own isolated configuration surface without
// bespoke component code.
//
// Values are persisted as a per-source key/value map in the agent-dir
// sidecar `plugins-config.json` (see app/api/plugins/config/route.ts) and
// surfaced to the agent as documented below. Where a plugin owns its own
// config file, the descriptor's `storage` hint tells the UI where the value
// ultimately lands.

export type PluginConfigFieldType =
  "toggle" | "select" | "multiselect" | "text" | "number" | "list";

export interface PluginConfigOption {
  value: string;
  label: string;
  description?: string;
}

export interface PluginConfigField {
  /** Stable key within the plugin's config namespace. */
  key: string;
  label: string;
  type: PluginConfigFieldType;
  /** Default applied when no value is stored. */
  default: string | number | boolean | string[];
  help?: string;
  /** For select / multiselect. */
  options?: PluginConfigOption[];
  /** For number. */
  min?: number;
  max?: number;
  step?: number;
  /** For text / list — placeholder or example. */
  placeholder?: string;
  /**
   * Where the value is ultimately consumed. "sidecar" (default) means
   * plugins-config.json; "plugin" means the plugin reads it from its own
   * config path (e.g. ~/.pi/agent/caveman.json) and the page writes there
   * via the config route.
   */
  storage?: "sidecar" | "plugin";
}

export interface PluginConfigDescriptor {
  source: string;
  name: string;
  /** Short blurb shown at the top of the config page. */
  summary: string;
  /** Documentation / source link surfaced in the UI. */
  docs?: string;
  fields: PluginConfigField[];
}

// ============================================================================
// Manifest plugin descriptors — one independent config page each.
// ============================================================================

export const PLUGIN_CONFIG_DESCRIPTORS: Record<string, PluginConfigDescriptor> = {
  // --- context-mode: context-window compression --------------------------
  "npm:context-mode": {
    source: "npm:context-mode",
    name: "context-mode",
    summary:
      "Compresses the assembled context window (sandboxed execution, FTS5 knowledge base, intent-driven search) to save up to 98% of tokens.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "Enable context-mode",
        type: "toggle",
        default: true,
        help: "Master switch. When off, the raw context window is used.",
      },
      {
        key: "compressionLevel",
        label: "Compression level",
        type: "select",
        default: "balanced",
        options: [
          { value: "off", label: "Off", description: "No compression" },
          { value: "light", label: "Light", description: "Conservative trimming" },
          { value: "balanced", label: "Balanced", description: "Recommended default" },
          {
            value: "aggressive",
            label: "Aggressive",
            description: "Maximum savings, higher risk of lost detail",
          },
        ],
        help: "Higher levels save more context but may drop supporting detail.",
      },
      {
        key: "sandboxExecution",
        label: "Sandboxed code execution",
        type: "toggle",
        default: true,
        help: "Run compression helpers in a sandbox to avoid side effects on the host.",
      },
      {
        key: "knowledgeBase",
        label: "FTS5 knowledge base",
        type: "toggle",
        default: true,
        help: "Maintain a full-text index of the codebase for intent-driven search.",
      },
    ],
  },

  // --- @hypabolic/pi-hypa: deterministic context compression -------------
  "npm:@hypabolic/pi-hypa": {
    source: "npm:@hypabolic/pi-hypa",
    name: "@hypabolic/pi-hypa",
    summary:
      "Deterministic context compression: rewrites shell commands through Hypa, context-aware file tools, and recoverable evidence. Complements context-mode/pi-rtk.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "Enable Hypa compression",
        type: "toggle",
        default: true,
        help: "Master switch for shell-command rewriting and file-tool compression.",
      },
      {
        key: "bridgeMode",
        label: "MCP bridge",
        type: "select",
        default: "on",
        options: [
          {
            value: "on",
            label: "On",
            description: "Persistent session cache for unchanged re-reads",
          },
          { value: "off", label: "Off", description: "No cross-call cache" },
        ],
        help: "The embedded MCP bridge keeps a rolling cache so unchanged re-reads cost ~13 tokens.",
      },
      {
        key: "recoverableEvidence",
        label: "Keep recoverable evidence",
        type: "toggle",
        default: true,
        help: "Store compressed artifacts so edits remain reversible.",
      },
    ],
  },

  // --- pi-rtk: tool-output token reduction -------------------------------
  "npm:pi-rtk": {
    source: "npm:pi-rtk",
    name: "pi-rtk",
    summary:
      "Intelligently filters raw tool output (60-90% reduction) before it enters the context. Complements context-mode.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "Enable pi-rtk",
        type: "toggle",
        default: true,
      },
      {
        key: "filterLevel",
        label: "Filter level",
        type: "select",
        default: "balanced",
        options: [
          { value: "conservative", label: "Conservative" },
          { value: "balanced", label: "Balanced" },
          { value: "aggressive", label: "Aggressive" },
        ],
      },
      {
        key: "maxOutputTokens",
        label: "Max output tokens kept",
        type: "number",
        default: 2000,
        min: 256,
        max: 32000,
        step: 256,
        help: "Hard cap on tokens retained from any single tool result.",
      },
    ],
  },

  // --- cc-safety-net: pre-execution guardrails ---------------------------
  "npm:cc-safety-net": {
    source: "npm:cc-safety-net",
    name: "cc-safety-net",
    summary:
      "Blocks destructive git and filesystem commands (force push, hard reset, rm -rf, etc.) before they execute.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "blockDestructiveGit",
        label: "Block destructive git commands",
        type: "toggle",
        default: true,
        help: "Intercepts push --force, reset --hard, checkout ., clean -f, etc.",
      },
      {
        key: "blockDestructiveFs",
        label: "Block destructive filesystem commands",
        type: "toggle",
        default: true,
        help: "Intercepts rm -rf, > file overwrite of important paths, chmod 000, etc.",
      },
      {
        key: "requireConfirm",
        label: "Require confirmation",
        type: "toggle",
        default: true,
        help: "Prompt before allowing a flagged-but-permitted command.",
      },
      {
        key: "allowlist",
        label: "Allowed command patterns",
        type: "list",
        default: [] as string[],
        placeholder: "git reset --soft, git stash",
        help: "Comma-separated patterns that are always permitted (bypass the block).",
      },
    ],
  },

  // --- pi-subagents: delegation core -------------------------------------
  "npm:pi-subagents": {
    source: "npm:pi-subagents",
    name: "pi-subagents",
    summary:
      "Delegates tasks to subagents with chains and parallel execution. Required by the Subagents panel.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "maxParallel",
        label: "Max parallel subagents",
        type: "number",
        default: 4,
        min: 1,
        max: 32,
        step: 1,
        help: "Upper bound on concurrently running subagents.",
      },
      {
        key: "enableTui",
        label: "Enable TUI clarification",
        type: "toggle",
        default: false,
        help: "Allow subagents to pause for interactive clarification.",
      },
    ],
  },

  // --- @juicesharp/rpiv-todo: live todo overlay --------------------------
  "npm:@juicesharp/rpiv-todo": {
    source: "npm:@juicesharp/rpiv-todo",
    name: "@juicesharp/rpiv-todo",
    summary:
      "A todo list for the model, rendered as a live overlay that survives /reload and conversation compaction.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "showOverlay",
        label: "Show live overlay",
        type: "toggle",
        default: true,
        help: "Render the todo list inline in the chat during a run.",
      },
      {
        key: "surviveCompaction",
        label: "Survive compaction",
        type: "toggle",
        default: true,
        help: "Persist the todo list across context compaction.",
      },
    ],
  },

  // --- Gap-filling / performance / DX recommendations (task 1) -----------
  "npm:pi-lean-ctx": {
    source: "npm:pi-lean-ctx",
    name: "pi-lean-ctx",
    summary:
      "Routes bash/read/grep/find/ls through a lean channel so unchanged re-reads cost ~13 tokens instead of the full file.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "Enable lean-ctx",
        type: "toggle",
        default: true,
      },
      {
        key: "mode",
        label: "Mode",
        type: "select",
        default: "lean",
        options: [
          {
            value: "lean",
            label: "Lean",
            description: "Compress re-reads to a minimal token footprint",
          },
          { value: "full", label: "Full", description: "Always return full tool output" },
        ],
        help: "Lean mode keeps a rolling cache of recently read files.",
      },
    ],
  },

  "npm:@ff-labs/pi-fff": {
    source: "npm:@ff-labs/pi-fff",
    name: "@ff-labs/pi-fff",
    summary:
      "Fuzzy full-text retrieval across the codebase, cutting down grep noise and token waste.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "Enable fuzzy retrieval",
        type: "toggle",
        default: true,
      },
      {
        key: "scope",
        label: "Search scope",
        type: "select",
        default: "repo",
        options: [
          { value: "repo", label: "Whole repo" },
          { value: "openFiles", label: "Open files only" },
        ],
      },
    ],
  },

  "npm:pi-readseek": {
    source: "npm:pi-readseek",
    name: "pi-readseek",
    summary:
      "Hash-anchored precise reads — point at the exact region of a file without dumping the entire file into context.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "Enable readseek",
        type: "toggle",
        default: true,
      },
      {
        key: "anchorPrecision",
        label: "Anchor precision",
        type: "select",
        default: "line",
        options: [
          { value: "line", label: "Line" },
          { value: "hash", label: "Content hash" },
        ],
        help: "Hash anchoring is more robust to nearby edits but slightly heavier.",
      },
    ],
  },

  "npm:pi-hashline-edit-pro": {
    source: "npm:pi-hashline-edit-pro",
    name: "pi-hashline-edit-pro",
    summary:
      "Hash-anchored precise edits — apply changes by content hash for fewer round-trips and safer diffs.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "Enable hashline-edit",
        type: "toggle",
        default: true,
      },
      {
        key: "createBackups",
        label: "Create backups before edit",
        type: "toggle",
        default: true,
        help: "Write a .bak before mutating so edits are reversible.",
      },
    ],
  },

  "npm:@braintrust/pi-extension": {
    source: "npm:@braintrust/pi-extension",
    name: "@braintrust/pi-extension",
    summary: "Observability tracing for LLM calls and tool executions, with exportable traces.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "Enable tracing",
        type: "toggle",
        default: true,
      },
      {
        key: "exportFormat",
        label: "Export format",
        type: "select",
        default: "jsonl",
        options: [
          { value: "jsonl", label: "JSONL" },
          { value: "csv", label: "CSV" },
        ],
      },
    ],
  },

  "npm:pi-powerline-footer": {
    source: "npm:pi-powerline-footer",
    name: "pi-powerline-footer",
    summary: "A status footer showing live token usage and cost during a run.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "showTokenCount",
        label: "Show token count",
        type: "toggle",
        default: true,
      },
      {
        key: "showCost",
        label: "Show cost estimate",
        type: "toggle",
        default: true,
      },
    ],
  },

  // --- Remaining recommended plugins (full-catalog coverage) ------------
  // Best-effort descriptors so every recommended plugin gets its own isolated
  // config surface. Values persist to plugins-config.json; where a plugin owns
  // its own config file, the descriptor documents the effective knobs.

  "npm:pi-search-hub": {
    source: "npm:pi-search-hub",
    name: "pi-search-hub",
    summary:
      "Unified web search + content extraction across 19 backends. Ships keyless options (Firecrawl [keyless], SearXNG, DuckDuckGo, Jina Reader) so search works with no API key.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "defaultBackend",
        label: "Default search backend",
        type: "select",
        default: "firecrawl-keyless",
        help: "Pick a keyless backend to search without any API key. Keyed backends (Tavily, Brave, Exa, Perplexity…) are available once you add a key.",
        options: [
          {
            value: "firecrawl-keyless",
            label: "Firecrawl (keyless)",
            description: "Free, no API key required",
          },
          { value: "duckduckgo", label: "DuckDuckGo", description: "Free, no API key required" },
          { value: "searxng", label: "SearXNG", description: "Self-hosted, no API key required" },
          {
            value: "jina",
            label: "Jina Reader",
            description: "Read/extract pages, no API key required",
          },
          { value: "tavily", label: "Tavily (needs key)" },
          { value: "brave", label: "Brave (needs key)" },
          { value: "exa", label: "Exa (needs key)" },
          { value: "perplexity", label: "Perplexity Sonar (needs key)" },
        ],
      },
      {
        key: "searxngUrl",
        label: "SearXNG instance URL",
        type: "text",
        default: "",
        placeholder: "https://searxng.example.com",
        help: "Required only when defaultBackend = searxng.",
      },
      {
        key: "enableExtraction",
        label: "Enable content extraction",
        type: "toggle",
        default: true,
      },
      {
        key: "maxResults",
        label: "Max results per query",
        type: "number",
        default: 5,
        min: 1,
        max: 50,
        step: 1,
      },
    ],
  },

  "npm:pi-mcp-adapter": {
    source: "npm:pi-mcp-adapter",
    name: "pi-mcp-adapter",
    summary: "Adapter that connects the agent to any MCP server.",
    docs: "https://pi.dev/packages",
    fields: [
      { key: "autoConnect", label: "Auto-connect on start", type: "toggle", default: true },
      {
        key: "servers",
        label: "Server entries",
        type: "list",
        default: [] as string[],
        placeholder: "npx -y @modelcontextprotocol/server-filesystem /path",
        help: "One MCP server launch command per line.",
      },
    ],
  },

  "npm:@juicesharp/rpiv-ask-user-question": {
    source: "npm:@juicesharp/rpiv-ask-user-question",
    name: "@juicesharp/rpiv-ask-user-question",
    summary:
      "Structured questionnaire the model can put to you instead of guessing, with typed options.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "maxOptions",
        label: "Max options per question",
        type: "number",
        default: 4,
        min: 2,
        max: 8,
        step: 1,
      },
      { key: "requireTyped", label: "Require typed answers", type: "toggle", default: false },
    ],
  },

  "npm:pi-lens": {
    source: "npm:pi-lens",
    name: "pi-lens",
    summary:
      "Real-time code feedback — LSP, linters, formatters, type-checking and structural analysis.",
    docs: "https://pi.dev/packages",
    fields: [
      { key: "enableLsp", label: "Enable LSP", type: "toggle", default: true },
      { key: "enableLinters", label: "Enable linters", type: "toggle", default: true },
      { key: "enableFormatters", label: "Enable formatters", type: "toggle", default: true },
      { key: "failOnError", label: "Fail on error", type: "toggle", default: false },
    ],
  },

  "npm:pi-simplify": {
    source: "npm:pi-simplify",
    name: "pi-simplify",
    summary: "Reviews recently changed code for clarity, consistency and maintainability.",
    docs: "https://pi.dev/packages",
    fields: [
      { key: "autoReview", label: "Auto-review on change", type: "toggle", default: false },
      {
        key: "scope",
        label: "Review scope",
        type: "select",
        default: "changed",
        options: [
          { value: "changed", label: "Changed files" },
          { value: "all", label: "Whole repo" },
        ],
      },
    ],
  },

  "npm:pi-shazam": {
    source: "npm:pi-shazam",
    name: "pi-shazam",
    summary:
      "Native codebase awareness toolkit — 7 structural analysis tools (also MCP-compatible).",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enableStructural",
        label: "Enable structural analysis",
        type: "toggle",
        default: true,
      },
      { key: "enableMcp", label: "Expose via MCP", type: "toggle", default: false },
    ],
  },

  "npm:pi-hermes-memory": {
    source: "npm:pi-hermes-memory",
    name: "pi-hermes-memory",
    summary: "Persistent memory + session search + secret scanning (SQLite FTS5, 368 tests).",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "policyMode",
        label: "Memory policy",
        type: "select",
        default: "token-aware",
        options: [
          { value: "token-aware", label: "Token-aware (default)" },
          { value: "full", label: "Full" },
        ],
      },
      { key: "enableSecretScan", label: "Scan for secrets", type: "toggle", default: true },
      { key: "autoConsolidate", label: "Auto-consolidate memories", type: "toggle", default: true },
    ],
  },

  "npm:@juicesharp/rpiv-advisor": {
    source: "npm:@juicesharp/rpiv-advisor",
    name: "@juicesharp/rpiv-advisor",
    summary: "A second-opinion reviewer model the agent can consult before acting.",
    docs: "https://pi.dev/packages",
    fields: [
      { key: "autoRequest", label: "Auto-request review", type: "toggle", default: false },
      {
        key: "reviewerModel",
        label: "Reviewer model",
        type: "text",
        default: "",
        placeholder: "e.g. gpt-4o",
      },
    ],
  },

  "npm:gentle-pi": {
    source: "npm:gentle-pi",
    name: "gentle-pi",
    summary: "Senior-architect harness: SDD/OpenSpec, strict TDD evidence, review guardrails.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enforcement",
        label: "Enforcement level",
        type: "select",
        default: "strict",
        options: [
          { value: "strict", label: "Strict" },
          { value: "loose", label: "Loose" },
        ],
      },
      { key: "requireTddEvidence", label: "Require TDD evidence", type: "toggle", default: true },
    ],
  },

  "npm:@plannotator/pi-extension": {
    source: "npm:@plannotator/pi-extension",
    name: "@plannotator/pi-extension",
    summary: "Interactive plan review with annotations; annotate messages and review code/PRs.",
    docs: "https://pi.dev/packages",
    fields: [
      { key: "enableAnnotations", label: "Enable annotations", type: "toggle", default: true },
      {
        key: "reviewMode",
        label: "Review mode",
        type: "select",
        default: "interactive",
        options: [
          { value: "interactive", label: "Interactive" },
          { value: "batch", label: "Batch" },
        ],
      },
    ],
  },

  "npm:pi-landstrip": {
    source: "npm:pi-landstrip",
    name: "pi-landstrip",
    summary: "Landlock-based OS sandboxing with interactive permission prompts.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "sandboxMode",
        label: "Sandbox mode",
        type: "select",
        default: "prompt",
        options: [
          { value: "prompt", label: "Prompt per action" },
          { value: "auto", label: "Auto-deny unknown" },
        ],
      },
      { key: "requireConfirm", label: "Require confirmation", type: "toggle", default: true },
    ],
  },

  "npm:pi-agent-browser-native": {
    source: "npm:pi-agent-browser-native",
    name: "pi-agent-browser-native",
    summary: "Browser automation exposed as a native tool for UI end-to-end checks.",
    docs: "https://pi.dev/packages",
    fields: [
      { key: "headless", label: "Run headless", type: "toggle", default: true },
      {
        key: "viewport",
        label: "Viewport preset",
        type: "select",
        default: "desktop",
        options: [
          { value: "desktop", label: "Desktop (1280x800)" },
          { value: "mobile", label: "Mobile (390x844)" },
        ],
      },
    ],
  },

  "npm:superpowers-zh": {
    source: "npm:superpowers-zh",
    name: "superpowers-zh",
    summary:
      "Chinese engineering-methodology skill set (full superpowers translation + 4 CN skills).",
    docs: "https://pi.dev/packages",
    fields: [{ key: "enableSkills", label: "Enable skills", type: "toggle", default: true }],
  },

  "npm:@raindrop-ai/pi-agent": {
    source: "npm:@raindrop-ai/pi-agent",
    name: "@raindrop-ai/pi-agent",
    summary: "Observability tracing for sessions, turns, LLM calls and tool executions.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "traceLevel",
        label: "Trace level",
        type: "select",
        default: "call",
        options: [
          { value: "session", label: "Session" },
          { value: "turn", label: "Turn" },
          { value: "call", label: "LLM call + tool" },
        ],
      },
      { key: "exportTraces", label: "Export traces", type: "toggle", default: true },
    ],
  },

  "npm:@gotgenes/pi-permission-system": {
    source: "npm:@gotgenes/pi-permission-system",
    name: "@gotgenes/pi-permission-system",
    summary: "Declarative tool-level permission enforcement (allow/deny/ask).",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "defaultPolicy",
        label: "Default policy",
        type: "select",
        default: "ask",
        options: [
          { value: "ask", label: "Ask" },
          { value: "allow", label: "Allow" },
          { value: "deny", label: "Deny" },
        ],
      },
      {
        key: "rules",
        label: "Permission rules",
        type: "list",
        default: [] as string[],
        placeholder: "allow:Read, deny:Bash(rm -rf *)",
        help: "One allow/deny/ask rule per line.",
      },
    ],
  },

  "npm:latchkey": {
    source: "npm:latchkey",
    name: "latchkey",
    summary: "Inject API credentials into requests without hardcoding secrets.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "credentialSource",
        label: "Credential source",
        type: "text",
        default: "",
        placeholder: "env:API_KEY or ~/.latchkey.json",
      },
      {
        key: "injectMode",
        label: "Inject mode",
        type: "select",
        default: "header",
        options: [
          { value: "header", label: "Header" },
          { value: "query", label: "Query param" },
        ],
      },
    ],
  },

  "npm:@ayulab/pi-rewind": {
    source: "npm:@ayulab/pi-rewind",
    name: "@ayulab/pi-rewind",
    summary: "/rewind checkpoint navigation for fast agent-side rollbacks.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "maxCheckpoints",
        label: "Max checkpoints",
        type: "number",
        default: 20,
        min: 1,
        max: 200,
        step: 1,
      },
      { key: "autoCheckpoint", label: "Auto-checkpoint per turn", type: "toggle", default: true },
    ],
  },

  "npm:@dietrichgebert/ponytail": {
    source: "npm:@dietrichgebert/ponytail",
    name: "@dietrichgebert/ponytail",
    summary: "Lazy senior-dev discipline — prefer reuse and deletion over new code.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "disciplineLevel",
        label: "Discipline level",
        type: "select",
        default: "lazy",
        options: [
          { value: "lazy", label: "Lazy (reuse first)" },
          { value: "balanced", label: "Balanced" },
        ],
      },
      { key: "warnOnNewCode", label: "Warn before new code", type: "toggle", default: true },
    ],
  },

  "npm:pi-caveman": {
    source: "npm:pi-caveman",
    name: "pi-caveman",
    summary: "Caveman mode — cuts ~75% of OUTPUT tokens via terse prose, keeps technical accuracy.",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "mode",
        label: "Caveman mode",
        type: "select",
        default: "lite",
        options: [
          { value: "lite", label: "Lite" },
          { value: "full", label: "Full" },
          { value: "ultra", label: "Ultra" },
          { value: "wenyan", label: "Wenyan (classical Chinese)" },
          { value: "micro", label: "Micro" },
        ],
        storage: "plugin",
        help: "Persisted to the plugin's own caveman.json config path.",
      },
    ],
  },
};

export function getPluginConfigDescriptor(source: string): PluginConfigDescriptor | undefined {
  const trimmed = source.trim();
  return (
    PLUGIN_CONFIG_DESCRIPTORS[trimmed] ??
    PLUGIN_CONFIG_DESCRIPTORS[`npm:${trimmed.replace(/^npm:/, "")}`]
  );
}

/** Merge stored values with descriptor defaults. */
export function applyDefaults(
  descriptor: PluginConfigDescriptor,
  stored: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const field of descriptor.fields) {
    const v = stored?.[field.key];
    if (v === undefined || v === null) {
      out[field.key] = field.default;
    } else {
      out[field.key] = v as string | number | boolean | string[];
    }
  }
  return out;
}
