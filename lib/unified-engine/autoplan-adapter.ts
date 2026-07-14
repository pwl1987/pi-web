// autoplan-adapter.ts —— 唯一接入 vendor/autoplan 的适配层
// 实现 PlanGeneratorPort。默认走真实 LLM 适配器（组合根注入 pi 系统配置的 createPiLlmCompletion），
// 仅在完全未注入 LLM 工厂（测试/极端场景）时回退内存桩；**生产路径不使用内存桩**。
//
// 关于真实 autoplan 模块（vendor/autoplan/src）的接入（B 阶段骨架）：
// 必须通过「运行时」动态加载（createRequire(import.meta.url) + 变量路径），
// 且加载表达式不能被 webpack 静态求值，否则 Next.js 构建会报
// "server relative imports are not implemented yet"。
// 见下方 ENGINE_AUTOPLAN_VENDOR 分支与 tryLoadVendorAutoPlan()。
import { createRequire } from "node:module";
import type { PlanGeneratorPort } from "./plan-generator-ports";
import type {
  Requirement,
  Plan,
  Task,
  TaskResult,
  RunContext,
  RequirementInput,
  LlmCompletionFn,
} from "./unified-engine-types";
import { log } from "../engine-logger.ts";
import { writeDeliverables } from "./autoplan-deliverables.ts";
import { createLlmAutoPlanAdapter } from "./autoplan-llm-adapter.ts";

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
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

/**
 * 内存桩实现（确定性、无 LLM）：仅当组合根完全未注入 LLM 工厂时（如单测隔离）使用。
 * 生产路径因组合根注入 createPiLlmCompletion，不会走到此分支。
 * 状态收敛到实例闭包，避免模块级 Map 泄漏（Q1/P1）。
 */
function createMemoryAutoPlanAdapter(): PlanGeneratorPort {
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

/**
 * 构造 autoplan 适配器，按优先级选择实现：
 *   1) ENGINE_AUTOPLAN_VENDOR=1 且 vendored 后端可用 → 真实供应商适配器；
 *   2) 注入了 createLlm → 真实 LLM 适配器（B 阶段「真实执行」，pi 系统配置模型）；
 *   3) 否则 → 内存桩（仅当完全未注入 LLM，如单测隔离场景；生产路径不触发）。
 *
 * 真实 LLM 适配器不做内存桩兜底：无模型/调用失败则任务如实失败，连续失败达阈值熔断。
 */
export function createAutoPlanAdapter(
  createLlm?: (cwd: string) => LlmCompletionFn | null,
): PlanGeneratorPort {
  const vendor = tryLoadVendorAutoPlan();
  if (vendor) return vendor;
  if (createLlm) return createLlmAutoPlanAdapter(createLlm);
  return createMemoryAutoPlanAdapter();
}

let registered: PlanGeneratorPort | null = null;

export function registerAutoPlanAdapter(
  adapter: PlanGeneratorPort = createMemoryAutoPlanAdapter(),
): void {
  registered = adapter;
}

export function getAutoPlanAdapter(
  createLlm?: (cwd: string) => LlmCompletionFn | null,
): PlanGeneratorPort {
  if (!registered) registered = createAutoPlanAdapter(createLlm);
  return registered;
}
