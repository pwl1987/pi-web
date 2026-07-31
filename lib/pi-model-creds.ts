// 默认模型凭证解析 —— 供 optimize / compress / select 共用的 SDK 解析逻辑。
//
// 抽取自 app/api/agents-md/optimize/route.ts，避免各处重复实现默认
// provider/model + apiKey/headers 的解析。服务侧使用（依赖 SDK）。

import { getPiAdapter } from "@/lib/pi";
import { getAgentDir } from "@/lib/config-file";

/** 解析出的默认模型凭证。model 透传给 completeSimple。 */
export interface ModelCredentials {
  model: unknown;
  apiKey: string;
  headers: Record<string, string>;
  provider: string;
  modelId: string;
}

/** 解析当前默认 provider/model 及其 apiKey/headers（cwd 可选，用于 project 作用域）。 */
export async function resolveDefaultModelCredentials(cwd?: string): Promise<ModelCredentials> {
  const { AuthStorage, ModelRegistry, SettingsManager } = getPiAdapter();
  const agentDir = getAgentDir();
  const mgr = SettingsManager.create(cwd ?? process.cwd(), agentDir);
  await mgr.reload();
  const defaultProvider = mgr.getDefaultProvider();
  const defaultModel = mgr.getDefaultModel();
  if (!defaultProvider || !defaultModel) {
    throw new Error("No default model configured. Set one in Settings.");
  }

  const modelsPath = `${agentDir}/models.json`;
  const registry = ModelRegistry.create(AuthStorage.create(), modelsPath);
  const model = registry.find(defaultProvider, defaultModel);
  if (!model) throw new Error(`Model not found: ${defaultProvider}/${defaultModel}`);

  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);
  if (!auth.apiKey) throw new Error(`No API key for "${defaultProvider}"`);

  return {
    model,
    apiKey: auth.apiKey,
    headers: auth.headers ?? {},
    provider: defaultProvider,
    modelId: defaultModel,
  };
}
