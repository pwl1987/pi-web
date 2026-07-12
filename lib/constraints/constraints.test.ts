// 约束系统回归测试（vitest，@ 别名可用）。
//
// 覆盖四点要求：
// 1) 结构化约束规范可被程序解析（serializeSpecs）。
// 2) 约束与状态/事件的双向绑定（emit 触发重算、locale 变化影响求值）。
// 3) 运行状态变更时动态触发/更新/校验（添加→违反→消解）。
// 4) 与业务逻辑集成（guard 拦截硬约束动作）。

import { describe, it, expect } from "vitest";
import { ConstraintEngine, evaluateRule } from "@/lib/constraints/engine";
import type { ConstraintContext, Locale } from "@/lib/constraints/types";
import {
  registerLocalizationConstraints,
  isUntranslatedEnglish,
} from "@/lib/constraints/localization";
import { en as enDict } from "@/lib/i18n/en";
import { zh as zhDict } from "@/lib/i18n/zh";

function makeEngine(locale: Locale, i18n?: ConstraintContext["i18n"]): ConstraintEngine {
  const dicts = i18n ?? {
    en: enDict as Record<string, string>,
    zh: zhDict as Record<string, string>,
  };
  const engine = new ConstraintEngine(() => ({ locale, i18n: dicts, runtime: null }));
  registerLocalizationConstraints(engine);
  return engine;
}

describe("约束规范可被程序解析", () => {
  it("serializeSpecs 输出包含本地化约束的结构化 JSON", () => {
    const engine = makeEngine("en");
    const json = engine.serializeSpecs();
    const parsed = JSON.parse(json) as Array<{ id: string }>;
    const ids = parsed.map((s) => s.id);
    expect(ids).toContain("localization.i18nKeysAligned");
    expect(ids).toContain("localization.noEnglishStatusInZh");
    // triggers 作为数据存在，证明约束与事件/状态源绑定是可解析的
    const noEnglish = parsed.find((s) => s.id === "localization.noEnglishStatusInZh")!;
    expect(JSON.stringify(noEnglish)).toContain("status:reported");
  });
});

describe("声明式规则求值（evaluateRule）", () => {
  const ctx: ConstraintContext = { locale: "zh", i18n: { en: {}, zh: {} }, runtime: null };
  it("any 命中即通过", () => {
    expect(
      evaluateRule(
        {
          any: [
            { path: "locale", op: "eq", value: "en" },
            { path: "locale", op: "eq", value: "zh" },
          ],
        },
        ctx,
      ),
    ).toBe(true);
  });
  it("all 任一不满足即失败", () => {
    expect(
      evaluateRule(
        {
          all: [
            { path: "locale", op: "eq", value: "zh" },
            { path: "locale", op: "eq", value: "en" },
          ],
        },
        ctx,
      ),
    ).toBe(false);
  });
});

describe("约束与状态/事件双向绑定", () => {
  it("locale 非法时 localeAllowed 规则产生 info 级违反", () => {
    const engine = makeEngine("fr" as Locale);
    engine.evaluateAll();
    const f = engine.getFindings().find((x) => x.specId === "localization.localeAllowed");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("info");
  });

  it("locale 合法时 localeAllowed 不产生违反", () => {
    const engine = makeEngine("zh");
    engine.evaluateAll();
    expect(engine.getFindings().some((x) => x.specId === "localization.localeAllowed")).toBe(false);
  });

  it("中文语境下上报裸英文状态 → 触发 noEnglishStatusInZh 违反", () => {
    const engine = makeEngine("zh");
    engine.evaluateAll();
    expect(engine.getFindings().some((x) => x.specId === "localization.noEnglishStatusInZh")).toBe(
      false,
    );
    // 业务代码上报一条英文状态（双向绑定：业务 → 约束）
    engine.emit("status:reported", { status: "Connection failed" });
    const f = engine.getFindings().find((x) => x.specId === "localization.noEnglishStatusInZh");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
  });

  it("上报中文状态后该违反自动消解", () => {
    const engine = makeEngine("zh");
    engine.emit("status:reported", { status: "连接失败" });
    expect(engine.getFindings().some((x) => x.specId === "localization.noEnglishStatusInZh")).toBe(
      false,
    );
  });

  it("英文语境下同样的英文状态不触发该约束", () => {
    const engine = makeEngine("en");
    engine.emit("status:reported", { status: "Connection failed" });
    expect(engine.getFindings().some((x) => x.specId === "localization.noEnglishStatusInZh")).toBe(
      false,
    );
  });

  it("未监听的事件类型不会触发约束", () => {
    const engine = makeEngine("zh");
    engine.emit("unrelated:event", { status: "Connection failed" });
    expect(engine.getFindings().some((x) => x.specId === "localization.noEnglishStatusInZh")).toBe(
      false,
    );
  });
});

describe("动态校验：中文语境缺失关键翻译", () => {
  it("zh 字典缺关键键时产生 warn 级违反", () => {
    const engine = makeEngine("zh", { en: enDict as Record<string, string>, zh: {} });
    engine.evaluateAll();
    const f = engine.getFindings().find((x) => x.specId === "localization.noMissingTranslation");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("warn");
  });

  it("zh 字典完整时该约束通过", () => {
    const engine = makeEngine("zh");
    engine.evaluateAll();
    expect(engine.getFindings().some((x) => x.specId === "localization.noMissingTranslation")).toBe(
      false,
    );
  });
});

describe("与业务逻辑集成：guard 拦截", () => {
  it("error 级且声明 guards 的约束会阻塞对应业务动作", () => {
    const engine = new ConstraintEngine(() => ({
      locale: "en",
      i18n: { en: {}, zh: {} },
      runtime: null,
    }));
    engine.registerEvaluator("test:alwaysFail", () => ({ message: "硬编码错误" }));
    engine.addConstraint({
      id: "biz.blockSend",
      title: "禁止发送",
      description: "演示 guard 拦截。",
      severity: "error",
      scope: "both",
      triggers: ["startup"],
      evaluator: "test:alwaysFail",
      params: { guards: ["chat.send"] },
      tags: ["demo"],
    });
    engine.evaluateAll();
    const r1 = engine.guard("chat.send");
    expect(r1.allowed).toBe(false);
    expect(r1.blocking.length).toBe(1);
    // 未声明封锁的动作不受影响
    expect(engine.guard("chat.abort").allowed).toBe(true);
  });

  it("info/warn 级约束不阻塞业务动作", () => {
    const engine = new ConstraintEngine(() => ({
      locale: "fr" as Locale,
      i18n: { en: {}, zh: {} },
      runtime: null,
    }));
    engine.evaluateAll(); // localeAllowed 产生 info 违反
    expect(engine.guard("anything").allowed).toBe(true);
  });
});

describe("isUntranslatedEnglish 启发式", () => {
  it.each([
    ["Connection failed", true],
    ["Error", true],
    ["连接失败", false],
    ["123", false],
    ["CPU 占用 80%", false],
  ])("%s → %s", (input, expected) => {
    expect(isUntranslatedEnglish(input)).toBe(expected);
  });
});
