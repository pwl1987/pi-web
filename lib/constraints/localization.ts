// 中文本地化约束——把 AGENTS.md 里「中文本地化约束（强制）」这一静态约定变成
// 可被程序实时校验、随状态联动的活约束。
//
// 这是约束系统的一个具体落地示例，证明「文档里的规则」与「程序逻辑」深度联动：
// - i18n 字典键对齐：error 级，启动时 + i18n:reload 时校验（纯数据比较）。
// - 中文语境关键翻译完整：warn 级，locale 切换 / 字典变更时校验。
// - 中文语境禁止裸英文状态文案：error 级，由业务代码经 reportUserStatus() 投递
//   status:reported 事件触发（业务状态 → 约束 的正向联动）。
// - 语言必须在允许集合内：info 级，声明式 rule 示例（证明约束可被程序解析求值）。

import type { ConstraintEngine } from "./engine";

/** 启发式：判断一段文案是否为「未翻译的英文」（中文语境下出现即违反）。 */
export function isUntranslatedEnglish(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  // 含中文字符 → 已翻译。
  if (/[一-鿿]/.test(trimmed)) return false;
  // 含非 ASCII 可打印字符（如其他语言、emoji）→ 非英文，跳过。
  if (!/^[\x20-\x7E]+$/.test(trimmed)) return false;
  // 纯数字 / 符号不算未翻译英文。
  if (/^[\d\s.,:()[\]/%+\-]+$/.test(trimmed)) return false;
  // 至少包含两个连续 ASCII 字母才视为「英文词」。
  return (trimmed.match(/[A-Za-z]{2,}/g) || []).length > 0;
}

export function registerLocalizationConstraints(engine: ConstraintEngine): void {
  // 校验器：en/zh 字典键集合必须完全一致。
  engine.registerEvaluator("localization:i18nKeysAligned", (ctx) => {
    const enKeys = Object.keys(ctx.i18n.en).sort();
    const zhKeys = Object.keys(ctx.i18n.zh).sort();
    if (enKeys.length !== zhKeys.length) {
      return {
        message: `中英文字典键数不一致：en=${enKeys.length}，zh=${zhKeys.length}`,
        context: { enCount: enKeys.length, zhCount: zhKeys.length },
      };
    }
    const missingInZh = enKeys.filter((k) => !ctx.i18n.zh[k]);
    const missingInEn = zhKeys.filter((k) => !ctx.i18n.en[k]);
    if (missingInZh.length || missingInEn.length) {
      return {
        message: `i18n 键未对齐：zh 缺失 [${missingInZh.join(", ")}]；en 缺失 [${missingInEn.join(", ")}]`,
        context: { missingInZh, missingInEn },
      };
    }
    return null;
  });

  // 校验器：中文语境下关键状态键必须有对应中文翻译（不得回退到 key 本身）。
  engine.registerEvaluator("localization:noMissingTranslation", (ctx, spec) => {
    if (ctx.locale !== "zh") return null; // 仅中文语境强制
    const critical = (spec.params?.criticalKeys as string[] | undefined) ?? [];
    const dict = ctx.i18n.zh;
    const missing = critical.filter((k) => !dict[k] || dict[k] === k);
    if (missing.length) {
      return { message: `中文语境缺失关键翻译：${missing.join(", ")}`, context: { missing } };
    }
    return null;
  });

  // 校验器：业务上报的状态文案在中文语境不得是裸英文。
  engine.registerEvaluator("localization:noEnglishStatusInZh", (ctx) => {
    if (ctx.locale !== "zh") return null;
    const status = (ctx.event?.payload as { status?: string } | undefined)?.status;
    if (typeof status !== "string") return null;
    if (isUntranslatedEnglish(status)) {
      return { message: `检测到未翻译的英文状态文案：“${status}”`, context: { status } };
    }
    return null;
  });

  // 声明式约束：语言必须在允许集合内（纯数据 rule，由引擎求值）。
  engine.addConstraint({
    id: "localization.localeAllowed",
    title: "语言必须在允许集合内",
    description: "当前语言必须是 en 或 zh。",
    severity: "info",
    scope: "client",
    triggers: ["locale:changed", "startup"],
    rule: {
      any: [
        { path: "locale", op: "eq", value: "en" },
        { path: "locale", op: "eq", value: "zh" },
      ],
    },
    tags: ["localization"],
  });

  // error：i18n 字典键对齐。封锁「i18n.release」业务动作（反向联动示例）。
  engine.addConstraint({
    id: "localization.i18nKeysAligned",
    title: "i18n 中英文字典键对齐",
    description: "en.ts 与 zh.ts 必须拥有完全一致的键集合，否则视为发布前阻塞错误。",
    severity: "error",
    scope: "both",
    triggers: ["i18n:reload", "startup"],
    evaluator: "localization:i18nKeysAligned",
    params: { guards: ["i18n.release"] },
    tags: ["localization"],
  });

  // warn：中文语境关键翻译完整。
  engine.addConstraint({
    id: "localization.noMissingTranslation",
    title: "中文语境关键翻译完整",
    description: "中文语境下，关键用户可见状态键必须有对应中文翻译。",
    severity: "warn",
    scope: "client",
    triggers: ["locale:changed", "i18n:reload", "startup"],
    evaluator: "localization:noMissingTranslation",
    params: {
      criticalKeys: ["lang.switchToZh", "panels.title", "filePanel.show", "topbar.export"],
    },
    tags: ["localization"],
  });

  // error：中文语境禁止裸英文状态文案（由 reportUserStatus 事件触发）。
  engine.addConstraint({
    id: "localization.noEnglishStatusInZh",
    title: "中文语境禁止裸英文状态文案",
    description: "用户可见状态文案在中文语境下必须为中文，禁止未翻译英文。",
    severity: "error",
    scope: "client",
    triggers: ["status:reported"],
    evaluator: "localization:noEnglishStatusInZh",
    tags: ["localization"],
  });
}
