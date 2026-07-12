// Plan 模式共享 store —— 跨 ChatInput / PlanPanel / AppShell 的全局状态。
// 采用 useSyncExternalStore + globalThis 单例（与 lib/agent-runtime-store 同范式），
// 使计划模式开关、当前讨论编排器 id、以及「确认后跳转引擎面板」信号可被任意组件读取。

"use client";

import { useSyncExternalStore } from "react";

export interface PlanModeSnapshot {
  /** 是否处于计划模式（讨论模式） */
  planMode: boolean;
  /** 当前讨论编排器 id（null 表示尚未开始讨论） */
  orchestratorId: string | null;
  /** 请求 AppShell 打开引擎面板的信号（确认方案后由 PlanPanel 置位） */
  requestOpenEngine: boolean;
}

const EMPTY: PlanModeSnapshot = {
  planMode: false,
  orchestratorId: null,
  requestOpenEngine: false,
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
export function requestOpenEngine(v: boolean): void {
  getPlanModeStore().update({ requestOpenEngine: v });
}
