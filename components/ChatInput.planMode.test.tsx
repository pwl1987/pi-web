/**
 * 计划模式与普通模式解耦验证：
 *   1. plan 模式下用户通过 ChatInput 发送的文本只走 /api/plan/orchestrate（或 rediscuss），
 *      触发多 Agent 讨论，并在 PlanPanel 的 snapshot.messages 中呈现；
 *   2. 不再调用 onSend —— 用户消息不进入普通会话 SSE 流（数据隔离）；
 *   3. plan 模式的流控仅受 planBusy 控制，不受普通模式 isStreaming 影响（流控解耦）。
 *
 * 这是 222b2a8「双写修复」之后的进一步解耦：双写曾让用户消息同时出现在主消息列表
 * 与 PlanPanel timeline，造成视觉混淆与数据冗余。解耦后两种模式数据完全分离。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// vi.mock 工厂会被 hoist 到文件顶部，必须用 vi.hoisted 先创建共享 mock 对象，
// 否则工厂里访问 csrfFetchJsonMock 时还未初始化。
const { csrfFetchJsonMock } = vi.hoisted(() => ({
  csrfFetchJsonMock: vi.fn(),
}));

// 让 useI18n 返回 key 原文，便于稳定断言。
vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({ t: (k: string) => k, locale: "zh" }),
}));

// 拦截 csrfFetchJson（与 SessionItem 同款 seam，不污染全局 fetch）。
vi.mock("@/lib/csrf-fetch", () => ({
  csrfFetchJson: csrfFetchJsonMock,
}));

// 占位 hooks：屏蔽掉移动端/扩展面板等干扰。
vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));
vi.mock("@/hooks/useExtensions", () => ({
  useExtensions: () => ({ getWorkspaceLabelItems: () => [] }),
}));

// store 必须在 mock 之后 import：组件读它，测试也要控制它。
import {
  getPlanModeStore,
  setPlanMode,
  setOrchestratorId,
  setPlanStatus,
} from "@/lib/plan-mode-store";
import type { ToolEntry } from "@/lib/tool-presets";

// 必须在所有 mock 之后 import 组件本身。
import { ChatInput } from "./ChatInput";

const tools: ToolEntry[] = [];

describe("ChatInput plan mode decoupling", () => {
  beforeEach(() => {
    csrfFetchJsonMock.mockReset();
    csrfFetchJsonMock.mockResolvedValue({ ok: true, status: 200, data: { id: "orc-1" } });
    getPlanModeStore().reset();
    setPlanMode(true);
    setOrchestratorId(null);
    setPlanStatus("idle");
  });

  afterEach(() => {
    cleanup();
    getPlanModeStore().reset();
  });

  it("plan 模式无 orchestrator 时：发送只走 orchestrate，不触碰普通会话 SSE 流", async () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} onAbort={vi.fn()} isStreaming={false} tools={tools} />);

    const textarea = screen.getByLabelText("input.label") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "帮我规划登录页改造" } });
    fireEvent.click(screen.getByRole("button", { name: /input\.send/ }));

    await waitFor(() => {
      expect(csrfFetchJsonMock).toHaveBeenCalledTimes(1);
    });
    // 1) 触发了 orchestrate，且 requirement 透传。
    expect(csrfFetchJsonMock).toHaveBeenCalledWith(
      "/api/plan/orchestrate",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ requirement: "帮我规划登录页改造" }),
      }),
    );
    // 2) 数据隔离：onSend 不应被调用，用户消息只进编排器后端（PlanPanel timeline）。
    expect(onSend).not.toHaveBeenCalled();
  });

  it("plan 模式 awaiting_confirm 时：发送只走 rediscuss，不触碰普通会话 SSE 流", async () => {
    const onSend = vi.fn();
    setOrchestratorId("orc-1");
    setPlanStatus("awaiting_confirm");

    render(<ChatInput onSend={onSend} onAbort={vi.fn()} isStreaming={false} tools={tools} />);

    const textarea = screen.getByLabelText("input.label") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "请改用更轻的实现" } });
    fireEvent.click(screen.getByRole("button", { name: /input\.send/ }));

    await waitFor(() => {
      expect(csrfFetchJsonMock).toHaveBeenCalledTimes(1);
    });
    expect(csrfFetchJsonMock).toHaveBeenCalledWith(
      "/api/plan/orc-1/rediscuss",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ feedback: "请改用更轻的实现" }),
      }),
    );
    // 数据隔离：onSend 不应被调用。
    expect(onSend).not.toHaveBeenCalled();
  });

  it("orchestrate 失败时：输入保留以便用户重试，planError 被设置", async () => {
    const onSend = vi.fn();
    csrfFetchJsonMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      data: { error: "boom" },
    });

    render(<ChatInput onSend={onSend} onAbort={vi.fn()} isStreaming={false} tools={tools} />);

    const textarea = screen.getByLabelText("input.label") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "原始输入" } });
    fireEvent.click(screen.getByRole("button", { name: /input\.send/ }));

    await waitFor(() => {
      expect(csrfFetchJsonMock).toHaveBeenCalledTimes(1);
    });
    // 失败时不应触发 onSend（编排器未真正启动）。
    expect(onSend).not.toHaveBeenCalled();
    // 输入应该保留以便用户重试。
    expect(textarea.value).toBe("原始输入");
  });

  it("流控解耦：普通模式 isStreaming=true 时，plan 模式发送不受阻挡", async () => {
    const onSend = vi.fn();
    // 关键：isStreaming=true 模拟普通会话正在流式输出。
    render(<ChatInput onSend={onSend} onAbort={vi.fn()} isStreaming={true} tools={tools} />);

    const textarea = screen.getByLabelText("input.label") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "新需求" } });
    fireEvent.click(screen.getByRole("button", { name: /input\.send/ }));

    await waitFor(() => {
      expect(csrfFetchJsonMock).toHaveBeenCalledTimes(1);
    });
    // plan 模式独立流控：即使普通模式 isStreaming，orchestrate 仍被调用。
    expect(csrfFetchJsonMock).toHaveBeenCalledWith(
      "/api/plan/orchestrate",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ requirement: "新需求" }),
      }),
    );
    // 数据隔离：onSend 不应被调用（且普通模式流式下本就拒绝新消息）。
    expect(onSend).not.toHaveBeenCalled();
  });

  it("流控解耦（Enter 键）：isStreaming=true 时 plan 模式按 Enter 走 orchestrate，不进 steer/followUp", async () => {
    const onSend = vi.fn();
    const onSteer = vi.fn();
    const onFollowUp = vi.fn();
    // 关键：isStreaming=true 且提供 onSteer/onFollowUp。
    // 未解耦时 Enter 会走 sendQueued(steer/followUp) 把 plan 输入注入普通会话 SSE 流。
    render(
      <ChatInput
        onSend={onSend}
        onAbort={vi.fn()}
        isStreaming={true}
        onSteer={onSteer}
        onFollowUp={onFollowUp}
        tools={tools}
      />,
    );

    const textarea = screen.getByLabelText("input.label") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Enter 键需求" } });
    // 按 Enter（非 Shift+Enter）触发 handleKeyDown 的发送分支。
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(csrfFetchJsonMock).toHaveBeenCalledTimes(1);
    });
    // plan 模式独立流控：Enter 也走 orchestrate。
    expect(csrfFetchJsonMock).toHaveBeenCalledWith(
      "/api/plan/orchestrate",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ requirement: "Enter 键需求" }),
      }),
    );
    // 数据隔离：steer/followUp 不应被调用（plan 输入不应注入普通会话流）。
    expect(onSteer).not.toHaveBeenCalled();
    expect(onFollowUp).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });
});
