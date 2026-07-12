// WorkflowStateMachinePort —— comet 侧能力端口
// 仅暴露"状态机/守卫/恢复"语义，具体实现由 comet-adapter 唯一经 child_process 调用 vendor/comet .mjs。
// 注意：comet 是 prompt+CLI 驱动，所有方法最终 spawn 白名单内的 .mjs 脚本（cwd=项目根）。
import type { ChangeState, Stage, StageEvent, GuardResult } from "./unified-engine-types";

export interface WorkflowStateMachinePort {
  /** 打开一个可恢复 change（等价于 comet-state.mjs init） */
  readonly openChange: (changeName: string, workflow: string, cwd: string) => Promise<ChangeState>;
  /** 读取 change 当前状态 */
  readonly getState: (changeName: string, cwd: string) => Promise<ChangeState>;
  /** 推进阶段（等价于 comet-guard.mjs <change> <phase> --apply） */
  readonly advanceStage: (changeName: string, phase: Stage, cwd: string) => Promise<StageEvent>;
  /** 仅校验守卫不推进（等价于 comet-guard.mjs <change> <phase>） */
  readonly evaluateGuard: (changeName: string, phase: Stage, cwd: string) => Promise<GuardResult>;
  /** 由磁盘状态恢复 change（读取 .comet.yaml + run-state.json） */
  readonly resumeRun: (changeName: string, cwd: string) => Promise<ChangeState>;
}
