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
import { uid, slug } from "../id.ts";
import { log } from "../engine-logger.ts";
import { saveEngineRun, loadAllEngineRuns, MAX_RECORDS } from "./persistence.ts";
import { buildEngineState, getEngineRuntimeStore } from "../engine-runtime-store.ts";
import { isCometAvailable } from "./guards/comet-cli";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function nextStage(phase: Stage): Stage {
  const i = STAGES.indexOf(phase);
  return STAGES[Math.min(i + 1, STAGES.length - 1)];
}

/** 阶段处理结果：continue=继续贯穿下一阶段；pause=已暂停需退出；stop=已终止(完成/失败)需退出。 */
type StageOutcome = "continue" | "pause" | "stop";

/** 阶段处理器（策略/管线模式）：canRun 判定是否命中当前 run.stage，execute 执行该阶段逻辑。
 *  以有序管线串行执行，完整保留原 runLoop 的「阶段贯穿(fall-through)」语义，同时把分散的
 *  `if (run.stage === ...)` 判断收敛为可扩展的表驱动结构（便于后续按 workflow 差异化）。 */
interface StageHandler {
  readonly name: Stage;
  canRun(run: RunState): boolean;
  execute(run: RunState, req: Requirement): Promise<StageOutcome>;
}

export class EngineRuntime {
  private runs = new Map<string, RunState>();
  private requirements = new Map<string, Requirement>();
  private listeners = new Set<(e: EngineEvent) => void>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private rehydrated = false;
  /** 在途运行集合：用于重入保护（已在跑的 run 忽略重复 start/resume）。 */
  private runningIds = new Set<string>();
  /** 幂等键 → runId 映射：createChange 携带 idempotencyKey 时复用既有 run，
   *  避免 REST 重放/重复提交产生重复变更（见 createChange）。 */
  private idempotencyKeys = new Map<string, string>();

