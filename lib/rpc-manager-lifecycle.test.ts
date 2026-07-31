// @vitest-environment node
/**
 * Behavioral tests for AgentSessionWrapper lifecycle (ST1).
 *
 * Seam: the AgentSessionWrapper class, exercised via a fake `inner` object
 * implementing only the AgentSessionLike surface these tests touch (prompt,
 * abort, subscribe, isStreaming/isCompacting). Real pi SDK is not involved.
 *
 * These cover three stability concerns:
 *  1. A silently-streaming prompt (> idle timeout, no events) must NOT destroy
 *     the wrapper mid-prompt.
 *  2. destroy() aborts the in-flight inner prompt so it doesn't keep running.
 *  3. A prompt that resolves after destroy() must not fire events on a dead
 *     wrapper (no ghost prompt_done / notifyRunningChange on a torn-down session).
 */
import type { AgentSessionLike } from "./pi-types";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PiSdkPort } from "./pi-ports";

// 绕开 createDefaultExtensionTheme 对真实 SDK 的 Theme 构造依赖（test 环境
// 下 pi.Theme 不可构造）。返回最小 fake theme，wrapper 仅存储该字段，测试不校验。
vi.mock("./extension-theme", () => ({
  createDefaultExtensionTheme: () => ({
    name: "fake",
    fg: {},
    bg: {},
    format: () => "",
  }),
}));

const { AgentSessionWrapper } = await import("./rpc-manager");
const { registerPiAdapter } = await import("./pi");

// L9 测试需要 fork 内部调用的 getPiAdapter().SessionManager 链可控。
// 通过现成的 registerPiAdapter 注入缝注册 fake adapter（不 mock ./pi 模块本身，
// 避免破坏 createDefaultExtensionTheme 对 pi.Theme 的真实构造）。记录 create/open
// 调用顺序以验证 fork 在 running 时会先 await abort 再派生分支。
const forkSequence: string[] = [];
const fakeAdapter = {
  agentDir: "/tmp",
  SessionManager: {
    create: (_cwd: unknown, _sessionDir: unknown) => {
      forkSequence.push("create");
      return {
        newSession: () => ({}),
        getSessionFile: () => "/tmp/new-session.jsonl",
      };
    },
    open: (file: unknown, _sessionDir: unknown) => {
      forkSequence.push("open:" + String(file));
      return {
        getEntry: () => ({}),
        createBranchedSession: () => "/tmp/new-session.jsonl",
        getSessionFile: () => String(file),
        getSessionId: () => "new-session-id",
      };
    },
  },
};

/** Build a minimal fake inner satisfying the AgentSessionLike fields we use. */
function makeFakeInner(overrides: Partial<Record<string, unknown>> = {}) {
  const subscribers: Array<(e: unknown) => void> = [];
  let abortCalls = 0;
  return {
    inner: {
      sessionId: "test-session",
      sessionFile: "/tmp/test.jsonl",
      isStreaming: false,
      isCompacting: false,
      autoCompactionEnabled: true,
      autoRetryEnabled: false,
      model: undefined,
      modelRegistry: { find: () => undefined },
      sessionManager: {},
      settingsManager: {},
      agent: { state: { systemPrompt: "", thinkingLevel: "off" } },
      extensionRunner: { getRegisteredCommands: () => [] },
      promptTemplates: [],
      resourceLoader: { getSkills: () => ({ skills: [] }) },
      pendingMessageCount: 0,
      getAllTools: () => [],
      getActiveToolNames: () => [],
      getContextUsage: () => undefined,
      getSteeringMessages: () => [],
      getFollowUpMessages: () => [],
      getSessionStats: () => ({
        sessionId: "test-session",
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        cost: 0,
      }),
      subscribe(listener: (e: unknown) => void) {
        subscribers.push(listener);
        return () => {};
      },
      prompt: vi.fn(async () => {}),
      abort: vi.fn(async () => {
        abortCalls += 1;
        forkSequence.push("abort");
      }),
      reload: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      navigateTree: vi.fn(async () => ({ cancelled: false })),
      setThinkingLevel: vi.fn(() => {}),
      compact: vi.fn(async () => ({})),
      setSessionName: vi.fn(() => {}),
      getLastAssistantText: vi.fn(() => undefined),
      setAutoCompactionEnabled: vi.fn(() => {}),
      setAutoRetryEnabled: vi.fn(() => {}),
      steer: vi.fn(async () => {}),
      followUp: vi.fn(async () => {}),
      clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
      setActiveToolsByName: vi.fn(() => {}),
      abortCompaction: vi.fn(() => {}),
      ...overrides,
    } as unknown as AgentSessionLike,
    subscribers,
    getAbortCalls: () => abortCalls,
  };
}

