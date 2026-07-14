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
import { STAGES, DEFAULT_WORKFLOW } from "./unified-engine-types";
import { log } from "../engine-logger.ts";
import { saveEngineRun, loadAllEngineRuns, MAX_RECORDS } from "./persistence.ts";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

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
  /** 在途运行集合：用于重入保护（已在跑的 run 忽略重复 start/resume）。 */
  private runningIds = new Set<string>();

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
        // requirements 仅存内存，重启后丢失。从 run 快照重建 Requirement，
        // 否则 runLoop 因 !req 直接 failed（"启动运行"后无阶段日志即失败）。
        const run = rec.run;
        if (run.requirementId && !this.requirements.has(run.requirementId)) {
          this.requirements.set(run.requirementId, {
            id: run.requirementId,
            title: run.title,
            description: run.requirementDescription,
            createdAt: run.createdAt,
          });
        }
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
    this.enforceCap();
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** 内存 runs 上限裁剪：超出 MAX_RECORDS 时丢弃最旧的记录（与持久化对齐）。 */
  private enforceCap(): void {
    if (this.runs.size <= MAX_RECORDS) return;
    const sorted = [...this.runs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const old of sorted.slice(0, this.runs.size - MAX_RECORDS)) {
      this.runs.delete(old.runId);
    }
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
      await this.wf.openChange(changeName, DEFAULT_WORKFLOW, input.cwd);
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
      requirementDescription: req.description,
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
    // 重入保护：已在途运行的 run 直接返回，避免重复触发 runLoop。
    if (run.status === "running" && this.runningIds.has(runId)) return run;
    run.status = "running";
    run.updatedAt = nowIso();
    this.persistRun(run);
    log("info", "engine", `启动运行`, { runId: run.runId });
    this.emit({ type: "run.updated", runId, payload: run });
    // 异步化：不 await 整个五阶段循环，触发即返回，进度经 SSE 推送（修复 HTTP 挂死）。
    void this.runLoop(run);
    return run;
  }

  async pauseRun(runId: string): Promise<void> {
    const run = this.getRunState(runId);
    run.status = "paused";
    run.updatedAt = nowIso();
    this.persistRun(run);
    log("info", "engine", `暂停运行`, { runId: run.runId });
    this.emit({ type: "run.updated", runId, payload: run });
  }

  async resumeRun(runId: string): Promise<RunState> {
    const run = this.getRunState(runId);
    // 重入保护：已在途运行的 run 直接返回。
    if (run.status === "running" && this.runningIds.has(runId)) return run;
    run.status = "running";
    run.updatedAt = nowIso();
    this.persistRun(run);
    log("info", "engine", `恢复运行`, { runId: run.runId });
    this.emit({ type: "run.updated", runId, payload: run });
    // 断点续跑：runLoop 依据已落盘的 stage 跳过已完成阶段（不重头重跑）。
    void this.runLoop(run);
    return run;
  }

  /** 统一自主编程循环：open → design(计划) → build(任务) → verify(守卫) → archive
   *  可断点续跑（依据 run.stage 跳过已完成阶段），并在每个 await 后 cooperative 检查
   *  paused 状态以真正中断在途循环（pause 生效）。 */
  private async runLoop(run: RunState): Promise<void> {
    this.runningIds.add(run.runId);
    try {
      // 自愈：确保 change 目录与 .comet.yaml 存在。createChange 时若 comet init
      // 失败（如曾传非法 workflow、或 HMR 陈旧单例），run 仍会落盘并被重试；
      // 此处幂等补建，避免重试永远卡在 verify 守卫的 "change directory not found"。
      // 放在 req 检查之前——目录自愈不依赖 requirement。
      try {
        await this.wf.ensureChange(run.changeName, DEFAULT_WORKFLOW, run.cwd);
      } catch (e) {
        this.emit({
          type: "log",
          runId: run.runId,
          message: `change 目录自愈失败，降级为内存态：${(e as Error).message}`,
        });
      }

      const req = this.requirements.get(run.requirementId);
      if (!req) {
        this.failRun(run, `需求不存在（${run.requirementId}），无法生成计划。请重新创建变更。`);
        return;
      }

      // 已完成（archive）的 run 直接收尾，避免 resume 把已完成 run 重新置为 running 误标记。
      if (run.stage === "archive") {
        run.status = "completed";
        run.updatedAt = nowIso();
        this.persistRun(run);
        this.emit({ type: "run.updated", runId: run.runId, payload: run });
        return;
      }

      // design：生成计划（内存态；hotfix workflow 下 comet 无 design 阶段，计划生成属于 open 阶段内容）
      if (run.stage === "open" || run.stage === "design") {
        run.stage = "design";
        run.updatedAt = nowIso();
        this.persistRun(run);
        log("info", "engine", `阶段切换：design`, { runId: run.runId });
        this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
        const plan = await this.planGen.generatePlan({
          title: req.title,
          description: req.description,
          cwd: run.cwd,
        });
        run.planId = plan.id;

        // 拆解任务 + 写交付物（proposal.md/tasks.md）。
        // comet 的 open→build 推进要求这两个文件已存在，故在 advanceStage("open") 前写入。
        const tasks = await this.planGen.enqueueTasks(plan.id);
        run.tasks = tasks;
        this.persistRun(run);
        this.emit({ type: "run.updated", runId: run.runId, payload: run });
        // 协同暂停：design 块内也检查，避免长任务下 pause 要等整段 design 完成才生效。
        if (await this.shouldPause(run)) return;
        await this.planGen.prepareBuildDeliverables(plan.id, {
          cwd: run.cwd,
          changeName: run.changeName,
        });

        // 推进 comet phase: open → build（hotfix 直接到 build；full 到 design）。
        await this.safeAdvance(run, "open");
        if (await this.shouldPause(run)) return;
        run.stage = "build";
        run.updatedAt = nowIso();
        this.persistRun(run);
        this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
      }
      if (await this.shouldPause(run)) return;

      // build：从 run.tasks 续跑未完成任务（断点续跑，跳过已完成项）
      if (run.stage === "build") {
        run.stage = "build";
        run.updatedAt = nowIso();
        this.persistRun(run);
        log("info", "engine", `阶段切换：build`, { runId: run.runId });
        this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });

        for (const task of run.tasks) {
          if (
            task.status === "completed" ||
            task.status === "failed" ||
            task.status === "skipped"
          ) {
            continue;
          }
          const res = await this.planGen.runTask(task.id, {
            cwd: run.cwd,
            changeName: run.changeName,
          });
          task.status = res.status;
          task.result = res.output;
          log("debug", "engine", `任务完成：${task.id} → ${task.status}`, { runId: run.runId });
          this.persistRun(run);
          this.emit({ type: "task.updated", runId: run.runId, payload: task });
          if (await this.shouldPause(run)) return;
        }
        run.stage = "verify";
        run.updatedAt = nowIso();
        this.persistRun(run);
        this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
      }
      if (await this.shouldPause(run)) return;

      // verify：comet 守卫校验 + 推进 build→verify
      if (run.stage === "verify") {
        const guardBuild = await this.safeGuard(run, "build");
        if (!guardBuild.passed) {
          this.failRun(run, guardBuild.message ?? "build 守卫未通过");
          this.emit({
            type: "guard",
            runId: run.runId,
            message: guardBuild.message,
            payload: guardBuild,
          });
          return;
        }
        await this.safeAdvance(run, "build");

        // 准备 verify 守卫要求的交付物（verification_report 文件 + branch_status=handled）。
        try {
          await this.wf.prepareVerifyArtifacts(run.changeName, run.cwd);
        } catch (e) {
          this.emit({
            type: "log",
            runId: run.runId,
            message: `verify 交付物准备失败：${(e as Error).message}`,
          });
        }

        const guardVerify = await this.safeGuard(run, "verify");
        if (!guardVerify.passed) {
          this.failRun(run, guardVerify.message ?? "verify 守卫未通过");
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
        run.updatedAt = nowIso();
        this.persistRun(run);
        log("info", "engine", `运行完成`, { runId: run.runId });
        this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
        this.emit({ type: "run.updated", runId: run.runId, payload: run });
      }
    } catch (e) {
      this.failRun(run, `运行失败：${(e as Error).message}`);
    } finally {
      this.runningIds.delete(run.runId);
    }
  }

  /** 协同式暂停检查：status 为 paused 时保存并返回 true（让 runLoop 提前退出）。 */
  private async shouldPause(run: RunState): Promise<boolean> {
    if (run.status === "paused") {
      run.updatedAt = nowIso();
      this.persistRun(run);
      this.emit({ type: "run.updated", runId: run.runId, payload: run });
      return true;
    }
    return false;
  }

  /** 将 run 标记为失败并通知（统一失败路径）。 */
  private failRun(run: RunState, message: string): void {
    run.status = "failed";
    run.updatedAt = nowIso();
    this.persistRun(run);
    log("error", "engine", message, { runId: run.runId });
    this.emit({ type: "log", runId: run.runId, message });
    this.emit({ type: "run.updated", runId: run.runId, payload: run });
  }

  /** 读取 comet 当前阶段（best-effort，失败返回 undefined）。 */
  private async readCometPhase(changeName: string, cwd: string): Promise<string | undefined> {
    try {
      return (await this.wf.getState(changeName, cwd)).phase;
    } catch {
      return undefined;
    }
  }

  /** comet 守卫：不可用时默认放行（降级），保证引擎可演示 */
  private async safeGuard(run: RunState, phase: Stage) {
    try {
      // 先检查 comet 实际阶段：若已超越当前守卫阶段则直接放行（恢复场景自愈）。
      const cometPhase = await this.readCometPhase(run.changeName, run.cwd);
      if (cometPhase && cometPhase !== phase) {
        return {
          change: run.changeName,
          phase,
          passed: true,
          message: `comet 阶段已为 ${cometPhase}，跳过 ${phase} 守卫`,
        };
      }
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

  /** comet 推进：不可用时内存推进（降级）。恢复场景下若 comet 已越过目标阶段则跳过。 */
  private async safeAdvance(run: RunState, phase: Stage): Promise<void> {
    try {
      // 先检查 comet 实际阶段：若已超越当前阶段则跳过守卫推进（恢复/重跑自愈）。
      const cometPhase = await this.readCometPhase(run.changeName, run.cwd);
      if (cometPhase && cometPhase !== phase) {
        this.emit({
          type: "log",
          runId: run.runId,
          message: `comet 阶段已为 ${cometPhase}，跳过 ${phase}→${nextStage(phase)} 推进（恢复自愈）`,
        });
        // 对齐内存阶段到 comet 实际位置（但 runLoop 后续会按阶段顺序继续写，仅作修正）。
        const match = STAGES.indexOf(cometPhase as Stage);
        if (match >= 0) run.stage = STAGES[match];
      } else {
        const ev = await this.wf.advanceStage(run.changeName, phase, run.cwd);
        run.stage = ev.to;
      }
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
