// 约束系统入口：单例引擎 + 上下文构建 + 绑定真实状态源 + 对外 API。
//
// 引擎挂在 globalThis 上，跨 Next.js 热重载保留约束状态（与 agent-runtime-store 同思路）。
// 本文件在浏览器侧把约束引擎与「语言状态源」「智能体运行时状态源」双向绑定：
//   - i18n 切换语言 → emit("locale:changed") → 相关约束重算 → UI 实时更新
//   - 运行时状态变化 → emit("runtime:changed") → 相关约束重算
// 业务代码可调用 reportUserStatus() 主动投递领域事件，触发对应约束实时校验。

import { ConstraintEngine } from "./engine";
import type { ConstraintContext, Locale } from "./types";
import { en as enDict } from "@/lib/i18n/en";
import { zh as zhDict } from "@/lib/i18n/zh";
import { getSnapshot as getLocale, subscribe as subscribeLocale } from "@/lib/i18n";
import { getAgentRuntimeStore } from "@/lib/agent-runtime-store";
import { registerLocalizationConstraints } from "./localization";

function buildContext(): ConstraintContext {
  let locale: Locale = "en";
  try {
    locale = getLocale();
  } catch {
    // SSR / 无 DOM 环境：默认 en
  }
  let runtime: unknown = null;
  try {
    runtime = getAgentRuntimeStore().getRuntimeSnapshot();
  } catch {
    // 运行时不可用时留空，不影响与 locale/i18n 相关的约束
  }
  return {
    locale,
    i18n: {
      en: enDict as Record<string, string>,
      zh: zhDict as Record<string, string>,
    },
    runtime,
  };
}

declare global {
  var __piConstraintEngine: ConstraintEngine | undefined;
}

export function getConstraintEngine(): ConstraintEngine {
  if (!globalThis.__piConstraintEngine) {
    const engine = new ConstraintEngine(buildContext);
    registerLocalizationConstraints(engine);
    globalThis.__piConstraintEngine = engine;

    // 客户端：绑定实时状态源，使约束随运行时状态联动。
    if (typeof window !== "undefined") {
      subscribeLocale(() => engine.emit("locale:changed"));
      try {
        getAgentRuntimeStore().subscribe(() => engine.emit("runtime:changed"));
      } catch {
        // 忽略：非客户端环境下运行时 store 不可订阅
      }
    }

    // 启动时全量校验一次，建立初始 findings。
    engine.evaluateAll();
  }
  return globalThis.__piConstraintEngine;
}

/**
 * 业务代码上报一条「用户可见状态文案」→ 触发 status:reported 事件 →
 * 约束实时校验（中文语境下检测是否含未翻译英文）。这是「业务状态 → 约束」联动的入口。
 */
export function reportUserStatus(status: string): void {
  getConstraintEngine().emit("status:reported", { status });
}

export * from "./types";
export { ConstraintEngine, evaluateRule } from "./engine";
