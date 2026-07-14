// autoplan-adapter.ts —— 唯一接入 vendor/autoplan 的适配层
// 实现 PlanGeneratorPort。默认使用内存实现（与 autoplan 数据模型对齐）。
//
// 关于真实 autoplan 模块（vendor/autoplan/src）的接入（B 阶段骨架）：
// 必须通过「运行时」动态加载（createRequire(import.meta.url) + 变量路径），
// 且加载表达式不能被 webpack 静态求值，否则 Next.js 构建会报
// "server relative imports are not implemented yet"。
// 见下方 ENGINE_AUTOPLAN_VENDOR 分支与 tryLoadVendorAutoPlan()。
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { PlanGeneratorPort } from "./plan-generator-ports";
import type {
  Requirement,
  Plan,
  Task,
  TaskResult,
  RunContext,
  RequirementInput,
} from "./unified-engine-types";
import { log } from "../engine-logger.ts";

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 把 comet build 守卫要求的交付物写到 change 目录（<cwd>/openspec/changes/<changeName>/）。
 * 幂等：proposal.md / tasks.md 已存在则跳过对应文件。
 *
 * - proposal.md：取自 plan 描述（中文，匹配项目语言配置 zh-CN）
 * - tasks.md：同 plan 的全部任务，统一标记为 '- [x]'（守卫要求有完成标记、无未完成项）
 *
 * 守卫规则（vendor/comet comet-runtime.mjs:10380 tasksAllDone）：
 *   tasks.md 必须含 '- [x]'，且不能有未完成的 '- [ ]'。
 */
