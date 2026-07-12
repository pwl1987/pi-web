// 真实 LLM 后端 —— 把 completeSimple 适配为编排器所需的 LlmCompletion。
// 仅服务端（API 路由）使用；SDK 经 pi-sdk-adapter 单点导入，满足 anti-corruption 约束。

import { getPiAdapter } from "@/lib/pi";
import { getAssistantText } from "@/lib/api-shared";
import type { LlmCompletion } from "./runner.ts";

// 解析默认模型与鉴权（镜像 app/api/agent/enhance 的逻辑）。
async function resolveModelAndAuth(cwd?: string) {
  const { AuthStorage, ModelRegistry, SettingsManager, getAgentDir, completeSimple } =
    getPiAdapter();
  const agentDir = getAgentDir();
  const modelsPath = `${agentDir}/models.json`;
  const registry = ModelRegistry.create(AuthStorage.create(), modelsPath);

  let model: ReturnType<typeof registry.find> | undefined;
  const mgr = SettingsManager.create(cwd ?? process.cwd(), agentDir);
  await mgr.reload();
  const dp = mgr.getDefaultProvider();
  const dm = mgr.getDefaultModel();
  if (dp && dm) model = registry.find(dp, dm);
  if (!model) return undefined;

  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) return undefined;
  return { model, apiKey: auth.apiKey, headers: auth.headers, completeSimple };
}

/** 构造一个绑定到指定 cwd 的 LlmCompletion（每次调用解析模型与鉴权）。 */
export function createPiLlmCompletion(cwd?: string): LlmCompletion {
  return async (systemPrompt: string, userMessage: string): Promise<string> => {
    const resolved = await resolveModelAndAuth(cwd);
    if (!resolved) throw new Error("无可用的默认模型或未配置 API Key");
    const { model, apiKey, headers, completeSimple } = resolved;
    const message = await completeSimple(
      model,
      {
        systemPrompt,
        messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
      },
      {
        apiKey,
        headers,
        maxTokens: 4096,
        timeoutMs: 90_000,
        maxRetries: 0,
        cacheRetention: "none",
      } as Parameters<typeof completeSimple>[2],
    );
    return getAssistantText(message);
  };
}
