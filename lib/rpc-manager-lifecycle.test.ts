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

const { AgentSessionWrapper } = await import("./rpc-manager");

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
});
