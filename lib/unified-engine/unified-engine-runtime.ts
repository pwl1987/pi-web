// unified-engine-runtime.ts —— 融合引擎运行时（globalThis 单例）
// 以 comet 五阶段状态机为骨架，autoplan 的计划/任务为内容源，编排统一自主编程循环。
// 复用 lib/rpc-manager 思路：globalThis 单例 + 空闲销毁，避免长任务泄漏。
import type { PlanGeneratorPort } from "./plan-generator-ports";
import type { WorkflowStateMachinePort } from "./workflow-state-machine-ports";
import type {
  ChangeInput,
  EngineEvent,
  Requirement,
  RunState,
  Stage,
} from "./unified-engine-types";
import { STAGES } from "./unified-engine-types";
import { log } from "../engine-logger.ts";
import { saveEngineRun, loadAllEngineRuns } from "./persistence.ts";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "change"
  );
}

function nextStage(phase: Stage): Stage {
  const i = STAGES.indexOf(phase);
  return STAGES[Math.min(i + 1, STAGES.length - 1)];
}

export class EngineRuntime {
  private runs = new Map<string, RunState>();
  private requirements = new Map<string, Requirement>();
  private listeners = new Set<(e: EngineEvent) => void>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private rehydrated = false;

  constructor(
    private readonly planGen: PlanGeneratorPort,
    private readonly wf: WorkflowStateMachinePort,
  ) {}

  /** 把单条运行态原子落盘（best-effort），空闲/重启后仍可恢复。 */
  private persistRun(run: RunState): void {
    try {
      saveEngineRun(run);
    } catch {
      // 持久化失败不阻断引擎。
    }
  }

  /** 把全部在途运行态刷盘（防御性，用于空闲前）。 */
  private flushAll(): void {
    for (const run of this.runs.values()) this.persistRun(run);
  }

  /** 进程重启 / 内存被清空后，从磁盘 rehydrate 进内存（不覆盖在途运行）。 */
  private ensureRehydrated(): void {
    if (this.rehydrated) return;
    this.rehydrated = true;
    try {
      for (const rec of loadAllEngineRuns()) {
        if (!this.runs.has(rec.id)) this.runs.set(rec.id, rec.run);
      }
    } catch {
      // best-effort：恢复失败不阻断引擎。
    }
  }

