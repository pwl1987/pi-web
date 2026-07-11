// @vitest-environment node
/**
 * Tests for the pure helpers extracted from useAgentSession.ts (phase 6.2).
 * These were previously module-private functions in the 1986-line hook; moving
 * them to lib/agent-session-helpers.ts makes them unit-testable and shrinks the
 * hook. The hook re-exports the ones its public surface needs.
 */
import { describe, it, expect } from "vitest";
import {
  streamReducer,
  normalizeQueuedMessages,
  noticeReducer,
  createNoticeId,
  markOldestNoticeExiting,
  fillPendingNotices,
  extractMessageText,
  imageSignature,
  userMessageKey,
  readCompactResult,
  MAX_NOTICES,
  type NoticeItem,
  type NoticeState,
  type StreamingState,
} from "./agent-session-helpers";

describe("streamReducer", () => {
  const initial = { isStreaming: false, streamingMessage: null };
  it("start sets isStreaming with no message", () => {
    expect(streamReducer(initial, { type: "start" })).toEqual({
      isStreaming: true,
      streamingMessage: null,
    });
  });
  it("update stores the partial message", () => {
    const msg = { role: "assistant", content: [{ type: "text", text: "hi" }] } as never;
    expect(
      streamReducer(
        { isStreaming: true, streamingMessage: null },
        { type: "update", message: msg },
      ),
    ).toEqual({ isStreaming: true, streamingMessage: msg });
  });
  it("end and reset both clear streaming", () => {
    const streaming: StreamingState = {
      isStreaming: true,
      streamingMessage: { role: "assistant" } as never,
    };
    expect(streamReducer(streaming, { type: "end" })).toEqual(initial);
    expect(streamReducer(streaming, { type: "reset" })).toEqual(initial);
  });
});

describe("normalizeQueuedMessages", () => {
  it("fills missing arrays with empty defaults", () => {
    expect(normalizeQueuedMessages(undefined)).toEqual({ steering: [], followUp: [] });
    expect(normalizeQueuedMessages(null)).toEqual({ steering: [], followUp: [] });
    expect(normalizeQueuedMessages({ steering: ["a"] })).toEqual({ steering: ["a"], followUp: [] });
  });
});

describe("notice queue", () => {
  const mk = (id: string): NoticeItem => ({
    id,
    message: id,
    type: "info",
  });

  it("createNoticeId returns a unique non-empty string", () => {
    const a = createNoticeId();
    const b = createNoticeId();
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it("add appends a notice up to MAX_NOTICES", () => {
    let state: NoticeState = { visible: [], pending: [] };
    for (let i = 0; i < MAX_NOTICES; i++) {
      state = noticeReducer(state, { type: "add", notice: mk(`n${i}`) });
    }
    expect(state.visible.length).toBe(MAX_NOTICES);
    expect(state.pending).toEqual([]);
  });

  it("overflowing adds go to pending and mark the oldest exiting", () => {
    let state: NoticeState = { visible: [], pending: [] };
    for (let i = 0; i < MAX_NOTICES; i++)
      state = noticeReducer(state, { type: "add", notice: mk(`n${i}`) });
    state = noticeReducer(state, { type: "add", notice: mk("overflow") });
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].id).toBe("overflow");
    expect(state.visible.some((n) => n.exiting)).toBe(true);
  });

  it("remove pulls a pending notice into view", () => {
    let state: NoticeState = { visible: [], pending: [] };
    for (let i = 0; i < MAX_NOTICES + 1; i++)
      state = noticeReducer(state, { type: "add", notice: mk(`n${i}`) });
    // remove one visible -> a pending should promote
    const firstId = state.visible[0].id;
    state = noticeReducer(state, { type: "remove", id: firstId });
    expect(state.visible.find((n) => n.id === firstId)).toBeUndefined();
    expect(state.pending.length).toBe(0);
  });

  it("markOldestNoticeExiting flags the first non-exiting notice", () => {
    const out = markOldestNoticeExiting([mk("a"), mk("b")]);
    expect(out[0].exiting).toBe(true);
    expect(out[1].exiting).toBeUndefined();
  });

  it("fillPendingNotices tops up visible from pending up to MAX_NOTICES", () => {
    const visible: NoticeItem[] = [mk("a")];
    const pending: NoticeItem[] = [mk("b"), mk("c")];
    const result = fillPendingNotices(visible, pending);
    expect(result.visible.length).toBe(Math.min(MAX_NOTICES, 3));
  });
});

describe("extractMessageText", () => {
  it("returns string content directly", () => {
    expect(extractMessageText({ content: "hello" } as never)).toBe("hello");
  });
  it("joins text blocks", () => {
    expect(
      extractMessageText({
        content: [{ type: "text", text: "a" }, { type: "toolCall" }, { type: "text", text: "b" }],
      } as never),
    ).toBe("a\nb");
  });
  it("returns empty string for non-array non-string content", () => {
    expect(extractMessageText({ content: 42 } as never)).toBe("");
  });
});

describe("imageSignature", () => {
  it("returns empty for non-image blocks", () => {
    expect(imageSignature({ type: "text", text: "x" })).toBe("");
    expect(imageSignature(null)).toBe("");
  });
  it("signatures a base64 image", () => {
    expect(imageSignature({ type: "image", data: "abc", mimeType: "image/png" })).toContain(
      "base64",
    );
    expect(imageSignature({ type: "image", data: "abc", mimeType: "image/png" })).toContain(
      "image/png",
    );
  });
});

describe("userMessageKey", () => {
  it("is stable for identical string content", () => {
    expect(userMessageKey({ content: "hi" } as never)).toBe(
      userMessageKey({ content: "hi" } as never),
    );
  });
  it("differs for different content", () => {
    expect(userMessageKey({ content: "hi" } as never)).not.toBe(
      userMessageKey({ content: "bye" } as never),
    );
  });
  it("includes image signatures so messages with different images differ", () => {
    const noImg = userMessageKey({ content: [{ type: "text", text: "x" }] } as never);
    const withImg = userMessageKey({
      content: [
        { type: "text", text: "x" },
        { type: "image", data: "d", mimeType: "image/png" },
      ],
    } as never);
    expect(noImg).not.toBe(withImg);
  });
});

describe("readCompactResult", () => {
  it("returns null for non-object or missing tokensBefore", () => {
    expect(readCompactResult(null, "manual")).toBeNull();
    expect(readCompactResult({}, "manual")).toBeNull();
    expect(readCompactResult({ tokensBefore: "x" }, "manual")).toBeNull();
  });
  it("reads tokensBefore and optional estimatedTokensAfter", () => {
    expect(readCompactResult({ tokensBefore: 100 }, "manual")).toEqual({
      reason: "manual",
      tokensBefore: 100,
      estimatedTokensAfter: undefined,
    });
    expect(readCompactResult({ tokensBefore: 100, estimatedTokensAfter: 50 }, "auto")).toEqual({
      reason: "auto",
      tokensBefore: 100,
      estimatedTokensAfter: 50,
    });
  });
});
