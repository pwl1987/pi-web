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
      "压缩已组装的上下文窗口（沙箱执行、FTS5 知识库、意图驱动检索），最高节省 98% 的 token。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "启用 context-mode",
        type: "toggle",
        default: true,
        help: "总开关。关闭后使用原始上下文窗口。",
      },
      {
        key: "compressionLevel",
        label: "压缩级别",
        type: "select",
        default: "balanced",
        options: [
          { value: "off", label: "关闭", description: "不压缩" },
          { value: "light", label: "轻度", description: "保守裁剪" },
          { value: "balanced", label: "均衡", description: "推荐默认值" },
          { value: "aggressive", label: "激进", description: "最大节省，丢失细节风险更高" },
        ],
        help: "级别越高节省越多，但可能丢失支撑性细节。",
      },
      {
        key: "sandboxExecution",
        label: "沙箱化代码执行",
        type: "toggle",
        default: true,
        help: "在沙箱中运行压缩辅助程序，避免对宿主产生副作用。",
      },
      {
        key: "knowledgeBase",
        label: "FTS5 知识库",
        type: "toggle",
        default: true,
        help: "维护代码库的全文索引以支持意图驱动检索。",
      },
    ],
  },

  // --- @hypabolic/pi-hypa: deterministic context compression -------------
  "npm:@hypabolic/pi-hypa": {
    source: "npm:@hypabolic/pi-hypa",
    name: "@hypabolic/pi-hypa",
    summary:
      "确定性上下文压缩：通过 Hypa 重写 shell 命令、上下文感知文件工具与可恢复证据。与 context-mode/pi-rtk 互补。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "启用 Hypa 压缩",
        type: "toggle",
        default: true,
        help: "shell 命令重写与文件工具压缩的总开关。",
      },
      {
        key: "bridgeMode",
        label: "MCP 桥接",
        type: "select",
        default: "on",
        options: [
          { value: "on", label: "开启", description: "为未变更的重复读取保持会话缓存" },
          { value: "off", label: "关闭", description: "无跨调用缓存" },
        ],
        help: "内嵌 MCP 桥维护滚动缓存，使未变更的重复读取仅耗约 13 token。",
      },
      {
        key: "recoverableEvidence",
        label: "保留可恢复证据",
        type: "toggle",
        default: true,
        help: "存储压缩产物，使编辑保持可回滚。",
      },
    ],
  },

  // --- pi-rtk: tool-output token reduction -------------------------------
  "npm:pi-rtk": {
    source: "npm:pi-rtk",
    name: "pi-rtk",
    summary: "智能过滤原始工具输出（减少 60-90%）后再进入上下文。与 context-mode 互补。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "启用 pi-rtk",
        type: "toggle",
        default: true,
      },
      {
        key: "filterLevel",
        label: "过滤级别",
        type: "select",
        default: "balanced",
        options: [
          { value: "conservative", label: "保守" },
          { value: "balanced", label: "均衡" },
          { value: "aggressive", label: "激进" },
        ],
      },
      {
        key: "maxOutputTokens",
        label: "保留的最大输出 token 数",
        type: "number",
        default: 2000,
        min: 256,
        max: 32000,
        step: 256,
        help: "单个工具结果保留 token 的硬上限。",
      },
    ],
  },

  // --- cc-safety-net: pre-execution guardrails ---------------------------
  "npm:cc-safety-net": {
    source: "npm:cc-safety-net",
    name: "cc-safety-net",
    summary: "在破坏性 git 与文件系统命令（force push、hard reset、rm -rf 等）执行前拦截。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "blockDestructiveGit",
        label: "拦截破坏性 git 命令",
        type: "toggle",
        default: true,
        help: "拦截 push --force、reset --hard、checkout .、clean -f 等。",
      },
      {
        key: "blockDestructiveFs",
        label: "拦截破坏性文件系统命令",
        type: "toggle",
        default: true,
        help: "拦截 rm -rf、对重要路径的 > 覆盖、chmod 000 等。",
      },
      {
        key: "requireConfirm",
        label: "需要确认",
        type: "toggle",
        default: true,
        help: "放行被标记但允许的命令前先弹窗确认。",
      },
      {
        key: "allowlist",
        label: "允许的命令模式",
        type: "list",
        default: [] as string[],
        placeholder: "git reset --soft, git stash",
        help: "逗号分隔的命令模式，始终放行（绕过拦截）。",
      },
    ],
  },

  // --- pi-subagents: delegation core -------------------------------------
  "npm:pi-subagents": {
    source: "npm:pi-subagents",
    name: "pi-subagents",
    summary: "将任务委派给子智能体，支持链式与并行执行。子智能体面板依赖此插件。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "maxParallel",
        label: "最大并行子智能体数",
        type: "number",
        default: 4,
        min: 1,
        max: 32,
        step: 1,
        help: "同时运行的子智能体数量上限。",
      },
      {
        key: "enableTui",
        label: "启用 TUI 澄清",
        type: "toggle",
        default: false,
        help: "允许子智能体暂停以进行交互式澄清。",
      },
    ],
  },

  // --- @juicesharp/rpiv-todo: live todo overlay --------------------------
  "npm:@juicesharp/rpiv-todo": {
    source: "npm:@juicesharp/rpiv-todo",
    name: "@juicesharp/rpiv-todo",
    summary: "为模型提供的待办清单，以实时浮层渲染，可跨 /reload 与对话压缩存活。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "showOverlay",
        label: "显示实时浮层",
        type: "toggle",
        default: true,
        help: "运行期间在聊天中内联渲染待办清单。",
      },
      {
        key: "surviveCompaction",
        label: "跨压缩存活",
        type: "toggle",
        default: true,
        help: "上下文压缩后仍保留待办清单。",
      },
    ],
  },

  // --- Gap-filling / performance / DX recommendations (task 1) -----------
  "npm:pi-lean-ctx": {
    source: "npm:pi-lean-ctx",
    name: "pi-lean-ctx",
    summary:
      "将 bash/read/grep/find/ls 路由到精简通道，使未变更的重复读取仅耗约 13 token，而非整个文件。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "启用 lean-ctx",
        type: "toggle",
        default: true,
      },
      {
        key: "mode",
        label: "模式",
        type: "select",
        default: "lean",
        options: [
          { value: "lean", label: "精简", description: "将重复读取压缩到最小 token 占用" },
          { value: "full", label: "完整", description: "始终返回完整工具输出" },
        ],
        help: "精简模式维护最近读取文件的滚动缓存。",
      },
    ],
  },

  "npm:@ff-labs/pi-fff": {
    source: "npm:@ff-labs/pi-fff",
    name: "@ff-labs/pi-fff",
    summary: "跨代码库的模糊全文检索，减少 grep 噪声与 token 浪费。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "启用模糊检索",
        type: "toggle",
        default: true,
      },
      {
        key: "scope",
        label: "检索范围",
        type: "select",
        default: "repo",
        options: [
          { value: "repo", label: "整个仓库" },
          { value: "openFiles", label: "仅打开的文件" },
        ],
      },
    ],
  },

  "npm:pi-readseek": {
    source: "npm:pi-readseek",
    name: "pi-readseek",
    summary: "哈希锚定的精确读取——指向文件的精确区域，无需将整个文件灌入上下文。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "启用 readseek",
        type: "toggle",
        default: true,
      },
      {
        key: "anchorPrecision",
        label: "锚定精度",
        type: "select",
        default: "line",
        options: [
          { value: "line", label: "行号" },
          { value: "hash", label: "内容哈希" },
        ],
        help: "哈希锚定对附近编辑更稳健，但开销略高。",
      },
    ],
  },

  "npm:pi-hashline-edit-pro": {
    source: "npm:pi-hashline-edit-pro",
    name: "pi-hashline-edit-pro",
    summary: "哈希锚定的精确编辑——按内容哈希应用变更，减少往返次数、生成更安全的 diff。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "启用 hashline-edit",
        type: "toggle",
        default: true,
      },
      {
        key: "createBackups",
        label: "编辑前创建备份",
        type: "toggle",
        default: true,
        help: "修改前写入 .bak 备份，使编辑可回滚。",
      },
    ],
  },

  "npm:@braintrust/pi-extension": {
    source: "npm:@braintrust/pi-extension",
    name: "@braintrust/pi-extension",
    summary: "LLM 调用与工具执行的可观测性追踪，支持导出 trace。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enabled",
        label: "启用追踪",
        type: "toggle",
        default: true,
      },
      {
        key: "exportFormat",
        label: "导出格式",
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
    summary: "运行期间显示实时 token 用量与费用的状态栏。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "showTokenCount",
        label: "显示 token 计数",
        type: "toggle",
        default: true,
      },
      {
        key: "showCost",
        label: "显示费用估算",
        type: "toggle",
        default: true,
      },
    ],
  },

  // --- Remaining recommended plugins (full-catalog coverage) ------------
  // 为每个推荐插件提供独立的配置面板。值持久化到 plugins-config.json；
  // 若插件自管配置文件，描述符会标注实际生效的配置项。

  "npm:pi-search-hub": {
    source: "npm:pi-search-hub",
    name: "pi-search-hub",
    summary:
      "统一的网页搜索 + 内容提取，支持 19 个后端。内置免密选项（Firecrawl [免密]、SearXNG、DuckDuckGo、Jina Reader），无需 API key 即可搜索。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "defaultBackend",
        label: "默认搜索后端",
        type: "select",
        default: "firecrawl-keyless",
        help: "选择免密后端即可无需 API key 搜索。添加 key 后可用 Tavily、Brave、Exa、Perplexity 等需密后端。",
        options: [
          {
            value: "firecrawl-keyless",
            label: "Firecrawl（免密）",
            description: "免费，无需 API key",
          },
          { value: "duckduckgo", label: "DuckDuckGo", description: "免费，无需 API key" },
          { value: "searxng", label: "SearXNG", description: "自托管，无需 API key" },
          { value: "jina", label: "Jina Reader", description: "读取/提取页面，无需 API key" },
          { value: "tavily", label: "Tavily（需 key）" },
          { value: "brave", label: "Brave（需 key）" },
          { value: "exa", label: "Exa（需 key）" },
          { value: "perplexity", label: "Perplexity Sonar（需 key）" },
        ],
      },
      {
        key: "searxngUrl",
        label: "SearXNG 实例 URL",
        type: "text",
        default: "",
        placeholder: "https://searxng.example.com",
        help: "仅在 defaultBackend = searxng 时必填。",
      },
      {
        key: "enableExtraction",
        label: "启用内容提取",
        type: "toggle",
        default: true,
      },
      {
        key: "maxResults",
        label: "每次查询最大结果数",
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
    summary: "将智能体连接到任意 MCP 服务器的适配器。",
    docs: "https://pi.dev/packages",
    fields: [
      { key: "autoConnect", label: "启动时自动连接", type: "toggle", default: true },
      {
        key: "servers",
        label: "服务器条目",
        type: "list",
        default: [] as string[],
        placeholder: "npx -y @modelcontextprotocol/server-filesystem /path",
        help: "每行一条 MCP 服务器启动命令。",
      },
    ],
  },

  "npm:@juicesharp/rpiv-ask-user-question": {
    source: "npm:@juicesharp/rpiv-ask-user-question",
    name: "@juicesharp/rpiv-ask-user-question",
    summary: "模型可向你发起的结构化问卷（而非猜测），支持带类型的选项。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "maxOptions",
        label: "每题最大选项数",
        type: "number",
        default: 4,
        min: 2,
        max: 8,
        step: 1,
      },
      { key: "requireTyped", label: "要求打字回答", type: "toggle", default: false },
    ],
  },

  "npm:pi-lens": {
    source: "npm:pi-lens",
    name: "pi-lens",
    summary: "实时代码反馈——LSP、linter、formatter、类型检查与结构分析。",
    docs: "https://pi.dev/packages",
    fields: [
      { key: "enableLsp", label: "启用 LSP", type: "toggle", default: true },
      { key: "enableLinters", label: "启用 linter", type: "toggle", default: true },
      { key: "enableFormatters", label: "启用 formatter", type: "toggle", default: true },
      { key: "failOnError", label: "出错即失败", type: "toggle", default: false },
    ],
  },

  "npm:pi-simplify": {
    source: "npm:pi-simplify",
    name: "pi-simplify",
    summary: "审查近期变更的代码，关注清晰度、一致性与可维护性。",
    docs: "https://pi.dev/packages",
    fields: [
      { key: "autoReview", label: "变更时自动审查", type: "toggle", default: false },
      {
        key: "scope",
        label: "审查范围",
        type: "select",
        default: "changed",
        options: [
          { value: "changed", label: "变更文件" },
          { value: "all", label: "整个仓库" },
        ],
      },
    ],
  },

  "npm:pi-shazam": {
    source: "npm:pi-shazam",
    name: "pi-shazam",
    summary: "原生代码库感知工具包——7 个结构分析工具（同时兼容 MCP）。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enableStructural",
        label: "启用结构分析",
        type: "toggle",
        default: true,
      },
      { key: "enableMcp", label: "通过 MCP 暴露", type: "toggle", default: false },
    ],
  },

  "npm:pi-hermes-memory": {
    source: "npm:pi-hermes-memory",
    name: "pi-hermes-memory",
    summary: "持久化记忆 + 会话检索 + 密钥扫描（SQLite FTS5，368 项测试）。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "policyMode",
        label: "记忆策略",
        type: "select",
        default: "token-aware",
        options: [
          { value: "token-aware", label: "Token 感知（默认）" },
          { value: "full", label: "完整" },
        ],
      },
      { key: "enableSecretScan", label: "扫描密钥", type: "toggle", default: true },
      { key: "autoConsolidate", label: "自动整合记忆", type: "toggle", default: true },
    ],
  },

  "npm:@juicesharp/rpiv-advisor": {
    source: "npm:@juicesharp/rpiv-advisor",
    name: "@juicesharp/rpiv-advisor",
    summary: "智能体行动前可咨询的第二意见审查模型。",
    docs: "https://pi.dev/packages",
    fields: [
      { key: "autoRequest", label: "自动请求审查", type: "toggle", default: false },
      {
        key: "reviewerModel",
        label: "审查模型",
        type: "text",
        default: "",
        placeholder: "例如 gpt-4o",
      },
    ],
  },

  "npm:gentle-pi": {
    source: "npm:gentle-pi",
    name: "gentle-pi",
    summary: "资深架构师约束框架：SDD/OpenSpec、严格 TDD 证据、审查护栏。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "enforcement",
        label: "执行级别",
        type: "select",
        default: "strict",
        options: [
          { value: "strict", label: "严格" },
          { value: "loose", label: "宽松" },
        ],
      },
      { key: "requireTddEvidence", label: "要求 TDD 证据", type: "toggle", default: true },
    ],
  },

  "npm:@plannotator/pi-extension": {
    source: "npm:@plannotator/pi-extension",
    name: "@plannotator/pi-extension",
    summary: "带批注的交互式计划审查；可为消息添加批注、审查代码/PR。",
    docs: "https://pi.dev/packages",
    fields: [
      { key: "enableAnnotations", label: "启用批注", type: "toggle", default: true },
      {
        key: "reviewMode",
        label: "审查模式",
        type: "select",
        default: "interactive",
        options: [
          { value: "interactive", label: "交互式" },
          { value: "batch", label: "批量" },
        ],
      },
    ],
  },

  "npm:pi-landstrip": {
    source: "npm:pi-landstrip",
    name: "pi-landstrip",
    summary: "基于 Landlock 的操作系统沙箱，带交互式权限弹窗。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "sandboxMode",
        label: "沙箱模式",
        type: "select",
        default: "prompt",
        options: [
          { value: "prompt", label: "逐操作询问" },
          { value: "auto", label: "自动拒绝未知操作" },
        ],
      },
      { key: "requireConfirm", label: "需要确认", type: "toggle", default: true },
    ],
  },

  "npm:pi-agent-browser-native": {
    source: "npm:pi-agent-browser-native",
    name: "pi-agent-browser-native",
    summary: "将浏览器自动化暴露为原生工具，用于 UI 端到端检查。",
    docs: "https://pi.dev/packages",
    fields: [
      { key: "headless", label: "无头模式", type: "toggle", default: true },
      {
        key: "viewport",
        label: "视口预设",
        type: "select",
        default: "desktop",
        options: [
          { value: "desktop", label: "桌面（1280x800）" },
          { value: "mobile", label: "移动端（390x844）" },
        ],
      },
    ],
  },

  "npm:superpowers-zh": {
    source: "npm:superpowers-zh",
    name: "superpowers-zh",
    summary: "中文工程方法论技能集（完整 superpowers 翻译 + 4 个中文技能）。",
    docs: "https://pi.dev/packages",
    fields: [{ key: "enableSkills", label: "启用技能", type: "toggle", default: true }],
  },

  "npm:@raindrop-ai/pi-agent": {
    source: "npm:@raindrop-ai/pi-agent",
    name: "@raindrop-ai/pi-agent",
    summary: "会话、轮次、LLM 调用与工具执行的可观测性追踪。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "traceLevel",
        label: "追踪级别",
        type: "select",
        default: "call",
        options: [
          { value: "session", label: "会话级" },
          { value: "turn", label: "轮次级" },
          { value: "call", label: "LLM 调用 + 工具" },
        ],
      },
      { key: "exportTraces", label: "导出 trace", type: "toggle", default: true },
    ],
  },

  "npm:@gotgenes/pi-permission-system": {
    source: "npm:@gotgenes/pi-permission-system",
    name: "@gotgenes/pi-permission-system",
    summary: "声明式工具级权限管控（allow 放行 / deny 拒绝 / ask 询问）。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "yoloMode",
        label: "全放行模式（YOLO）",
        type: "toggle",
        default: false,
        storage: "plugin",
        help: "开启后，所有需要询问（ask）的工具调用自动放行，不再弹窗。显式声明为 deny 的危险操作仍被拦截。配置写入插件自管的 config.json。",
      },
      {
        key: "permissionReviewLog",
        label: "权限决策审计日志",
        type: "toggle",
        default: true,
        storage: "plugin",
        help: "记录每次权限决策（放行/拒绝/询问）到审计日志，便于事后追溯。",
      },
      {
        key: "debugLog",
        label: "调试日志",
        type: "toggle",
        default: false,
        storage: "plugin",
        help: "输出权限判定过程的详细调试信息，排查规则匹配问题时开启。",
      },
      {
        key: "toolInputPreviewMaxLength",
        label: "工具输入预览最大长度",
        type: "number",
        default: 200,
        min: 0,
        max: 2000,
        step: 10,
        storage: "plugin",
        help: "权限弹窗中内联 JSON 输入预览的最大字符数（默认 200）。",
      },
      {
        key: "toolTextSummaryMaxLength",
        label: "工具文本摘要最大长度",
        type: "number",
        default: 80,
        min: 0,
        max: 500,
        step: 10,
        storage: "plugin",
        help: "权限弹窗中 grep/find/ls 等命令的内联模式/路径摘要最大字符数（默认 80）。",
      },
    ],
  },

  "npm:latchkey": {
    source: "npm:latchkey",
    name: "latchkey",
    summary: "将 API 凭据注入请求，无需硬编码密钥。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "credentialSource",
        label: "凭据来源",
        type: "text",
        default: "",
        placeholder: "env:API_KEY 或 ~/.latchkey.json",
      },
      {
        key: "injectMode",
        label: "注入方式",
        type: "select",
        default: "header",
        options: [
          { value: "header", label: "请求头" },
          { value: "query", label: "查询参数" },
        ],
      },
    ],
  },

  "npm:@ayulab/pi-rewind": {
    source: "npm:@ayulab/pi-rewind",
    name: "@ayulab/pi-rewind",
    summary: "/rewind 检查点导航，支持智能体侧快速回滚。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "maxCheckpoints",
        label: "最大检查点数",
        type: "number",
        default: 20,
        min: 1,
        max: 200,
        step: 1,
      },
      { key: "autoCheckpoint", label: "每轮自动检查点", type: "toggle", default: true },
    ],
  },

  "npm:@dietrichgebert/ponytail": {
    source: "npm:@dietrichgebert/ponytail",
    name: "@dietrichgebert/ponytail",
    summary: "慵懒资深开发者纪律——优先复用与删除，而非新写代码。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "disciplineLevel",
        label: "纪律级别",
        type: "select",
        default: "lazy",
        options: [
          { value: "lazy", label: "慵懒（优先复用）" },
          { value: "balanced", label: "均衡" },
        ],
      },
      { key: "warnOnNewCode", label: "新写代码前警告", type: "toggle", default: true },
    ],
  },

  "npm:pi-caveman": {
    source: "npm:pi-caveman",
    name: "pi-caveman",
    summary: "穴居人模式——通过简短行文削减约 75% 输出 token，保持技术准确性。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "mode",
        label: "穴居人模式",
        type: "select",
        default: "lite",
        options: [
          { value: "lite", label: "轻度" },
          { value: "full", label: "完整" },
          { value: "ultra", label: "极致" },
          { value: "wenyan", label: "文言文" },
          { value: "micro", label: "微型" },
        ],
        storage: "plugin",
        help: "持久化到插件自管的 caveman.json 配置路径。",
      },
    ],
  },

  "npm:@heyhuynhgiabuu/pi-pretty": {
    source: "npm:@heyhuynhgiabuu/pi-pretty",
    name: "@heyhuynhgiabuu/pi-pretty",
    summary: "终端美化输出——语法高亮的文件读取、彩色 bash 输出、树形目录列表等。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "background.tool",
        label: "工具输出背景色",
        type: "text",
        default: "",
        placeholder: "#1e1e2e",
        storage: "plugin",
        help: "工具输出区域的背景色（hex 格式，如 #1e1e2e）。留空使用终端默认背景。",
      },
      {
        key: "background.error",
        label: "错误输出背景色",
        type: "text",
        default: "",
        placeholder: "#3b1e1e",
        storage: "plugin",
        help: "错误输出区域的背景色（hex 格式，如 #3b1e1e）。留空使用终端默认背景。",
      },
    ],
  },

  "npm:pi-web-access": {
    source: "npm:pi-web-access",
    name: "pi-web-access",
    summary:
      "网页搜索、URL 抓取、GitHub 仓库克隆、PDF 提取、YouTube 视频理解与本地视频分析。支持 OpenAI、Brave、Parallel、Tavily、Exa、Perplexity、Gemini。",
    docs: "https://pi.dev/packages",
    fields: [
      {
        key: "provider",
        label: "搜索后端",
        type: "select",
        default: "auto",
        storage: "plugin",
        help: "选择搜索 provider。auto 自动选用已配置 API key 的后端；其余需先配置对应 key。",
        options: [
          { value: "auto", label: "自动（auto）", description: "按可用性自动选择已配置密钥的后端" },
          { value: "openai", label: "OpenAI" },
          { value: "brave", label: "Brave" },
          { value: "parallel", label: "Parallel" },
          { value: "tavily", label: "Tavily" },
          { value: "exa", label: "Exa" },
          { value: "perplexity", label: "Perplexity" },
          { value: "gemini", label: "Gemini" },
        ],
      },
      {
        key: "curatorTimeoutSeconds",
        label: "curator 抓取超时（秒）",
        type: "number",
        default: 20,
        min: 1,
        max: 600,
        step: 5,
        storage: "plugin",
        help: "curator 页面抓取的超时时间（秒），范围 1-600，默认 20。",
      },
      {
        key: "workflow",
        label: "工作流模式",
        type: "select",
        default: "summary-review",
        storage: "plugin",
        help: "搜索结果的处理流程。",
        options: [
          { value: "summary-review", label: "摘要 + 审查", description: "生成摘要供审查后再采纳" },
          { value: "auto-summary", label: "自动摘要", description: "自动生成摘要并直接采纳" },
          { value: "none", label: "无", description: "不做摘要处理" },
        ],
      },
      {
        key: "summaryModel",
        label: "摘要模型",
        type: "text",
        default: "",
        placeholder: "例如 gpt-4o-mini",
        storage: "plugin",
        help: "用于生成搜索结果摘要的模型标识。留空使用会话当前模型。",
      },
      {
        key: "webSearch.enabled",
        label: "启用网页搜索",
        type: "toggle",
        default: true,
        storage: "plugin",
        help: "总开关。关闭后网页搜索工具不可用。",
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
