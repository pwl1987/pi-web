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

  it("store 构造期不读 localStorage，hydrate() 后才恢复（模拟 F5 刷新，避免 hydration mismatch）", async () => {
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
    // 清除 globalThis 单例 + 重置模块缓存，强制下次 import 重新构造 store
    (globalThis as Record<string, unknown>).__piPlanModeStore = undefined;
    vi.resetModules();

    // 重新 import 拿到新的 store 实例
    const { getPlanModeStore: freshGet } = await import("@/lib/plan-mode-store");
    const freshStore = freshGet();
    // 构造期不读 localStorage：首帧应保持 EMPTY（与 SSR 一致，防 hydration mismatch）
    let state = freshStore.getState();
    expect(state.planMode).toBe(false);
    expect(state.orchestratorId).toBeNull();
    expect(state.planStatus).toBe("idle");

    // 显式 hydrate 后并入 localStorage 持久化字段（usePlanMode 的 useEffect 触发此路径）
    freshStore.hydrate();
    state = freshStore.getState();
    expect(state.planMode).toBe(true);
    expect(state.orchestratorId).toBe("orc-recovered");
    expect(state.planStatus).toBe("discussing");
    // 非持久化字段应保持默认值
    expect(state.requestOpenEngine).toBe(false);
  });

  it("getPlanModeStore 丢弃缺少 hydrate 的旧单例（HMR 热重载后旧实例被重建）", () => {
    // 模拟 HMR 前遗留的旧单例：缺 hydrate 方法（旧版 PlanModeStore）
    (globalThis as Record<string, unknown>).__piPlanModeStore = {
      hydrate: undefined,
      getSnapshot: () => 0,
      getState: () => ({ planMode: true }),
    };
    // getPlanModeStore 应检测到旧实例缺 hydrate 并重建
    const store = getPlanModeStore();
    expect(typeof store.hydrate).toBe("function");
    expect(store.getState().planMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PlanPanel SSE 对账 / 重连 / 终态守卫 行为测试
// 覆盖修复 1（components/PlanPanel.tsx 的 SSE useEffect 防御机制）：
//   - snapshot 首帧后渲染时间线（非骨架屏）
//   - 细粒度事件触发 refresh 兜底全量拉取
//   - done 事件直接更新快照并进入终态
//   - 终态后 SSE 关闭不重连（避免 404 风暴）
//   - 非终态 CLOSED 后 1s 手动重连
//   - 15s 对账轮询触发 refresh
// ---------------------------------------------------------------------------

/** 可控的 EventSource 桩：支持 readyState、onerror、手动派发消息、CLOSED 触发重连检测。 */
class ControllableES {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = ControllableES.OPEN;
  url: string;
  closed = false;
  instances: ControllableES[];
  constructor(url: string) {
    this.url = url;
    this.instances = getESInstances();
    this.instances.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = ControllableES.CLOSED;
  }
  /** 测试侧手动派发一条 SSE 消息。 */
  emit(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  /** 测试侧触发 onerror，可选设置 readyState。 */
  fail(readyState?: number) {
    if (readyState !== undefined) this.readyState = readyState;
    this.onerror?.();
  }
}

/** 读取当前测试收集到的 EventSource 实例列表（用 unknown 二次断言规避 TS2352）。 */
function getESInstances(): ControllableES[] {
  return (globalThis as unknown as { __esInstances?: ControllableES[] }).__esInstances ?? [];
}

describe("PlanPanel SSE 对账与重连", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getPlanModeStore().reset();
    setPlanMode(true);
    (globalThis as unknown as { __esInstances: ControllableES[] }).__esInstances = [];
    vi.stubGlobal("EventSource", ControllableES);
    vi.stubGlobal("EventSourceClosed", ControllableES.CLOSED);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    getPlanModeStore().reset();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** 构造一个最小可渲染的 OrchestrationSnapshot。 */
  function makeSnapshot(overrides: Partial<Record<string, unknown>> = {}): unknown {
    return {
      id: "orc-sse",
      status: "discussing",
      requirement: "测试需求",
      agents: [],
      rounds: [],
      messages: [],
      plans: [],
      tasks: [],
      selectedPlanId: null,
      convergence: { converged: false, reason: "none" },
      control: undefined,
      config: { maxRounds: 4 },
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  it("snapshot 首帧后渲染讨论时间线（不再是骨架屏）", async () => {
    const { render } = await import("@testing-library/react");
    setOrchestratorId("orc-sse");
    const { container } = render(<PlanPanel />);
    // 首帧：snapshot 未到，显示骨架（skeleton class）
    expect(container.querySelector(".skeleton")).toBeTruthy();

    // SSE 首帧推送 snapshot
    await vi.waitFor(() => {
      expect(getESInstances()).toHaveLength(1);
    });
    const es = getESInstances()[0];
    es.emit({ type: "snapshot", snapshot: makeSnapshot({ status: "discussing" }) });

    // snapshot 到达后：骨架消失，状态条显示 discussing 文案，退出按钮可点
    await vi.waitFor(() => {
      expect(container.querySelector(".skeleton")).toBeNull();
      expect(screen.getAllByText(/plan\.discussing/).length).toBeGreaterThan(0);
      expect(container.querySelector('[title="plan.exit"]')).toBeTruthy();
    });
  });

  it("细粒度事件（message）触发 refresh 兜底全量拉取", async () => {
    const mockCsrf = await import("@/lib/csrf-fetch");
    // snapshot 首帧 + 后续 GET /api/plan/[id] 返回 awaiting_confirm 快照（带 plans 渲染）
    const freshSnapshot = makeSnapshot({
      status: "awaiting_confirm",
      requirement: "对账后的需求",
      plans: [
        {
          id: "p1",
          title: "方案A",
          summary: "s",
          confidence: 0.9,
          pros: [],
          cons: [],
          scenarios: [],
        },
      ],
    });
    const fetchSpy = vi.mocked(mockCsrf.csrfFetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: freshSnapshot,
    });

    const { render } = await import("@testing-library/react");
    setOrchestratorId("orc-sse");
    render(<PlanPanel />);

    await vi.waitFor(() => {
      expect(getESInstances()).toHaveLength(1);
    });
    const es = getESInstances()[0];
    // 先推 snapshot 建立基线（discussing，无 plans）
    es.emit({ type: "snapshot", snapshot: makeSnapshot({ status: "discussing" }) });

    // 记录 refresh 前对 /api/plan/orc-sse 的 GET 调用数
    const planGetCallsBefore = fetchSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0] === "/api/plan/orc-sse",
    ).length;

    // 推一条细粒度 message 事件 → 应触发 refresh（GET /api/plan/orc-sse）
    es.emit({ type: "message", message: { id: "m1" }, at: 1 });

    // refresh 拉回 awaiting_confirm 快照，渲染方案卡「方案A」
    await vi.waitFor(() => {
      expect(screen.getByText("方案A")).toBeTruthy();
      const planGetCallsAfter = fetchSpy.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0] === "/api/plan/orc-sse",
      ).length;
      expect(planGetCallsAfter).toBeGreaterThan(planGetCallsBefore);
    });
  });

  it("done 事件直接更新快照并标记终态", async () => {
    const { render } = await import("@testing-library/react");
    setOrchestratorId("orc-sse");
    render(<PlanPanel />);

    await vi.waitFor(() => {
      expect(getESInstances()).toHaveLength(1);
    });
    const es = getESInstances()[0];
    es.emit({ type: "snapshot", snapshot: makeSnapshot({ status: "awaiting_confirm" }) });

    // done 事件携带终态快照
    es.emit({
      type: "done",
      snapshot: makeSnapshot({ status: "done" }),
      at: 2,
    });

    // planStatus 应被同步为 done（store 层面可查）
    await vi.waitFor(() => {
      expect(getPlanModeStore().getState().planStatus).toBe("done");
    });
  });

  it("终态后 SSE CLOSED 不重连（避免对已结束编排器触发 404）", async () => {
    const { render } = await import("@testing-library/react");
    setOrchestratorId("orc-sse");
    render(<PlanPanel />);

    await vi.waitFor(() => {
      expect(getESInstances()).toHaveLength(1);
    });
    const es = getESInstances()[0];
    // 进入终态
    es.emit({ type: "snapshot", snapshot: makeSnapshot({ status: "done" }) });
    await vi.waitFor(() => {
      expect(getPlanModeStore().getState().planStatus).toBe("done");
    });

    const instancesBefore = getESInstances().length;
    // 模拟服务端关闭流 + onerror
    es.fail(ControllableES.CLOSED);
    // 快进超过重连延迟
    vi.advanceTimersByTime(2000);

    // 不应新建 EventSource（无重连）
    const instancesAfter = getESInstances().length;
    expect(instancesAfter).toBe(instancesBefore);
  });

  it("非终态 CLOSED 后 1 秒手动重连（新建 EventSource）", async () => {
    const { render } = await import("@testing-library/react");
    setOrchestratorId("orc-sse");
    render(<PlanPanel />);

    await vi.waitFor(() => {
      expect(getESInstances()).toHaveLength(1);
    });
    const es = getESInstances()[0];
    // 非终态快照
    es.emit({ type: "snapshot", snapshot: makeSnapshot({ status: "discussing" }) });

    // 模拟流被关闭（非终态）
    es.fail(ControllableES.CLOSED);
    // 快进 1s+ 触发重连
    vi.advanceTimersByTime(1100);

    await vi.waitFor(() => {
      // 应新建第二个 EventSource（重连）
      expect(getESInstances()).toHaveLength(2);
    });
  });

  it("15 秒对账轮询触发 refresh（兜底漏事件）", async () => {
    const mockCsrf = await import("@/lib/csrf-fetch");
    const refreshedSnapshot = makeSnapshot({ status: "discussing", requirement: "对账后的需求" });
    const fetchSpy = vi.mocked(mockCsrf.csrfFetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: refreshedSnapshot,
    });

    const { render } = await import("@testing-library/react");
    setOrchestratorId("orc-sse");
    render(<PlanPanel />);

    await vi.waitFor(() => {
      expect(getESInstances()).toHaveLength(1);
    });
    const es = getESInstances()[0];
    es.emit({ type: "snapshot", snapshot: makeSnapshot({ status: "discussing" }) });

    // 记录对账前的 GET 调用数
    const callsBeforeReconcile = fetchSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0] === "/api/plan/orc-sse",
    ).length;

    // 快进 16 秒触发对账轮询
    vi.advanceTimersByTime(16_000);

    await vi.waitFor(() => {
      const callsAfter = fetchSpy.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0] === "/api/plan/orc-sse",
      ).length;
      expect(callsAfter).toBeGreaterThan(callsBeforeReconcile);
    });
  });

  it("A 终态后切换到 B，B 应能建立 SSE 连接（statusRef 必须重置）", async () => {
    const { render } = await import("@testing-library/react");
    setOrchestratorId("orc-A");
    const { rerender } = render(<PlanPanel />);

    await vi.waitFor(() => {
      expect(getESInstances()).toHaveLength(1);
    });
    const esA = getESInstances()[0];
    // A 进入终态
    esA.emit({ type: "snapshot", snapshot: makeSnapshot({ id: "orc-A", status: "done" }) });
    await vi.waitFor(() => {
      expect(getPlanModeStore().getState().planStatus).toBe("done");
    });

    // 切换到讨论 B
    setOrchestratorId("orc-B");
    rerender(<PlanPanel />);

    // B 应建立新的 SSE 连接（实例数 >= 2）
    await vi.waitFor(() => {
      expect(getESInstances().length).toBeGreaterThanOrEqual(2);
    });
  });
});

