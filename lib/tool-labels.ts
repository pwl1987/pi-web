/**
 * Localized names and descriptions for known tools.
 *
 * Built-in pi tools always have exact translations. Common extension tools
 * (hypa_*, web_search, mcp, subagent, etc.) are translated too. Unknown tools
 * fall back to their English SDK description — the UI calls `describeTool()`
 * which returns "" when there is no translation, and the caller keeps the
 * original English text.
 *
 * Keys are tool names; values are { name?, description? } in zh-CN. Missing
 * fields mean "no translation available — keep the English".
 */

export interface ToolLabel {
  name?: string;
  description?: string;
}

/** Chinese (zh-CN) labels for known tools. English is the implicit default. */
export const TOOL_LABELS_ZH: Record<string, ToolLabel> = {
  // --- Built-in coding tools ---
  read: {
    description:
      "读取文件内容。支持文本和图片（jpg/png/gif/webp/bmp）。文本文件截断到 2000 行或 50KB，大文件用 offset/limit 分段读取。",
  },
  bash: {
    description:
      "在当前工作目录执行 bash 命令，返回 stdout 和 stderr。输出截断到最后 2000 行或 50KB。",
  },
  edit: {
    description:
      "用精确文本替换编辑单个文件。每次替换必须唯一匹配、不重叠，用尽可能小的上下文定位改动。",
  },
  write: {
    description: "写入文件。不存在则创建，存在则覆盖。自动创建父目录。",
  },
  grep: {
    description: "按模式搜索文件内容，返回匹配的行及文件路径和行号。",
  },
  find: {
    description: "按 glob 模式查找文件，返回匹配的文件路径。",
  },
  ls: {
    description: "列出目录内容，按字母排序返回条目。",
  },

  // --- pi-web-access ---
  web_search: {
    description: "使用 OpenAI、Brave、Parallel、Tavily、Exa、Perplexity 等搜索网页。",
  },
  fetch_content: {
    description: "抓取 URL 并提取可读内容为 Markdown，支持 YouTube 视频理解。",
  },
  get_search_content: {
    description: "从之前的 web_search 或 fetch_content 结果中获取完整内容。",
  },

  // --- pi-mcp-adapter ---
  mcp: {
    description: "MCP 网关——连接 MCP server 并调用其工具。",
  },

  // --- pi-subagents ---
  subagent: {
    description: "委派任务给子代理，或管理代理定义。支持链式/并行执行。",
  },
  subagent_supervisor: {
    description: "pi-subagents 原生监督通道。用 reply/pending/status 管理子代理。",
  },
  intercom: {
    description: "pi-subagents 原生监督通道。用 reply/pending/status 管理子代理。",
  },
  wait: {
    description: "阻塞等待本会话启动的后台（异步）子代理运行完成。",
  },

  // --- @juicesharp/rpiv-ask-user-question ---
  ask_user_question: {
    description: "在执行过程中向用户提出一组结构化问题，而不是猜测。",
  },

  // --- @juicesharp/rpiv-todo ---
  todo: {
    description: "管理用于跟踪多步骤进度的待办列表。支持添加/更新/完成操作。",
  },
};

/**
 * Return the localized label for a tool name in the given locale.
 * Falls back to {} (no translation) when the locale is not "zh" or the tool
 * is unknown — callers keep the English SDK text in that case.
 */
export function getToolLabel(name: string, locale: string): ToolLabel {
  if (locale === "zh") return TOOL_LABELS_ZH[name] ?? {};
  return {};
}
