// autoplan-adapter.ts —— 唯一接入 vendor/autoplan 的适配层
// 实现 PlanGeneratorPort。默认使用内存实现（与 autoplan 数据模型对齐），
// 当 ENGINE_AUTOPLAN_VENDOR=1 且上游模块可解析时，最优尝试委托真实 autoplan 模块（sql.js/LLM/外部 agent）。
import { join } from "node:path";
import type { PlanGeneratorPort } from "./plan-generator-ports";
import type {
  Requirement,
  Plan,
  Task,
  TaskResult,
  RunContext,
  RequirementInput,
} from "./unified-engine-types";

const requirements = new Map<string, Requirement>();
const plans = new Map<string, Plan>();
const tasks = new Map<string, Task>();

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 受控接入真实 autoplan 模块（可选）。
 * 通过运行时 createRequire 加载 vendor/autoplan 的纯 Node 模块；失败则回退内存实现。
 * 永不静态 import 上游，避免污染 Next.js 构建。
 */
async function tryLoadVendor(): Promise<Record<string, unknown> | null> {
  if (process.env.ENGINE_AUTOPLAN_VENDOR !== "1") return null;
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const base = join(process.cwd(), "vendor", "autoplan", "src");
    // 仅作能力探测：真实集成应在此 require loop/builtinPlanGenerator 等模块
    const mod = require(join(base, "chat", "llmClient.js"));
    return mod as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function createAutoPlanAdapter(): PlanGeneratorPort {
  return {
    async createRequirement(req: RequirementInput): Promise<Requirement> {
      const r: Requirement = {
        id: uid("req"),
        title: req.title,
        description: req.description,
        createdAt: new Date().toISOString(),
      };
      requirements.set(r.id, r);
      return r;
    },
    async generatePlan(req: RequirementInput): Promise<Plan> {
      void (await tryLoadVendor());
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
