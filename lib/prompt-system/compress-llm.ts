// LLM 语义压缩通道 —— 复用默认模型/Key（与 app/api/agents-md/optimize 同范式）。
//
// 服务侧使用（依赖 SDK，经 @/lib/pi）。纯逻辑压缩在 compress.ts，本文件仅负责
// 「可选 LLM 精炼」并在失败时兜底回退离线，绝不阻断主流程。

import { getPiAdapter } from "@/lib/pi";
import { getAssistantText } from "@/lib/api-shared";
import { resolveDefaultModelCredentials, type ModelCredentials } from "../pi-model-creds";
import { compressOffline } from "./compress";
import type { CompressResult } from "./types";

const TIMEOUT_MS = 60_000;

/** 用 LLM 对一段提示词做语义保持压缩。 */
export async function compressWithLlm(
  text: string,
  creds: ModelCredentials,
): Promise<CompressResult> {
  const { completeSimple } = getPiAdapter();
  const systemPrompt = [
    "You are a prompt compression engine.",
    "Rewrite the following system-prompt excerpt to be as concise as possible while preserving EVERY hard constraint, rule, and prohibited/required behavior verbatim in meaning.",
    "Remove filler, redundancy, and verbose framing, but do NOT drop or weaken any instruction, constraint, or safety rule.",
    "Respond with ONLY the compressed text. No explanation, no code fences around the whole thing.",
  ].join("\n");

  const message = await completeSimple(
    creds.model as Parameters<typeof completeSimple>[0],
    {
      messages: [{ role: "user", content: text, timestamp: Date.now() }],
    } as Parameters<typeof completeSimple>[1],
    {
      apiKey: creds.apiKey,
      headers: creds.headers,
      maxTokens: 8192,
      timeoutMs: TIMEOUT_MS,
      maxRetries: 0,
      cacheRetention: "none",
      systemPrompt,
    } as Parameters<typeof completeSimple>[2],
  );

  const compressed = getAssistantText(message).trim();
  const before = text.length;
  const after = compressed.length;
  return {
    text: compressed,
    charsBefore: before,
    charsAfter: after,
    ratio: before > 0 ? (before - after) / before : 0,
    usedLlm: true,
  };
}

/**
 * 压缩单个模块文本：默认离线（零成本），useLlm 时走 LLM 语义压缩。
 * 任何 LLM 失败（无默认模型/无 Key/超时/空响应）一律兜底回退离线压缩。
 */
export async function compressModule(
  text: string,
  opts: { useLlm?: boolean; creds?: ModelCredentials; cwd?: string } = {},
): Promise<CompressResult> {
  if (!opts.useLlm) return compressOffline(text);
  try {
    const creds = opts.creds ?? (await resolveDefaultModelCredentials(opts.cwd));
    const result = await compressWithLlm(text, creds);
    if (!result.text) return compressOffline(text);
    return result;
  } catch {
    return compressOffline(text);
  }
}
