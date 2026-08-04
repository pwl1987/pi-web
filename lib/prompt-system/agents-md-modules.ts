// AGENTS.md / SYSTEM.md 模块化 —— 把 coding-agent 系统提示词按 Markdown 标题
// 分段为可开关、可压缩、可动态提交的模块，并提供「按任务裁剪」的拼接。
//
// 本模块刻意 @/-free（仅相对导入 ./types、./switches、./select，以及 node 内置
// fs/path/os），以便纯 node:test 直接 import 与单测。文件读取用内联 getAgentDir，
// 与 lib/config-file.getAgentDir 一致。

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { PromptModule, PromptCategory } from "./types";
import { isModuleActive, effectiveText } from "./switches";
import { selectModules } from "./select";

function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

/** 把标题转为模块 id 片段。 */
function slugify(heading: string): string {
  const s = heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return s || "section";
}

/** 由标题与正文推断分类（用于分组展示与选择权重）。 */
export function inferCategory(heading: string, text: string): PromptCategory {
  const h = ` ${heading.toLowerCase()} `;
  const t = ` ${text.toLowerCase()} `;
  if (/安全|security|safe/.test(h)) return "safety";
  if (/本地化|localiz|中文|chinese|i18n|翻译/.test(h)) return "localization";
  if (/约束|constraint|规则|rule|限制|limit/.test(h)) return "constraints";
  if (/格式|format|输出|output|结构/.test(h)) return "output-format";
  if (/语气|tone|风格|style/.test(h)) return "tone";
  if (/上下文|context|项目|project|背景|仓库/.test(h)) return "grounding";
  if (/示例|example|样例/.test(h)) return "examples";
  if (/身份|identity|你是|角色|role|persona/.test(h)) return "identity";
  if (/安全|安全|禁止|forbid|do not/.test(t)) return "safety";
  return "other";
}

/** 把一段 AGENTS.md 内容解析为按标题分段的模块列表。 */
export function parseAgentsMd(content: string): PromptModule[] {
  const lines = content.split(/\r?\n/);
  const modules: PromptModule[] = [];
  const preamble: string[] = [];
  let current: { heading: string; body: string[] } | null = null;

  const flush = () => {
    if (current) {
      const body = current.body.join("\n").replace(/^\n+|\n+$/g, "");
      modules.push(makeModule(current.heading, body));
      current = null;
    }
  };

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (m) {
      flush();
      current = { heading: m[2].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  flush();

  const pre = preamble.join("\n").replace(/^\n+|\n+$/g, "");
  if (pre) modules.unshift(makeModule("(前言)", pre));

  // 归一化 id，避免标题重复冲突。
  const seen = new Map<string, number>();
  for (const mod of modules) {
    const base = slugify(mod.heading ?? "section");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    mod.id = n === 0 ? `agents-md.${base}` : `agents-md.${base}-${n}`;
  }
  return modules;
}

function makeModule(heading: string, body: string): PromptModule {
  return {
    id: `agents-md.${slugify(heading)}`,
    source: "agents-md",
    category: inferCategory(heading, body),
    tags: [slugify(heading)],
    heading,
    text: body,
  };
}

/** 把模块列表反向序列化为 AGENTS.md 内容（用于写回/预览）。 */
export function serializeModules(modules: PromptModule[]): string {
  return modules
    .map((m) => {
      const heading = m.heading && m.heading !== "(前言)" ? `# ${m.heading}` : "";
      const body = (m.text || "").trim();
      return heading ? `${heading}\n\n${body}` : body;
    })
    .filter(Boolean)
    .join("\n\n");
}

/** 选项：来源内容（直接给文本）或读取文件。 */
export interface ComposeAgentsMdOptions {
  /** 已读取的 AGENTS.md 内容；若提供则不再读盘。 */
  content?: string;
  /** 当前用户输入，用于动态提交策略筛选。 */
  userInput?: string;
  /** 上下文。 */
  context?: string;
  /** 临时覆盖开关。 */
  enabledOverride?: Record<string, boolean>;
}

/**
 * 把 AGENTS.md 内容按模块裁剪：开关过滤 → 按需选择 → 拼接有效文本。
 * 无 userInput 时全量（仅受开关影响），保语义；有 userInput 时按相关度筛选。
 */
export function composeAgentsMd(content: string, opts: ComposeAgentsMdOptions = {}): string {
  const modules = parseAgentsMd(content);
  const candidates = modules.filter((m) => isModuleActive(m, opts.enabledOverride));
  const selection = selectModules(candidates, { userInput: opts.userInput, context: opts.context });
  return selection.selected
    .map((m) => effectiveText(m))
    .filter(Boolean)
    .join("\n\n");
}

/** 读取 user 级与 project 级 AGENTS.md 并合并（与 SDK 注入一致）。 */
export function readAgentsMdContent(cwd?: string): string {
  const parts: string[] = [];
  const userPath = join(getAgentDir(), "AGENTS.md");
  if (existsSync(userPath)) {
    try {
      parts.push(readFileSync(userPath, "utf8"));
    } catch {
      /* 忽略 */
    }
  }
  if (cwd) {
    const projPath = join(cwd, "AGENTS.md");
    const projPiPath = join(cwd, ".pi", "AGENTS.md");
    for (const p of [projPath, projPiPath]) {
      if (existsSync(p)) {
        try {
          parts.push(readFileSync(p, "utf8"));
        } catch {
          /* 忽略 */
        }
        break;
      }
    }
  }
  return parts.join("\n\n").trim();
}
