// 融合引擎领域类型（统一 autoplan 计划语义与 comet 状态机语义）
// 业务层只依赖这些类型，不感知上游差异。

export type Stage = "open" | "design" | "build" | "verify" | "archive";

export const STAGES: readonly Stage[] = ["open", "design", "build", "verify", "archive"];

/** comet 工作流预设。vendor/comet 的 init 命令仅接受这三个值（PROFILES），
 *  传其它值（如 'classic'）会被 validateEnum 拒绝，导致 .comet.yaml 不创建、
 *  后续 guard 报 "change directory not found"。
 *  - full：完整五阶段，非预设，build_mode/tdd_mode/isolation/verify_mode 全 null，
 *          需用户在 build 阶段逐项配置——guard 会检查这些字段，自动化引擎难以满足。
 *  - hotfix：精简预设，init 自动设 build_mode=direct/tdd_mode=direct/isolation=branch/
 *          verify_mode=light/review_mode=off，跳过这四项 guard 检查。pi-web 融合引擎
 *          的 autoplan 桩实现走 hotfix，仅需产出 proposal.md/tasks.md 即可通过 build 守卫。
 *  - tweak：另一精简预设，语义类似 hotfix。 */
export type Workflow = "full" | "hotfix" | "tweak";

export const DEFAULT_WORKFLOW: Workflow = "hotfix";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type RunStatus = "idle" | "running" | "paused" | "completed" | "failed";

export interface RequirementInput {
  title: string;
  description?: string;
  cwd?: string;
}

export interface Requirement {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
}

export interface Plan {
  id: string;
  requirementId: string;
  title: string;
  spec: string;
  createdAt: string;
}

export interface Task {
  id: string;
  planId: string;
  title: string;
  status: TaskStatus;
  retries: number;
  result?: string;
  backtrace?: string[];
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  output?: string;
}

export interface ChangeState {
  name: string;
  workflow: Workflow;
  phase: Stage;
  runId?: string;
  verifyResult?: string;
}

export interface StageEvent {
  change: string;
  from: Stage;
  to: Stage;
  event: string;
  at: string;
}

export interface GuardResult {
  change: string;
  phase: Stage;
  passed: boolean;
  message?: string;
}

export interface RunContext {
  cwd: string;
  changeName: string;
}

export interface RunState {
  runId: string;
  changeName: string;
  requirementId: string;
  title: string;
  planId?: string;
  stage: Stage;
  status: RunStatus;
  tasks: Task[];
  cwd: string;
  createdAt: string;
  updatedAt: string;
  /** 需求描述快照。requirements 仅存内存，进程重启后丢失；把 description 随 run 落盘，
   *  ensureRehydrated 时才能重建 Requirement 供 runLoop 调 generatePlan，否则 runLoop
   *  因 !req 直接 failed（表现为"启动运行"后无任何阶段日志即失败）。 */
  requirementDescription?: string;
}

export interface ChangeInput {
  title: string;
  description?: string;
  cwd: string;
}

export interface EngineEvent {
  type: "run.created" | "run.updated" | "stage.changed" | "task.updated" | "guard" | "log";
  runId: string;
  at: string;
  message?: string;
  payload?: unknown;
}
