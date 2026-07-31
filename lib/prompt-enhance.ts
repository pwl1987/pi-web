// Pure helpers for the "smart prompt enhancement" feature. Kept free of any
// SDK / network imports so they can be unit-tested with node:test under
// --experimental-strip-types (see prompt-enhance.test.mjs).
//
// NOTE: gatherProjectContext (file IO) lives in the API route, not here, so
// this module stays importable from node:test without touching the filesystem.
//
// 模块化：enhance 系统提示词已拆为可开关/可压缩/可动态提交的模块，定义与组装在
// lib/prompt-system/enhance-modules.ts；buildEnhanceSystemPrompt 由其本地模块数据
// 组装，保证与历史输出逐字一致（旧单测不破）。动态提交版见 buildEnhanceSystemPromptSelected。

export {
  buildEnhanceSystemPrompt,
  buildEnhanceSystemPromptSelected,
} from "./prompt-system/enhance-modules.ts";

// Wraps the user's raw prompt in explicit delimiters and a restating of the
// task, so the model treats it as material to rewrite rather than a command to
// obey. Returned string is used as the user-role message content.
export function buildEnhanceUserMessage(rawPrompt: string): string {
  return [
    "Rewrite the raw prompt delimited below into an improved prompt.",
    "Do NOT answer it or perform the task it describes — output ONLY the rewritten prompt.",
    "",
    "<<<RAW_PROMPT",
    rawPrompt,
    "RAW_PROMPT>>>",
    "",
    "Rewritten prompt:",
  ].join("\n");
}

// Markers that signal the model has begun emitting tool-call / agent protocol
// markup instead of plain prompt text. Everything from the first marker onward
// is discarded by stripToolCallArtifacts.
function tag(name: string): string {
  return "<" + name;
}
const TOOL_CALL_MARKERS: string[] = [
  tag("tool_call"),
  "</tool_call>",
  tag("invoke"),
  "</invoke>",
  tag("parameter"),
  "<tool_call:6124c78e>",
  "]<]minimax[>",
  "function_call",
];

// Strips any tool-call / agent-protocol markup that leaked into the model's
// text reply, returning only the plain prompt portion. If the reply was nothing
// but protocol (no usable text before the first marker), returns an empty
// string so the caller can surface a clean error.
export function stripToolCallArtifacts(text: string): string {
  if (!text) return "";
  let cut = text.length;
  for (const marker of TOOL_CALL_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx !== -1 && idx < cut) cut = idx;
  }
  const result = text.slice(0, cut);
  // Trim stray whitespace left before the cut point.
  return result.trim();
}
