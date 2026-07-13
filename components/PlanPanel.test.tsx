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
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

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

describe("PlanPanel 刷新后持久化历史恢复", () => {
  beforeEach(() => {
    getPlanModeStore().reset();
    setPlanMode(true);
  });

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

  it("刷新后引导界面自动列出服务端非终态历史（csrFetchJson 返回 awaiting_confirm + discussing）", async () => {
    const mockCsrf = await import("@/lib/csrf-fetch");
    vi.mocked(mockCsrf.csrfFetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        orchestrations: [
          {
            id: "orch-a",
            status: "awaiting_confirm",
            requirement: "暗色模式支持",
            roundCount: 2,
            updatedAt: 1,
          },
          {
            id: "orch-b",
            status: "discussing",
            requirement: "性能优化方案",
            roundCount: 1,
            updatedAt: 2,
          },
        ],
      },
    } as never);

    render(<PlanPanel />);

    await waitFor(() => {
      expect(screen.getByText("暗色模式支持")).toBeTruthy();
    });
    expect(screen.getByText("性能优化方案")).toBeTruthy();

    // 两个"继续该讨论"按钮
    const resumeBtns = screen.getAllByRole("button", { name: "plan.continueThis" });
    expect(resumeBtns.length).toBe(2);
  });

  it("点击「继续该讨论」设置 orchestratorId（触发后续 SSE 自动 rehydrate）", async () => {
    const mockCsrf = await import("@/lib/csrf-fetch");
    vi.mocked(mockCsrf.csrfFetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        orchestrations: [
          {
            id: "orch-recover",
            status: "awaiting_confirm",
            requirement: "重构计划",
            roundCount: 3,
            updatedAt: 1,
          },
        ],
      },
    } as never);

    render(<PlanPanel />);

    const btn = await screen.findByRole("button", { name: "plan.continueThis" });
    fireEvent.click(btn);

    // 点击后 orchestratorId 被设置
    expect(getPlanModeStore().getState().orchestratorId).toBe("orch-recover");
    // resumableOrchestratorId 应在 discardResumable 后为空
    expect(getPlanModeStore().getState().resumableOrchestratorId).toBeNull();
  });

  it("终态讨论（done/failed/cancelled）不显示在恢复入口", async () => {
    const mockCsrf = await import("@/lib/csrf-fetch");
    vi.mocked(mockCsrf.csrfFetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        orchestrations: [
          {
            id: "orch-done",
            status: "done",
            requirement: "已完成讨论",
            roundCount: 3,
            updatedAt: 1,
          },
          {
            id: "orch-failed",
            status: "failed",
            requirement: "失败讨论",
            roundCount: 1,
            updatedAt: 2,
          },
          {
            id: "orch-cancelled",
            status: "cancelled",
            requirement: "取消讨论",
            roundCount: 2,
            updatedAt: 3,
          },
        ],
      },
    } as never);

    render(<PlanPanel />);

    // 等待 fetch 完成
    await vi.waitFor(
      () => {
        // 终态不应渲染任何 continueThis 按钮
        expect(screen.queryByRole("button", { name: "plan.continueThis" })).toBeNull();
      },
      { timeout: 2000 },
    );

    expect(screen.queryByText("已完成讨论")).toBeNull();
    expect(screen.queryByText("失败讨论")).toBeNull();
    expect(screen.queryByText("取消讨论")).toBeNull();
  });

  it("resumableOrchestratorId 与历史卡片去重：同一条讨论不重复显示", async () => {
    // stashResumable 暂存 orch-x
    setOrchestratorId("orch-x");
    stashResumable();

    const mockCsrf = await import("@/lib/csrf-fetch");
    vi.mocked(mockCsrf.csrfFetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        orchestrations: [
          {
            id: "orch-x",
            status: "awaiting_confirm",
            requirement: "与暂存相同的讨论",
            roundCount: 1,
            updatedAt: 1,
          },
          {
            id: "orch-y",
            status: "discussing",
            requirement: "另一条非终态讨论",
            roundCount: 2,
            updatedAt: 2,
          },
        ],
      },
    } as never);

    render(<PlanPanel />);

    // stash 的 resumeHint 卡片仅显示一次
    expect(screen.getByText("plan.resumeHint")).toBeTruthy();
    // stash 卡片里有"继续上次讨论"按钮
    expect(screen.getByRole("button", { name: "plan.resume" })).toBeTruthy();

    await waitFor(() => {
      // 非终态历史中只出现 orch-y（orch-x 已被 resumableOrchestratorId 卡片覆盖，去重）
      expect(screen.getByText("另一条非终态讨论")).toBeTruthy();
    });
    // orch-x 的 requirement 不应在非终态历史卡片中出现
    expect(screen.queryByText("与暂存相同的讨论")).toBeNull();

    // continueThis 按钮应只有 1 个（orch-y），orch-x 走 resumeHint 路径
    const continueBtns = screen.getAllByRole("button", { name: "plan.continueThis" });
    expect(continueBtns.length).toBe(1);
  });
});

describe("plan-mode-store localStorage 持久化", () => {
  beforeEach(() => {
    localStorage.clear();
    getPlanModeStore().reset();
  });

  afterEach(() => {
    localStorage.clear();
    getPlanModeStore().reset();
  });

  it("setOrchestratorId / setPlanMode 后写入 localStorage（刷新可恢复）", () => {
    setOrchestratorId("orc-persist-1");
    setPlanMode(true);
    const raw = localStorage.getItem("pi-plan-mode");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    expect(parsed.orchestratorId).toBe("orc-persist-1");
    expect(parsed.planMode).toBe(true);
  });

  it("stashResumable 把 orchestratorId 移到 resumableOrchestratorId 并持久化", () => {
    setOrchestratorId("orc-persist-2");
    stashResumable();
    const parsed = JSON.parse(localStorage.getItem("pi-plan-mode") ?? "{}") as Record<
      string,
      unknown
    >;
    expect(parsed.orchestratorId).toBeNull();
    expect(parsed.resumableOrchestratorId).toBe("orc-persist-2");
  });

  it("reset 清空 localStorage（确认/放弃后不再恢复）", () => {
    setOrchestratorId("orc-persist-3");
    expect(localStorage.getItem("pi-plan-mode")).not.toBeNull();
    getPlanModeStore().reset();
    expect(localStorage.getItem("pi-plan-mode")).toBeNull();
    expect(getPlanModeStore().getState().orchestratorId).toBeNull();
  });

  it("store 首次构造时从 localStorage 恢复（模拟 F5 刷新）", async () => {
    // 模拟刷新前写入的持久化状态
    localStorage.setItem(
      "pi-plan-mode",
      JSON.stringify({
        planMode: true,
        orchestratorId: "orc-recovered",
        resumableOrchestratorId: null,
        planStatus: "discussing",
      }),
    );
    // 清除 globalThis 单例 + 重置模块缓存，强制下次 import 重新构造 store 并 hydrate
    (globalThis as Record<string, unknown>).__piPlanModeStore = undefined;
    vi.resetModules();

    // 重新 import 拿到新的 store 实例（构造时触发 hydrateFromStorage）
    const { getPlanModeStore: freshGet } = await import("@/lib/plan-mode-store");
    const state = freshGet().getState();
    expect(state.planMode).toBe(true);
    expect(state.orchestratorId).toBe("orc-recovered");
    expect(state.planStatus).toBe("discussing");
    // 非持久化字段应保持默认值
    expect(state.requestOpenEngine).toBe(false);
  });
});
