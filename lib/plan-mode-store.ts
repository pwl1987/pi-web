// Plan 模式共享 store —— 跨 ChatInput / PlanPanel / AppShell 的全局状态。
// 采用 useSyncExternalStore + globalThis 单例（与 lib/agent-runtime-store 同范式），
// 使计划模式开关、当前讨论编排器 id、以及「确认后跳转引擎面板」信号可被任意组件读取。

"use client";

import { useSyncExternalStore } from "react";

export type ControllerMode = "hybrid" | "deterministic" | "llm";

/** 计划讨论的可配置项（发起讨论时随 orchestrate 请求体下发给后端）。 */
export interface PlanConfigSlice {
  controllerMode: ControllerMode;
  maxRounds: number;
  stabilizeThreshold: number;
  concurrency: number;
}

export const DEFAULT_PLAN_CONFIG: PlanConfigSlice = {
  controllerMode: "hybrid",
  maxRounds: 4,
  stabilizeThreshold: 0.85,
  concurrency: 1,
};

export interface PlanModeSnapshot {
  /** 是否处于计划模式（讨论模式） */
  planMode: boolean;
  /** 当前讨论编排器 id（null 表示尚未开始讨论） */
  orchestratorId: string | null;
  /** 可恢复的编排器 id：用户退出计划模式时，未完成讨论的编排器 id 暂存于此。
   *  再次进入计划模式时，PlanPanel 引导界面据此显示「继续上次讨论 / 新建讨论」入口。
   *  与 orchestratorId 互斥：退出 → orchestratorId 清空、resumableOrchestratorId 置位；
   *  恢复 → resumableOrchestratorId 移回 orchestratorId 并清空；新建 → 直接清空 resumableOrchestratorId。 */
  resumableOrchestratorId: string | null;
  /** 讨论编排器的当前状态（idle/parsing/discussing/synthesizing/awaiting_confirm/executing/done/failed/cancelled）。
   *  供输入框判断「无激活讨论 → 发起」或「等待确认 → 反馈重议」。 */
  planStatus: string;
  /** 请求 AppShell 打开引擎面板的信号（确认方案后由 PlanPanel 置位） */
  requestOpenEngine: boolean;
  /** 计划讨论配置（总控模式 / 轮次上限 / 收敛阈值 / 并发度） */
  planConfig: PlanConfigSlice;
}

const EMPTY: PlanModeSnapshot = {
  planMode: false,
  orchestratorId: null,
  resumableOrchestratorId: null,
  planStatus: "idle",
  requestOpenEngine: false,
  planConfig: { ...DEFAULT_PLAN_CONFIG },
};

class PlanModeStore {
  private snapshot: PlanModeSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): number => this.version;
  getState = (): PlanModeSnapshot => this.snapshot;

  update(patch: Partial<PlanModeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.version++;
    this.listeners.forEach((cb) => cb());
  }

  reset(): void {
    this.snapshot = EMPTY;
    this.version++;
    this.listeners.forEach((cb) => cb());
  }
}

declare global {
  var __piPlanModeStore: PlanModeStore | undefined;
}

export function getPlanModeStore(): PlanModeStore {
  if (!globalThis.__piPlanModeStore) globalThis.__piPlanModeStore = new PlanModeStore();
  return globalThis.__piPlanModeStore;
}

export function usePlanMode(): PlanModeSnapshot {
  const store = getPlanModeStore();
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return store.getState();
}

// 命令式操作（非 React 组件内调用）。
export function setPlanMode(v: boolean): void {
  getPlanModeStore().update({ planMode: v });
}
export function setOrchestratorId(id: string | null): void {
  getPlanModeStore().update({ orchestratorId: id });
}
/**
 * 退出计划模式时暂存当前编排器 id，使其可被恢复。
 * 内部读取当前 orchestratorId（无参形式，消除调用方闭包陈旧风险），
 * orchestratorId 清空（退出当前讨论的活跃态），resumableOrchestratorId 置位。
 * 保留 planStatus 以便恢复后输入框判断交互方式。
 */
export function stashResumable(): void {
  const store = getPlanModeStore();
  const id = store.getState().orchestratorId;
  store.update({
    orchestratorId: null,
    resumableOrchestratorId: id,
  });
}
/**
 * 恢复上次未完成的讨论：把暂存的编排器 id 移回 orchestratorId，触发 PlanPanel 的 SSE 重连。
 * 同时清空 resumableOrchestratorId，避免重复恢复。
 */
export function resumeOrchestrator(): void {
  const store = getPlanModeStore();
  const id = store.getState().resumableOrchestratorId;
  if (!id) return;
  store.update({ orchestratorId: id, resumableOrchestratorId: null });
}
/** 放弃可恢复的讨论，清空暂存 id，回到干净的新建状态。 */
export function discardResumable(): void {
  getPlanModeStore().update({ resumableOrchestratorId: null });
}
export function setPlanStatus(status: string): void {
  getPlanModeStore().update({ planStatus: status });
}
export function requestOpenEngine(v: boolean): void {
  getPlanModeStore().update({ requestOpenEngine: v });
}
export function setPlanConfig(patch: Partial<PlanConfigSlice>): void {
  const store = getPlanModeStore();
  store.update({ planConfig: { ...store.getState().planConfig, ...patch } });
}
