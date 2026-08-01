// runner 单测：node --test --experimental-strip-types
// 验证 formatTranscript / formatCompactTranscript 的上下文压缩行为（Token 优化）。
import { test } from "node:test";
import assert from "node:assert/strict";

import { formatTranscript, formatCompactTranscript } from "./runner.ts";

/** @type {import("./orchestrator-types.ts").DiscussionMessage[]} */
const messages = [
  {
    id: "m0",
    round: 0,
    from: "user",
    fromName: "用户",
    kind: "user",
    content: "需求原文很长很长很长",
    at: 0,
  },
  {
    id: "m1",
    round: 1,
    from: "architect",
    fromName: "架构师",
    kind: "agent",
    content: "第一轮架构观点全文",
    at: 1,
  },
  {
    id: "m2",
    round: 1,
    from: "qa",
    fromName: "测试",
    kind: "agent",
    content: "第一轮测试观点全文",
    at: 2,
  },
  {
    id: "m3",
    round: 2,
    from: "architect",
    fromName: "架构师",
    kind: "agent",
    content: "第二轮架构观点全文",
    at: 3,
  },
];

const rounds = [
  { round: 1, summaryText: "【第1轮摘要】架构师：第一轮架构观点；测试：第一轮测试观点" },
  { round: 2, summaryText: "【第2轮摘要】架构师：第二轮架构观点" },
];

test("formatTranscript 始终保留全文", () => {
  const t = formatTranscript(messages);
  assert.ok(t.includes("需求原文很长很长很长"));
  assert.ok(t.includes("第一轮架构观点全文"));
  assert.ok(t.includes("第二轮架构观点全文"));
});

test("formatCompactTranscript 当前轮与需求保留全文，旧轮压成摘要", () => {
  const t = formatCompactTranscript(messages, rounds, 2);
  // 需求（round 0）与当前轮（round 2）保留全文
  assert.ok(t.includes("需求原文很长很长很长"));
  assert.ok(t.includes("第二轮架构观点全文"));
  // 旧轮（round 1）被压缩成摘要，不再出现全文
  assert.ok(!t.includes("第一轮架构观点全文"));
  assert.ok(t.includes("【第1轮摘要】"));
});

test("formatCompactTranscript 首轮无旧摘要时回退全文", () => {
  const t = formatCompactTranscript(messages, [], 1);
  assert.ok(t.includes("需求原文很长很长很长"));
  assert.ok(t.includes("第一轮架构观点全文"));
});

test("formatCompactTranscript 缺失 summaryText 回退全文", () => {
  const noSummary = [{ round: 1 }];
  const t = formatCompactTranscript(messages, noSummary, 2);
  assert.ok(t.includes("第一轮架构观点全文"), "无 summaryText 时保留全文");
});