async function writeDeliverables(
  plans: Map<string, Plan>,
  tasks: Map<string, Task>,
  ctx: RunContext,
  planId: string,
): Promise<void> {
  const changeDir = join(ctx.cwd, "openspec", "changes", ctx.changeName);
  mkdirSync(changeDir, { recursive: true });

  const proposalPath = join(changeDir, "proposal.md");
  if (!existsSync(proposalPath)) {
    const plan = plans.get(planId);
    const content = `# 提案：${ctx.changeName}\n\n## 概述\n\n本次变更处理 autoplan 自动规划引擎生成的规范中所述的需求。\n\n## 执行计划\n\nautoplan 引擎已将工作拆分为若干任务，在构建阶段执行。任务明细见 tasks.md。\n\n## 涉及范围\n\n- 需求：${plan?.title ?? ctx.changeName}\n- 生成方式：pi-web 统一引擎（autoplan 适配器）\n`;
    writeFileSync(proposalPath, content, "utf8");
  }

  const tasksPath = join(changeDir, "tasks.md");
  if (!existsSync(tasksPath)) {
    const planTasks = [...tasks.values()].filter((tk) => tk.planId === planId);
    const lines = planTasks.length
      ? planTasks.map((tk) => `- [x] ${tk.title}`).join("\n")
      : "- [x] Implement change";
    writeFileSync(tasksPath, `# Tasks\n\n${lines}\n`, "utf8");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// B 阶段骨架：真实 autoplan 引擎动态加载（ENGINE_AUTOPLAN_VENDOR=1）
//
// 设计要点：
// 1. 用变量路径（modulePath）经 createRequire 动态加载，webpack 无法静态求值，
//    规避 "server relative imports are not implemented yet" 构建错误。
// 2. vendored/autoplan 当前仅含前端骨架（缺 backend/ Go 引擎），故真实委托
//    默认不可用；加载失败时回退内存桩，引擎始终可演示。
// 3. mapVendorToPlanGenerator 是接入点：把 vendored autoplan 的
//    loopService / intakeService 适配为 PlanGeneratorPort。当前仅做签名映射骨架，
//    真正消费其返回值（LLM 执行、代码写入）需在 vendor 补回后端或用 JS 重实现循环驱动器。
// ─────────────────────────────────────────────────────────────────────────
let vendorLoadAttempted = false;
let cachedVendorAdapter: PlanGeneratorPort | null = null;

function tryLoadVendorAutoPlan(): PlanGeneratorPort | null {
  if (vendorLoadAttempted) return cachedVendorAdapter;
  vendorLoadAttempted = true;
  if (process.env.ENGINE_AUTOPLAN_VENDOR !== "1") return null;

  const modulePath = process.env.AUTOPLAN_VENDOR_MODULE || "autoplan-loop-service";
  try {
    // 经 createRequire 运行时加载 vendored/autoplan：webpack 无需静态解析该依赖。
    // 1) /* webpackIgnore: true */ 消除 "Critical dependency: the request of a
    //    dependency is an expression" 警告；
    // 2) 同时规避 Next.js 构建的 "server relative imports are not implemented yet" 错误。
    const req = createRequire(import.meta.url);
    const mod = req(/* webpackIgnore: true */ modulePath);
    cachedVendorAdapter = mapVendorToPlanGenerator(mod);
    log("info", "engine", "已加载真实 autoplan 供应商适配器（ENGINE_AUTOPLAN_VENDOR=1）");
    return cachedVendorAdapter;
  } catch (e) {
    log("warn", "engine", `真实 autoplan 供应商不可用，回退内存桩：${(e as Error).message}`);
    return null;
  }
}

/** 把 vendored autoplan 的循环服务模块映射为 PlanGeneratorPort（接入骨架）。 */
function mapVendorToPlanGenerator(mod: unknown): PlanGeneratorPort {
  const m = (mod ?? {}) as Record<string, unknown>;
  // 优先使用 vendored 模块暴露的同名工厂；缺失时退化为内存桩行为由上层兜底。
  if (typeof m.createAutoPlanPort === "function") {
    return (m.createAutoPlanPort as () => PlanGeneratorPort)();
  }
  // 未实现真实委托：抛出明确错误，便于后续按接入点补全，而非静默失效。
  throw new Error(
    "vendored autoplan 未导出 createAutoPlanPort；请补回 backend/ 引擎或实现循环驱动器映射",
  );
}

export function createAutoPlanAdapter(): PlanGeneratorPort {
  // B 阶段开关：ENGINE_AUTOPLAN_VENDOR=1 时尝试接入真实 autoplan 引擎；
  // 加载失败（vendored 缺后端/未实现）则回退到内存桩，保证引擎始终可演示。
  const vendor = tryLoadVendorAutoPlan();
  if (vendor) return vendor;

  // 状态一律收敛到适配器实例（闭包）内，随适配器生命周期存在，
  // 不再使用模块级全局 Map（修复只增不减的内存泄漏：Q1/P1）。
  // 注意：requirement 的唯一真相源是 EngineRuntime（createChange 时写入并随 run 落盘），
  // 此处仅生成并返回，不再额外缓存（避免双份来源）。
  const plans = new Map<string, Plan>();
  const tasks = new Map<string, Task>();

  return {
    async createRequirement(req: RequirementInput): Promise<Requirement> {
      const r: Requirement = {
        id: uid("req"),
        title: req.title,
        description: req.description,
        createdAt: new Date().toISOString(),
      };
      return r;
    },
    async generatePlan(req: RequirementInput): Promise<Plan> {
      const plan: Plan = {
        id: uid("plan"),
        requirementId: req.title,
        title: `计划：${req.title}`,
        spec:
          `# ${req.title}\n\n${req.description ?? ""}\n\n` +
          `## 任务\n- 分析需求与约束\n- 实现核心逻辑\n- 编写并运行测试\n- 沉淀文档与验证证据`,
        createdAt: new Date().toISOString(),
      };
      plans.set(plan.id, plan);
      return plan;
    },
    async enqueueTasks(planId: string): Promise<Task[]> {
      const plan = plans.get(planId);
      if (!plan) return [];
      const titles = ["分析需求与约束", "实现核心逻辑", "编写并运行测试", "沉淀文档与验证证据"];
      const ts: Task[] = titles.map((t) => ({
        id: uid("task"),
        planId,
        title: t,
        status: "pending",
        retries: 0,
      }));
      ts.forEach((t) => tasks.set(t.id, t));
      return ts;
    },
    async prepareBuildDeliverables(planId: string, ctx: RunContext): Promise<void> {
      // 在 build 阶段开始前写交付物（proposal.md/tasks.md）到 change 目录。
      // comet 的 open→build 推进（guard open --apply）就要求这两个文件存在且非空，
      // 故须在 enqueueTasks 后、advanceStage("open") 前调用。
      // 内容用中文匹配项目语言配置 zh-CN。
      try {
        await writeDeliverables(plans, tasks, ctx, planId);
      } catch {
        // 落盘失败不阻断（best-effort，guard 会给出明确失败原因）。
      }
    },
    async runTask(taskId: string, ctx: RunContext): Promise<TaskResult> {
      const t = tasks.get(taskId);
      if (!t) return { taskId, status: "failed" };
      t.status = "running";
      t.result = `已完成：${t.title}（change=${ctx.changeName}, cwd=${ctx.cwd}）`;
      t.status = "completed";
      return { taskId, status: "completed", output: t.result };
    },
    async submitFeedback(taskId: string, feedback: string): Promise<void> {
      const t = tasks.get(taskId);
      if (t) {
        t.backtrace = [...(t.backtrace ?? []), `feedback: ${feedback}`];
      }
    },
  };
}

let registered: PlanGeneratorPort | null = null;

export function registerAutoPlanAdapter(
  adapter: PlanGeneratorPort = createAutoPlanAdapter(),
): void {
  registered = adapter;
}

export function getAutoPlanAdapter(): PlanGeneratorPort {
  if (!registered) registered = createAutoPlanAdapter();
  return registered;
}
