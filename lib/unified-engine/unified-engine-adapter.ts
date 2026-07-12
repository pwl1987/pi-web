// unified-engine-adapter.ts —— 编排层（组合两能力端口 + 运行时，实现 UnifiedEnginePort）
// 业务层只依赖 UnifiedEnginePort；本文件是组装点，确保适配层为唯一上游导入处。
import { getEngineRuntime, type EngineRuntime } from "./unified-engine-runtime";
import { getAutoPlanAdapter } from "./autoplan-adapter";
import { getCometAdapter } from "./comet-adapter";
import {
  registerUnifiedEngineAdapter,
  hasUnifiedEngineAdapter,
  type UnifiedEnginePort,
} from "./unified-engine-ports";

export { getUnifiedEngineAdapter } from "./unified-engine-ports";

export function createUnifiedEngineAdapter(): UnifiedEnginePort {
  const runtime = getEngineRuntime(getAutoPlanAdapter(), getCometAdapter());
  return {
    createChange: (input) => runtime.createChange(input),
    startRun: (runId) => runtime.startRun(runId),
    pauseRun: (runId) => runtime.pauseRun(runId),
    resumeRun: (runId) => runtime.resumeRun(runId),
    getRunState: async (runId) => runtime.getRunState(runId),
  };
}

/** 获取全局运行时单例（供 API 路由订阅事件 / 列举运行） */
export function getEngineRuntimeInstance(): EngineRuntime {
  return getEngineRuntime(getAutoPlanAdapter(), getCometAdapter());
}

/** 注册默认融合引擎（幂等） */
export function registerDefaultEngine(): void {
  if (hasUnifiedEngineAdapter()) return;
  registerUnifiedEngineAdapter(createUnifiedEngineAdapter());
}
