// 融合引擎领域类型（统一 autoplan 计划语义与 comet 状态机语义）
// 业务层只依赖这些类型，不感知上游差异。

export type Stage = "open" | "design" | "build" | "verify" | "archive";

export const STAGES: readonly Stage[] = ["open", "design", "build", "verify", "archive"];

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
  workflow: string;
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