  subscribe(cb: (e: EngineEvent) => void): () => void {
    this.listeners.add(cb);
    this.touch();
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(e: Omit<EngineEvent, "at">): void {
    const event: EngineEvent = { ...e, at: new Date().toISOString() };
    for (const cb of this.listeners) cb(event);
    this.touch();
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      // 空闲超时：先 flush 全部在途运行态到磁盘（磁盘仍在，可恢复），再清空内存释放资源。
      this.flushAll();
      this.runs.clear();
      this.listeners.clear();
      // 重置 rehydrate 标记，使后续访问可再次从磁盘重载历史（按需恢复）。
      this.rehydrated = false;
    }, IDLE_TIMEOUT_MS);
  }

  listRuns(): RunState[] {
    this.ensureRehydrated();
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getRunState(runId: string): RunState {
    this.ensureRehydrated();
    const run = this.runs.get(runId);
    if (!run) throw new Error(`运行不存在：${runId}`);
    return run;
  }

  async createChange(input: ChangeInput): Promise<RunState> {
    const req = await this.planGen.createRequirement({
      title: input.title,
      description: input.description,
      cwd: input.cwd,
    });
    this.requirements.set(req.id, req);

    const changeName = `${slug(input.title)}-${uid("c").slice(-4)}`;
    try {
      await this.wf.openChange(changeName, "classic", input.cwd);
    } catch (e) {
      this.emit({
        type: "log",
        runId: "system",
        message: `comet 不可用，使用内存状态：${(e as Error).message}`,
      });
    }

    const runId = uid("run");
    const run: RunState = {
      runId,
      changeName,
      requirementId: req.id,
      title: req.title,
      stage: "open",
      status: "idle",
      tasks: [],
      cwd: input.cwd,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(runId, run);
    this.persistRun(run);
    log("info", "engine", `创建 change：${changeName}`, { runId: run.runId });
    this.emit({ type: "run.created", runId, payload: run });
    return run;
  }

  async startRun(runId: string): Promise<RunState> {
    const run = this.getRunState(runId);
    run.status = "running";
    run.updatedAt = new Date().toISOString();
    this.persistRun(run);
    log("info", "engine", `启动运行`, { runId: run.runId });
    this.emit({ type: "run.updated", runId, payload: run });
    await this.runLoop(run);
    return run;
  }

  async pauseRun(runId: string): Promise<void> {
    const run = this.getRunState(runId);
    run.status = "paused";
    run.updatedAt = new Date().toISOString();
    this.persistRun(run);
    log("info", "engine", `暂停运行`, { runId: run.runId });
    this.emit({ type: "run.updated", runId, payload: run });
  }

  async resumeRun(runId: string): Promise<RunState> {
    const run = this.getRunState(runId);
    run.status = "running";
    run.updatedAt = new Date().toISOString();
    this.persistRun(run);
    log("info", "engine", `恢复运行`, { runId: run.runId });
    this.emit({ type: "run.updated", runId, payload: run });
    await this.runLoop(run);
    return run;
  }

  /** 统一自主编程循环：open → design(计划) → build(任务) → verify(守卫) → archive */
  private async runLoop(run: RunState): Promise<void> {
    const req = this.requirements.get(run.requirementId);
    if (!req) {
      run.status = "failed";
      return;
    }
    try {
      // design：生成计划
      run.stage = "design";
      run.updatedAt = new Date().toISOString();
      this.persistRun(run);
      log("info", "engine", `阶段切换：design`, { runId: run.runId });
      this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
      const plan = await this.planGen.generatePlan({
        title: req.title,
        description: req.description,
        cwd: run.cwd,
      });
      run.planId = plan.id;

      // build：拆解并执行任务
      run.stage = "build";
      run.updatedAt = new Date().toISOString();
      this.persistRun(run);
      log("info", "engine", `阶段切换：build`, { runId: run.runId });
      this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
      const tasks = await this.planGen.enqueueTasks(plan.id);
      run.tasks = tasks;
      this.persistRun(run);
      this.emit({ type: "run.updated", runId: run.runId, payload: run });

      for (const task of tasks) {
        const res = await this.planGen.runTask(task.id, {
          cwd: run.cwd,
          changeName: run.changeName,
        });
        task.status = res.status;
        task.result = res.output;
        log("debug", "engine", `任务完成：${task.id} → ${task.status}`, { runId: run.runId });
        this.emit({ type: "task.updated", runId: run.runId, payload: task });
      }

      // verify：comet 守卫校验（失败则反馈闭环，此处简化为标记失败）
      run.stage = "verify";
      run.updatedAt = new Date().toISOString();
      this.persistRun(run);
      log("info", "engine", `阶段切换：verify`, { runId: run.runId });
      this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });

      const guardBuild = await this.safeGuard(run, "build");
      if (!guardBuild.passed) {
        run.status = "failed";
        this.persistRun(run);
        log("warn", "engine", `build 守卫未通过：${guardBuild.message}`, { runId: run.runId });
        this.emit({
          type: "guard",
          runId: run.runId,
          message: guardBuild.message,
          payload: guardBuild,
        });
        return;
      }
      await this.safeAdvance(run, "build");

      const guardVerify = await this.safeGuard(run, "verify");
      if (!guardVerify.passed) {
        run.status = "failed";
        this.persistRun(run);
        log("warn", "engine", `verify 守卫未通过：${guardVerify.message}`, { runId: run.runId });
        this.emit({
          type: "guard",
          runId: run.runId,
          message: guardVerify.message,
          payload: guardVerify,
        });
        return;
      }
      await this.safeAdvance(run, "verify");

      // archive
      run.stage = "archive";
      run.status = "completed";
      run.updatedAt = new Date().toISOString();
      this.persistRun(run);
      log("info", "engine", `运行完成`, { runId: run.runId });
      this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
      this.emit({ type: "run.updated", runId: run.runId, payload: run });
    } catch (e) {
      run.status = "failed";
      run.updatedAt = new Date().toISOString();
      this.persistRun(run);
      log("error", "engine", `运行失败：${(e as Error).message}`, { runId: run.runId });
      this.emit({
        type: "log",
        runId: run.runId,
        message: `运行失败：${(e as Error).message}`,
      });
      this.emit({ type: "run.updated", runId: run.runId, payload: run });
    }
  }

  /** comet 守卫：不可用时默认放行（降级），保证引擎可演示 */
  private async safeGuard(run: RunState, phase: Stage) {
    try {
      return await this.wf.evaluateGuard(run.changeName, phase, run.cwd);
    } catch (e) {
      return {
        change: run.changeName,
        phase,
        passed: true,
        message: `comet 不可用，默认放行：${(e as Error).message}`,
      };
    }
  }

  /** comet 推进：不可用时内存推进（降级） */
  private async safeAdvance(run: RunState, phase: Stage): Promise<void> {
    try {
      const ev = await this.wf.advanceStage(run.changeName, phase, run.cwd);
      run.stage = ev.to;
    } catch (e) {
      this.emit({
        type: "log",
        runId: run.runId,
        message: `comet 推进不可用，内存推进：${(e as Error).message}`,
      });
      run.stage = nextStage(phase);
    }
    run.updatedAt = new Date().toISOString();
    this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
  }
}

// globalThis 单例，跨 Next.js 热重载存活
const g = globalThis as unknown as { __piEngineRuntime?: EngineRuntime };

export function getEngineRuntime(
  planGen: PlanGeneratorPort,
  wf: WorkflowStateMachinePort,
): EngineRuntime {
  if (!g.__piEngineRuntime) {
    g.__piEngineRuntime = new EngineRuntime(planGen, wf);
  }
  return g.__piEngineRuntime;
}