  /** 阶段管线：有序阶段处理器集合（策略/管线模式）。runLoop 从 run.stage 命中的首个
   *  处理器起依次执行；execute 返回 "continue" 则贯穿下一阶段，与原 runLoop 的顺序
   *  fall-through 完全等价（design→build→verify）。arrow 仅在调用时读取 this，无字段初始化时序问题。 */
  private readonly stagePipeline: readonly StageHandler[] = [
    {
      name: "design",
      canRun: (run) => run.stage === "open" || run.stage === "design",
      execute: (run, req) => this.runDesignStage(run, req),
    },
    {
      name: "build",
      canRun: (run) => run.stage === "build",
      execute: (run) => this.runBuildStage(run),
    },
    {
      name: "verify",
      canRun: (run) => run.stage === "verify",
      execute: (run) => this.runVerifyStage(run),
    },
  ];

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
            // 优先用需求创建时刻快照（无损重建）；旧快照缺省时回退 run.createdAt（原行为）。
            createdAt: run.requirementCreatedAt ?? run.createdAt,
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
    this.publish();
    this.touch();
  }

  /** 把引擎内部状态收敛到统一 runtime store（双引擎合并的唯一监控表面）。 */
  private publish(): void {
    const runs = [...this.runs.values()];
    const state = buildEngineState(
      runs,
      [...this.requirements.values()],
      runs.filter((r) => r.status === "failed").length,
    );
    getEngineRuntimeStore().setSnapshot(state);
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      // 空闲超时：先 flush 全部在途运行态到磁盘（磁盘仍在，可恢复），再清空内存释放资源。
      this.flushAll();
      this.runs.clear();
      this.requirements.clear();
      this.listeners.clear();
      // 幂等键映射随内存 run 一并清空（内存清空后旧键必然失效，保留反会误命中已消失的 run）。
      this.idempotencyKeys.clear();
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
    // 幂等：携带 idempotencyKey 时，若此前已创建且 run 仍在内存，则直接复用（避免重放/重复提交）。
    if (input.idempotencyKey) {
      const existingId = this.idempotencyKeys.get(input.idempotencyKey);
      const existing = existingId ? this.runs.get(existingId) : undefined;
      if (existing) {
        return existing;
      }
      // 映射过期（空闲清空内存后 run 已不在）→ 清理后走正常创建路径。
      if (existingId) this.idempotencyKeys.delete(input.idempotencyKey);
    }

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
      requirementCreatedAt: req.createdAt,
      stage: "open",
      status: "idle",
      tasks: [],
      cwd: input.cwd,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(runId, run);
    if (input.idempotencyKey) {
      // 有界化：登记新键前先清理指向已被淘汰(cap 裁剪/淘汰)的失效键，
      // 防止映射随不同幂等键无限增长（键数收敛到当前在册 run 规模）。
      for (const [k, v] of this.idempotencyKeys) {
        if (!this.runs.has(v)) this.idempotencyKeys.delete(k);
      }
      this.idempotencyKeys.set(input.idempotencyKey, runId);
    }
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

  /** 统一自主编程循环（管线驱动）：以有序阶段管线串行推进 open→design→build→verify→archive。
   *  从 run.stage 命中的首个阶段起依次执行，处理器返回 "continue" 则贯穿下一阶段
   *  （保留原顺序 fall-through 语义），返回 pause/stop 则提前退出；阶段间做协同暂停检查。
   *  可断点续跑（依据 run.stage 跳过已完成阶段）。 */
  private async runLoop(run: RunState): Promise<void> {
    this.runningIds.add(run.runId);
    try {
      // 自愈：确保 change 目录与 .comet.yaml 存在。createChange 时若 comet init 失败
      // （如曾传非法 workflow、HMR 陈旧单例），run 仍会落盘并被重试；此处幂等补建，
      // 避免重试永远卡在 verify 守卫的 "change directory not found"。放在 req 检查之前。
      await this.selfHealChange(run);

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

      // 阶段管线：命中即执行；"continue" 贯穿下一阶段，"pause"/"stop" 退出。
      for (const handler of this.stagePipeline) {
        if (!handler.canRun(run)) continue;
        const outcome = await handler.execute(run, req);
        if (outcome !== "continue") return;
        // 阶段间协同暂停（对齐原 runLoop 各阶段块之间的 shouldPause）。
        if (await this.shouldPause(run)) return;
      }
    } catch (e) {
      this.failRun(run, `运行失败：${(e as Error).message}`);
    } finally {
      this.runningIds.delete(run.runId);
    }
  }

  /** 自愈：确保 change 目录与 .comet.yaml 存在（best-effort，失败降级内存态）。 */
  private async selfHealChange(run: RunState): Promise<void> {
    try {
      await this.wf.ensureChange(run.changeName, DEFAULT_WORKFLOW, run.cwd);
    } catch (e) {
      this.emit({
        type: "log",
        runId: run.runId,
        message: `change 目录自愈失败，降级为内存态：${(e as Error).message}`,
      });
    }
  }

  /** design 阶段：生成计划 + 拆解任务 + 写 build 交付物，推进 open→build。
   *  hotfix workflow 下 comet 无独立 design 阶段，计划生成属 open 阶段内容。 */
  private async runDesignStage(run: RunState, req: Requirement): Promise<StageOutcome> {
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
    if (await this.shouldPause(run)) return "pause";

    await this.planGen.prepareBuildDeliverables(plan.id, {
      cwd: run.cwd,
      changeName: run.changeName,
    });

    // 推进 comet phase: open → build（hotfix 直接到 build；full 到 design）。
    await this.safeAdvance(run, "open");
    if (await this.shouldPause(run)) return "pause";
    run.stage = "build";
    run.updatedAt = nowIso();
    this.persistRun(run);
    this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
    return "continue";
  }

  /** build 阶段：从 run.tasks 续跑未完成任务（断点续跑，跳过已完成项），推进至 verify。 */
  private async runBuildStage(run: RunState): Promise<StageOutcome> {
    run.stage = "build";
    run.updatedAt = nowIso();
    this.persistRun(run);
    log("info", "engine", `阶段切换：build`, { runId: run.runId });
    this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });

    for (const task of run.tasks) {
      if (task.status === "completed" || task.status === "failed" || task.status === "skipped") {
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
      if (await this.shouldPause(run)) return "pause";
    }
    run.stage = "verify";
    run.updatedAt = nowIso();
    this.persistRun(run);
    this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
    return "continue";
  }

  /** verify 阶段：comet build/verify 双守卫校验 + 推进，通过则收尾 archive/completed。
   *  单次读取 comet 阶段并全程复用，避免 safeGuard/safeAdvance 各自往返（原 2~4 次→1 次）。 */
  private async runVerifyStage(run: RunState): Promise<StageOutcome> {
    const cometPhase = await this.readCometPhase(run.changeName, run.cwd);
    const guardBuild = await this.safeGuard(run, "build", cometPhase);
    if (!guardBuild.passed) {
      this.failRun(run, guardBuild.message ?? "build 守卫未通过");
      this.emit({
        type: "guard",
        runId: run.runId,
        message: guardBuild.message,
        payload: guardBuild,
      });
      return "stop";
    }
    if (!(await this.safeAdvance(run, "build", cometPhase))) return "stop";

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

    const guardVerify = await this.safeGuard(run, "verify", cometPhase);
    if (!guardVerify.passed) {
      this.failRun(run, guardVerify.message ?? "verify 守卫未通过");
      this.emit({
        type: "guard",
        runId: run.runId,
        message: guardVerify.message,
        payload: guardVerify,
      });
      return "stop";
    }
    if (!(await this.safeAdvance(run, "verify", cometPhase))) return "stop";

    // archive
    run.stage = "archive";
    run.status = "completed";
    run.updatedAt = nowIso();
    this.persistRun(run);
    log("info", "engine", `运行完成`, { runId: run.runId });
    this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
    this.emit({ type: "run.updated", runId: run.runId, payload: run });
    return "continue";
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

  /** comet 守卫：守卫真实化（PRD FR-4 / V4）。
   *  仅当 comet 运行时本身未安装（不可用）才降级放行，保证引擎可演示；
   *  comet 已安装后，守卫语义失败（evaluateGuard 返回 passed:false）或调用异常，一律阻断，绝不静默通过。
   *  @param knownPhase 可选：调用方已读取的 comet 阶段，传入则复用避免重复往返。 */
  private async safeGuard(run: RunState, phase: Stage, knownPhase?: string | undefined) {
    if (!isCometAvailable()) {
      // comet 未安装：降级放行（守卫未实际执行），诚实标注以免误读为「已验证通过」。
      return {
        change: run.changeName,
        phase,
        passed: true,
        message: "comet 未安装，守卫降级放行（未执行实际检查）",
      };
    }
    try {
      // 先检查 comet 实际阶段：若已超越当前守卫阶段则直接放行（恢复场景自愈）。
      const cometPhase =
        knownPhase !== undefined ? knownPhase : await this.readCometPhase(run.changeName, run.cwd);
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
      // comet 已安装但守卫调用异常：视为守卫失败，阻断（不降级放行）。
      return {
        change: run.changeName,
        phase,
        passed: false,
        message: `comet 守卫执行异常，按失败处理：${(e as Error).message}`,
      };
    }
  }

  /** comet 推进：守卫真实化（PRD FR-4 / V4）。
   *  comet 未安装时内存推进（降级，保证可演示）；已安装时走真实 advanceStage，
   *  守卫阻止（advanceStage 抛错）必须 failRun 阻断，绝不回退为内存推进。
   *  @returns true=推进成功（含降级）；false=被守卫阻止导致 run 失败阻断。
   *  @param knownPhase 可选：调用方已读取的 comet 阶段，传入则复用避免重复往返。 */
  private async safeAdvance(
    run: RunState,
    phase: Stage,
    knownPhase?: string | undefined,
  ): Promise<boolean> {
    if (!isCometAvailable()) {
      // comet 未安装：内存推进降级（保持引擎可演示）。
      run.stage = nextStage(phase);
      run.updatedAt = nowIso();
      this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
      return true;
    }
    try {
      // 先检查 comet 实际阶段：若已超越当前阶段则跳过守卫推进（恢复/重跑自愈）。
      const cometPhase =
        knownPhase !== undefined ? knownPhase : await this.readCometPhase(run.changeName, run.cwd);
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
      run.updatedAt = nowIso();
      this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
      return true;
    } catch (e) {
      // comet 已安装但推进/守卫失败：必须阻断，绝不回退到内存推进。
      this.failRun(run, `阶段推进被守卫阻止：${(e as Error).message}`);
      return false;
    }
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