// —— 双模式确认：自主编程引擎 vs 普通模式 ——
// 独立 describe 块（真实 timers），避免与 SSE 块的 fake timers 冲突。
describe("PlanPanel 双模式确认（engine / plan）", () => {
  beforeEach(async () => {
    getPlanModeStore().reset();
    setPlanMode(true);
    (globalThis as unknown as { __esInstances: ControllableES[] }).__esInstances = [];
    vi.stubGlobal("EventSource", ControllableES);
    vi.stubGlobal("EventSourceClosed", ControllableES.CLOSED);
    // 清理共享 csrfFetchJson mock 的调用记录与返回值，避免跨用例污染。
    const mockCsrf = await import("@/lib/csrf-fetch");
    vi.mocked(mockCsrf.csrfFetchJson).mockClear();
    vi.mocked(mockCsrf.csrfFetchJson).mockResolvedValue({ ok: true, status: 200, data: {} });
  });

  afterEach(() => {
    cleanup();
    getPlanModeStore().reset();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  function makeAwaitingSnapshot(selectedPlanId = "p1"): unknown {
    return {
      id: "orc-sse",
      status: "awaiting_confirm",
      requirement: "测试需求",
      agents: [],
      rounds: [],
      messages: [],
      plans: [
        {
          id: "p1",
          title: "方案A",
          summary: "s",
          confidence: 0.9,
          pros: [],
          cons: [],
          scenarios: [],
        },
      ],
      tasks: [],
      selectedPlanId,
      convergence: { converged: false, reason: "none" },
      control: undefined,
      config: { maxRounds: 4 },
      updatedAt: Date.now(),
    };
  }

  it("awaiting_confirm 选中方案后渲染「引擎 / 普通」两个模式按钮", async () => {
    const { render } = await import("@testing-library/react");
    setOrchestratorId("orc-sse");
    render(<PlanPanel />);

    await vi.waitFor(() => {
      expect(getESInstances()).toHaveLength(1);
    });
    const es = getESInstances()[0];
    es.emit({ type: "snapshot", snapshot: makeAwaitingSnapshot("p1") });

    await vi.waitFor(() => {
      // i18n mock 返回键名，故按 plan.modeEngine / plan.modePlan 查找。
      expect(screen.getByRole("button", { name: /plan\.modeEngine/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: /plan\.modePlan/ })).toBeTruthy();
    });
  });

  it("点击「普通模式」：confirm 带 mode=plan，不触发 requestOpenEngine", async () => {
    const mockCsrf = await import("@/lib/csrf-fetch");
    vi.mocked(mockCsrf.csrfFetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true, mode: "plan", docPath: "/tmp/proj/docs/plans/方案A.md" },
    });

    const { render } = await import("@testing-library/react");
    setOrchestratorId("orc-sse");
    render(<PlanPanel />);

    await vi.waitFor(() => {
      expect(getESInstances()).toHaveLength(1);
    });
    const es = getESInstances()[0];
    es.emit({ type: "snapshot", snapshot: makeAwaitingSnapshot("p1") });

    const planBtn = await screen.findByRole("button", { name: /plan\.modePlan/ });
    fireEvent.click(planBtn);

    // confirm 调用应含 mode: "plan"
    await vi.waitFor(() => {
      const confirmCall = vi
        .mocked(mockCsrf.csrfFetchJson)
        .mock.calls.find((c) => typeof c[0] === "string" && c[0].endsWith("/confirm"));
      if (!confirmCall) throw new Error("confirm 未被调用");
      const body = confirmCall[1]?.body as Record<string, unknown> | undefined;
      expect(body?.mode).toBe("plan");
    });
    // 普通模式不应打开引擎面板
    expect(getPlanModeStore().getState().requestOpenEngine).toBe(false);
  });

  it("点击「引擎模式」：confirm 带 mode=engine 且触发 requestOpenEngine", async () => {
    const mockCsrf = await import("@/lib/csrf-fetch");
    vi.mocked(mockCsrf.csrfFetchJson).mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true, mode: "engine", runId: "r1", status: "running", docPath: "/tmp/p.md" },
    });

    const { render } = await import("@testing-library/react");
    setOrchestratorId("orc-sse");
    render(<PlanPanel />);

    await vi.waitFor(() => {
      expect(getESInstances()).toHaveLength(1);
    });
    const es = getESInstances()[0];
    es.emit({ type: "snapshot", snapshot: makeAwaitingSnapshot("p1") });

    const engineBtn = await screen.findByRole("button", { name: /plan\.modeEngine/ });
    fireEvent.click(engineBtn);

    await vi.waitFor(() => {
      const confirmCall = vi
        .mocked(mockCsrf.csrfFetchJson)
        .mock.calls.find((c) => typeof c[0] === "string" && c[0].endsWith("/confirm"));
      if (!confirmCall) throw new Error("confirm 未被调用");
      const body = confirmCall[1]?.body as Record<string, unknown> | undefined;
      expect(body?.mode).toBe("engine");
      // 引擎模式应打开引擎面板
      expect(getPlanModeStore().getState().requestOpenEngine).toBe(true);
    });
  });
});
