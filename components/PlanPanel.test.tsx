/**
 * PlanPanel 恢复入口逻辑测试：
 *   - 退出计划模式时未完成讨论的编排器 id 会被暂存（resumableOrchestratorId）；
 *   - 再次进入计划模式，引导界面据此显示「继续上次讨论 / 放弃并新建」两个入口；
 *   - 点击「继续」→ resumeOrchestrator 把暂存 id 移回 orchestratorId（触发 SSE 重连）；
 *   - 点击「放弃并新建」→ discardResumable 清空暂存 id。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "zh" }),
}));

// csrfFetchJson 在引导界面（无 orchestratorId）路径下不会被调用，
// 但 PlanPanel 顶层 useEffect 会 fetch 模型/角色/配置，mock 成空数据避免告警。
vi.mock("@/lib/csrf-fetch", () => ({
  csrfFetchJson: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
}));

import {
  getPlanModeStore,
  setPlanMode,
  setOrchestratorId,
  stashResumable,
  resumeOrchestrator,
  discardResumable,
} from "@/lib/plan-mode-store";
import { PlanPanel } from "./PlanPanel";

describe("PlanPanel resume entry", () => {
  beforeEach(() => {
    getPlanModeStore().reset();
    setPlanMode(true);
  });

  // jsdom 无 EventSource，resumeOrchestrator 会把 orchestratorId 移回非空，
  // 触发 PlanPanel 的 SSE useEffect。用构造函数桩避免报错。
  const esStub = {
    onmessage: null as null | ((ev: { data: string }) => void),
    close: vi.fn(),
  };
  function EventSourceStub() {
    return esStub;
  }
  vi.stubGlobal("EventSource", EventSourceStub);

  afterEach(() => {
    cleanup();
    getPlanModeStore().reset();
  });

  it("无可恢复讨论时：引导界面不显示继续/放弃按钮", () => {
    render(<PlanPanel />);
    // 引导提示存在
    expect(screen.getByText("plan.enterHint")).toBeTruthy();
    // 恢复入口不存在
    expect(screen.queryByText("plan.resume")).toBeNull();
    expect(screen.queryByText("plan.discardAndNew")).toBeNull();
  });

  it("存在可恢复讨论时：显示继续上次讨论 / 放弃并新建 两个入口", () => {
    setOrchestratorId("orc-stale");
    stashResumable();
    render(<PlanPanel />);
    expect(screen.getByText("plan.resumeHint")).toBeTruthy();
    expect(screen.getByRole("button", { name: "plan.resume" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "plan.discardAndNew" })).toBeTruthy();
  });

  it("点击「继续上次讨论」：暂存 id 移回 orchestratorId，引导界面不再显示恢复入口", () => {
    setOrchestratorId("orc-stale");
    stashResumable();
    render(<PlanPanel />);
    fireEvent.click(screen.getByRole("button", { name: "plan.resume" }));
    // resumeOrchestrator 已把 id 移回 orchestratorId，resumableOrchestratorId 清空。
    const state = getPlanModeStore().getState();
    expect(state.orchestratorId).toBe("orc-stale");
    expect(state.resumableOrchestratorId).toBeNull();
  });

  it("点击「放弃并新建」：暂存 id 被清空，orchestratorId 仍为 null", () => {
    setOrchestratorId("orc-stale");
    stashResumable();
    render(<PlanPanel />);
    fireEvent.click(screen.getByRole("button", { name: "plan.discardAndNew" }));
    const state = getPlanModeStore().getState();
    expect(state.orchestratorId).toBeNull();
    expect(state.resumableOrchestratorId).toBeNull();
  });

  it("store helper 直接验证：resumeOrchestrator 在无暂存时为空操作", () => {
    // 无暂存 id 时调用 resume 不应抛错也不改变状态。
    expect(() => resumeOrchestrator()).not.toThrow();
    expect(getPlanModeStore().getState().orchestratorId).toBeNull();
  });

  it("store helper 直接验证：discardResumable 清空暂存 id", () => {
    setOrchestratorId("orc-a");
    stashResumable();
    expect(getPlanModeStore().getState().resumableOrchestratorId).toBe("orc-a");
    discardResumable();
    expect(getPlanModeStore().getState().resumableOrchestratorId).toBeNull();
  });
});