describe("AgentSessionWrapper lifecycle (ST1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("destroy() aborts the in-flight inner prompt", async () => {
    const { inner, getAbortCalls } = makeFakeInner();
    const wrapper = new AgentSessionWrapper(inner, { idleTimeoutMs: 60_000 });
    wrapper.start();

    // Start a prompt — fire-andorget; inner.prompt is a never-resolving promise.
    inner.prompt = vi.fn(() => new Promise<void>(() => {}));
    await wrapper.send({ type: "prompt", message: "hi" });
    expect(wrapper.isRunning()).toBe(true);

    wrapper.destroy();
    expect(getAbortCalls()).toBe(1);
  });

  it("does not destroy the wrapper while a prompt is running, even past the idle timeout", async () => {
    const { inner } = makeFakeInner();
    const wrapper = new AgentSessionWrapper(inner, { idleTimeoutMs: 1_000 });
    const onDestroy = vi.fn();
    wrapper.onDestroy(onDestroy);
    wrapper.start();

    // A silently-streaming prompt: never resolves, never emits events.
    inner.prompt = vi.fn(() => new Promise<void>(() => {}));
    await wrapper.send({ type: "prompt", message: "hi" });
    expect(wrapper.isRunning()).toBe(true);

    // Advance well past the idle timeout. The wrapper must survive.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(wrapper.isAlive()).toBe(true);
    expect(onDestroy).not.toHaveBeenCalled();
    expect(wrapper.isRunning()).toBe(true);

    wrapper.destroy();
  });

  it("a prompt that resolves after destroy() does not emit prompt_done on the dead wrapper", async () => {
    const { inner } = makeFakeInner();
    const wrapper = new AgentSessionWrapper(inner, { idleTimeoutMs: 60_000 });
    const events: unknown[] = [];
    wrapper.onEvent((e) => events.push(e));
    wrapper.start();

    // Prompt whose resolution we control.
    let resolvePrompt!: () => void;
    inner.prompt = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    await wrapper.send({ type: "prompt", message: "hi" });
    events.length = 0; // ignore setup noise

    // Destroy while the prompt is still in-flight.
    wrapper.destroy();
    expect(wrapper.isAlive()).toBe(false);

    // Now the inner prompt resolves (the SDK finished). The wrapper must not
    // emit prompt_done / prompt_error for an already-destroyed session.
    resolvePrompt();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([]);
  });

  it("idle timeout DOES destroy the wrapper when no prompt is running", async () => {
    const { inner } = makeFakeInner();
    const wrapper = new AgentSessionWrapper(inner, { idleTimeoutMs: 1_000 });
    const onDestroy = vi.fn();
    wrapper.onDestroy(onDestroy);
    wrapper.start();

    await vi.advanceTimersByTimeAsync(1_500);
    expect(wrapper.isAlive()).toBe(false);
    expect(onDestroy).toHaveBeenCalled();
  });

  it("L9: fork while running awaits abort before creating the branched session", async () => {
    forkSequence.length = 0;
    // 通过 registerPiAdapter 注入缝注册可控 adapter（仅覆盖 fork 所需的
    // SessionManager 链），不影响其他真实 ./pi 符号。
    const prevAdapter = (globalThis as Record<string, unknown>).__piSdkAdapter;
    registerPiAdapter(fakeAdapter as unknown as PiSdkPort);

    const { inner, getAbortCalls } = makeFakeInner({
      isStreaming: true,
      sessionManager: {
        isPersisted: () => true,
        getEntry: () => ({ parentId: "parent-1" }),
        getSessionDir: () => "/tmp",
        getCwd: () => "/tmp",
      },
    });
    const wrapper = new AgentSessionWrapper(inner, { idleTimeoutMs: 60_000 });
    wrapper.start();

    // 会话正在运行：inner.prompt 永不 resolve 且 inner.isStreaming 为 true。
    inner.prompt = vi.fn(() => new Promise<void>(() => {}));
    await wrapper.send({ type: "prompt", message: "hi" });
    expect(wrapper.isRunning()).toBe(true);

    // fork 正在运行中的会话。
    const result = await wrapper.send({ type: "fork", entryId: "entry-1" });

    // 修复前：fork 直接 this.destroy()（fire-and-forget abort）再建分支，
    // abort 可能尚未完成便派生，导致从不一致检查点 fork。
    // 修复后：fork 前 await 干净 abort，abort 必须先于 SessionManager 链任何调用。
    // fake 的 open/create 是同步 push，而 abort 是 await 的，故若 abort 先完成，
    // 序列中 "abort" 必排在 "open:" 派生调用之前。
    expect(getAbortCalls()).toBe(1);
    expect(forkSequence).toContain("abort");
    expect(forkSequence).toContain("open:/tmp/test.jsonl");
    expect(forkSequence).toContain("open:/tmp/new-session.jsonl");
    // 核心 L9 行为：abort 必须先于任何派生链调用发生。
    expect(forkSequence.indexOf("abort")).toBeLessThan(
      forkSequence.indexOf("open:/tmp/test.jsonl"),
    );

    // 新会话已派生，原 wrapper 已销毁、不再 running。
    expect(result).toMatchObject({ newSessionId: "new-session-id" });
    expect(wrapper.isAlive()).toBe(false);

    // 还原 adapter，避免污染其他测试。
    (globalThis as Record<string, unknown>).__piSdkAdapter = prevAdapter;
  });

  it("P5: hard idle limit destroys the wrapper even while a prompt is running", async () => {
    const { inner } = makeFakeInner({ isStreaming: true });
    // 注入极短硬上限（100ms），普通 idleTimeoutMs 设长（不触发普通超时）。
    const wrapper = new AgentSessionWrapper(inner, {
      idleTimeoutMs: 60_000,
      hardIdleMaxMs: 100,
    });
    wrapper.start();

    // 会话运行中（prompt 永不 resolve，isStreaming 为真），普通 idle 计时器会
    // 因 promptRunning 无限重排而不 destroy。
    inner.prompt = vi.fn(() => new Promise<void>(() => {}));
    await wrapper.send({ type: "prompt", message: "hi" });
    expect(wrapper.isRunning()).toBe(true);

    // 硬上限 timer 必须兜底销毁，无论是否 running。
    await vi.advanceTimersByTimeAsync(200);
    expect(wrapper.isAlive()).toBe(false);
  });

  it("P6: startRpcSession rejects with SessionLimitError (429) when concurrency limit exceeded", async () => {
    const { getRegistry } = await import("./session-registry");
    const { SessionLimitError, startRpcSession } = await import("./rpc-manager");
    const { registerPiAdapter } = await import("./pi");

    // 注入 MAX 个存活 fake wrapper 占满并发配额。
    const registry = getRegistry();
    const prevIds = [...registry.keys()];
    for (const k of prevIds) registry.delete(k); // 隔离其他用例残留
    const prevAdapter = (globalThis as Record<string, unknown>).__piSdkAdapter;
    registerPiAdapter(fakeAdapter as unknown as PiSdkPort);

    const fakeAlive = {
      sessionId: "",
      isAlive: () => true,
      isRunning: () => false,
      destroy: () => {},
    };
    for (let i = 0; i < 8; i += 1) {
      registry.set(`p6-idle-${i}`, fakeAlive);
    }

    let thrown: unknown = null;
    try {
      await startRpcSession("p6-new", "", "/tmp", undefined);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(SessionLimitError);
    expect((thrown as InstanceType<typeof SessionLimitError>).statusCode).toBe(429);
    // 超限时不应新建会话（p6-new 不应进入 registry）。
    expect(registry.has("p6-new")).toBe(false);

    // 还原，避免污染其他测试。
    for (let i = 0; i < 8; i += 1) registry.delete(`p6-idle-${i}`);
    (globalThis as Record<string, unknown>).__piSdkAdapter = prevAdapter;
  });
});
