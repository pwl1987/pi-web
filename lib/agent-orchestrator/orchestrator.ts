// 多 Agent 协同编排器（门面 + 生命周期管理）
// 串联四大模块：需求解析 → 多轮讨论（事件驱动/消息队列）→ 收敛 → 方案合成 →
// 交互确认 → 任务拆解。编排器是单次讨论的运行时实例，挂在 globalThis 注册表上，
// 供 API 路由（start/confirm）与 SSE（事件流）跨请求访问。

import type {
  AgentInstance,
  AgentRole,
  ConvergenceState,
  DiscussionMessage,
  IntentParseResult,
  OrchestrationSnapshot,
  OrchestrationStatus,
  OrchestratorConfig,
  OrchestratorEvent,
  RecommendationPlan,
  RoundSummary,
  OrchestratedTask,
} from "./orchestrator-types.ts";
import { DEFAULT_ORCHESTRATOR_CONFIG } from "./orchestrator-types.ts";
import { getRole } from "./role-library.ts";
import { parseIntentHeuristic, INTENT_SYSTEM_PROMPT } from "./intent-parser.ts";
import type { AgentRunner } from "./runner.ts";
import { createMockRunner, formatTranscript } from "./runner.ts";
import { arbiterSignalsConsensus, evaluateConvergence, roundFingerprint } from "./convergence.ts";
import { buildSynthesisUserMessage, parseRecommendationPlans } from "./plan-synthesizer.ts";
import type { ConfirmPayload } from "./task-scheduler.ts";
import { buildConfirmPayload, decomposePlanHeuristic } from "./task-scheduler.ts";

export interface OrchestratorOptions {
  requirement: string;
  cwd?: string;
  config?: Partial<OrchestratorConfig>;
  /** 注入自定义 runner；默认使用确定性 Mock（便于无 LLM 环境运行/测试）。 */
  runner?: AgentRunner;
  /** 是否用 LLM 解析意图（需 runner 支持 completeSimple）；默认启发式。 */
  useLlmIntent?: boolean;
}

type Listener = (e: OrchestratorEvent) => void;

let orchSeq = 0;
function nextId(): string {
  orchSeq += 1;
  return `orch_${Date.now().toString(36)}_${orchSeq}`;
}

// 角色必须存在；缺失时抛错而非静默返回 undefined。
function requireRole(id: string): AgentRole {
  const r = getRole(id);
  if (!r) throw new Error(`缺少角色定义：${id}`);
  return r;
}

// 构造某参与者本轮的用户消息（需求 + 讨论上下文 + 本轮指令）。
function buildParticipantUserMessage(
  requirement: string,
  transcript: string,
  round: number,
  role: AgentRole,
): string {
  return (
    `用户原始需求：\n${requirement}\n\n` +
    `前序讨论记录：\n${transcript}\n\n` +
    `现在是第 ${round} 轮讨论。请作为【${role.name}】，基于以上信息给出你本轮的` +
    "专业判断：认可哪些观点、反对哪些并提出替代、指出关键风险与待澄清问题。"
  );
}

export class AgentOrchestrator {
  readonly id: string;
  requirement: string;
  cwd?: string;
  config: OrchestratorConfig;
  private runner: AgentRunner;

  status: OrchestrationStatus = "idle";
  intent?: IntentParseResult;
  agents: AgentInstance[] = [];
  messages: DiscussionMessage[] = [];
  rounds: RoundSummary[] = [];
  convergence: ConvergenceState = { converged: false, reason: "none", round: 0 };
  plans: RecommendationPlan[] = [];
  selectedPlanId?: string;
  tasks: OrchestratedTask[] = [];
  error?: string;
  updatedAt = Date.now();

  /** 退回重议时暂存的修改意见，在 parseIntent 中作为用户消息重新播种。 */
  private pendingFeedback?: string;

  private listeners = new Set<Listener>();
  private msgSeq = 0;
  private running = false;

  constructor(opts: OrchestratorOptions) {
    this.id = nextId();
    this.requirement = opts.requirement;
    this.cwd = opts.cwd;
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...(opts.config ?? {}) };
    this.runner = opts.runner ?? createMockRunner({ planCount: this.config.planCount });
    this.useLlmIntent = opts.useLlmIntent ?? false;
  }

  private useLlmIntent: boolean;

  // --- 订阅 / 快照 ---------------------------------------------------------
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: OrchestratorEvent): void {
    this.updatedAt = e.at;
    for (const cb of this.listeners) cb(e);
  }

  private setStatus(status: OrchestrationStatus): void {
    this.status = status;
    // 进入终态时同步释放运行锁，使「状态事件」与「running 标志」保持一致，
    // 避免订阅者在收到 awaiting_confirm 后立刻调用 rediscuss 仍命中 running===true 而被拒。
    if (
      status === "awaiting_confirm" ||
      status === "failed" ||
      status === "done" ||
      status === "cancelled"
    ) {
      this.running = false;
    }
    this.emit({ type: "status", status, at: Date.now() });
  }

  getSnapshot(): OrchestrationSnapshot {
    return {
      id: this.id,
      status: this.status,
      requirement: this.requirement,
      cwd: this.cwd,
      config: this.config,
      intent: this.intent,
      agents: this.agents,
      messages: this.messages,
      rounds: this.rounds,
      convergence: this.convergence,
      plans: this.plans,
      selectedPlanId: this.selectedPlanId,
      tasks: this.tasks,
      error: this.error,
      updatedAt: this.updatedAt,
    };
  }

  // --- 生命周期：创建 / 运行 / 取消 / 重新讨论 -----------------------------
  /** 启动完整流水线（fire-and-forget，事件经 SSE 推送）。 */
  start(): void {
    if (this.running) return;
    void this.run();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.parseIntent();
      await this.instantiateAgents();
      await this.runDiscussion();
      await this.synthesize();
      this.setStatus("awaiting_confirm");
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.setStatus("failed");
      this.emit({ type: "error", message: this.error, at: Date.now() });
    } finally {
      this.running = false;
    }
  }

  /** 模块一：需求接收与解析 —— 提取意图并动态实例化角色。 */
  private async parseIntent(): Promise<void> {
    this.setStatus("parsing");
    let intent: IntentParseResult;
    if (this.useLlmIntent) {
      try {
        const res = await this.runner.complete(
          {
            id: "intent",
            name: "意图解析",
            kind: "participant",
            expertise: [],
            color: "slate",
            blurb: "",
            systemPrompt: INTENT_SYSTEM_PROMPT,
          },
          INTENT_SYSTEM_PROMPT,
          `需求：${this.requirement}`,
          0,
        );
        intent = this.parseIntentFromLlm(res.content);
      } catch {
        intent = parseIntentHeuristic(this.requirement);
      }
    } else {
      intent = parseIntentHeuristic(this.requirement);
    }
    this.intent = intent;
    this.emit({ type: "intent", intent, at: Date.now() });
    // 记录用户原始需求为第 0 轮消息。
    this.pushMessage({
      round: 0,
      from: "user",
      fromName: "用户",
      kind: "user",
      content: this.requirement,
    });
    // 退回重议场景下，重新播种用户的修改意见。
    if (this.pendingFeedback) {
      this.pushMessage({
        round: 0,
        from: "user",
        fromName: "用户",
        kind: "user",
        content: `【修改意见】${this.pendingFeedback}`,
      });
      this.pendingFeedback = undefined;
    }
  }

  private parseIntentFromLlm(raw: string): IntentParseResult {
    try {
      const obj = JSON.parse(raw.replace(/^```(?:json)?|```$/gi, "").trim()) as {
        summary?: string;
        keywords?: string[];
        tags?: string[];
      };
      const tags = (obj.tags ?? []).filter(Boolean).slice(0, 5) as IntentParseResult["tags"];
      const base = parseIntentHeuristic(this.requirement);
      return {
        summary: obj.summary?.trim() || base.summary,
        keywords: obj.keywords ?? base.keywords,
        tags: tags.length ? tags : base.tags,
        selectedRoleIds: base.selectedRoleIds,
        confidence: Math.min(1, base.confidence + 0.1),
      };
    } catch {
      return parseIntentHeuristic(this.requirement);
    }
  }

  /** 依据意图动态实例化参与者 + 框架角色（仲裁者/合成者）。 */
  private async instantiateAgents(): Promise<void> {
    const participantIds = this.intent?.selectedRoleIds ?? [];
    const frameworkIds = ["arbiter", "synthesizer"];
    const allIds = [...participantIds, ...frameworkIds];
    for (const roleId of allIds) {
      const role = getRole(roleId);
      if (!role) continue;
      const agent: AgentInstance = {
        id: `${roleId}`,
        roleId: role.id,
        roleName: role.name,
        kind: role.kind,
        color: role.color,
        status: "pending",
        joinedRound: 0,
      };
      this.agents.push(agent);
      this.emit({ type: "agent.joined", agent, at: Date.now() });
    }
  }

  private agentByRole(roleId: string): AgentInstance | undefined {
    return this.agents.find((a) => a.roleId === roleId);
  }

  /** 模块二 + 收敛：多轮讨论（事件驱动消息队列），直至收敛。 */
  private async runDiscussion(): Promise<void> {
    this.setStatus("discussing");
    const participants = this.agents.filter((a) => a.kind === "participant");
    const arbiter = this.agentByRole("arbiter");
    let prevFingerprint: string | undefined;

    for (let round = 1; round <= this.config.maxRounds; round++) {
      this.emit({ type: "round.start", round, at: Date.now() });
      const roundMsgIds: string[] = [];
      const speakers: string[] = [];

      // 并行度受限的参与者发言。
      const batch = participants;
      if (this.config.concurrency > 1) {
        await Promise.all(
          batch.map((agent) => this.runParticipantTurn(agent, round, roundMsgIds, speakers)),
        );
      } else {
        for (const agent of batch) {
          await this.runParticipantTurn(agent, round, roundMsgIds, speakers);
        }
      }

      const roundMessages = this.messages.filter((m) => m.round === round);
      const fingerprint = roundFingerprint(roundMessages);
      const summary: RoundSummary = {
        round,
        messageIds: roundMsgIds,
        speakers,
        fingerprint,
      };

      // 仲裁者收敛判定。
      let arbiterConsensus = false;
      if (arbiter) {
        arbiter.status = "thinking";
        const transcript = formatTranscript(this.messages);
        const res = await this.runner.complete(
          requireRole("arbiter"),
          requireRole("arbiter").systemPrompt,
          `第 ${round} 轮讨论记录：\n${transcript}\n\n请给出本轮共识度与 CONSENSUS/NO_CONSENSUS 结论。`,
          round,
        );
        arbiterConsensus = arbiterSignalsConsensus(res.content);
        summary.arbiterConsensus = arbiterConsensus;
        this.pushMessage({
          round,
          from: "arbiter",
          fromName: "仲裁者",
          kind: "arbiter",
          content: res.content,
        });
        arbiter.status = "responded";
      }

      const conv = evaluateConvergence({
        round,
        maxRounds: this.config.maxRounds,
        fingerprint,
        prevFingerprint,
        stabilizeThreshold: this.config.stabilizeThreshold,
        arbiterConsensus,
      });
      this.convergence = conv;
      this.rounds.push(summary);
      this.emit({ type: "round.end", summary, convergence: conv, at: Date.now() });

      if (conv.converged) break;
      prevFingerprint = fingerprint;
    }

    for (const a of this.agents)
      if (a.status === "responded" || a.status === "thinking") a.status = "done";
  }

  private async runParticipantTurn(
    agent: AgentInstance,
    round: number,
    roundMsgIds: string[],
    speakers: string[],
  ): Promise<void> {
    const role = getRole(agent.roleId);
    if (!role) return;
    agent.status = "thinking";
    this.emit({ type: "agent.thinking", agentId: agent.id, round, at: Date.now() });
    const transcript = formatTranscript(this.messages);
    const res = await this.runner.complete(
      role,
      role.systemPrompt,
      buildParticipantUserMessage(this.requirement, transcript, round, role),
      round,
    );
    const msg = this.pushMessage({
      round,
      from: agent.roleId,
      fromName: agent.roleName,
      kind: "agent",
      content: res.content,
    });
    agent.status = "responded";
    agent.lastMessageId = msg.id;
    agent.tokens = (agent.tokens ?? 0) + (res.tokens ?? 0);
    roundMsgIds.push(msg.id);
    speakers.push(agent.roleId);
  }

  /** 模块三：方案生成 —— 共识转化为多个独立推荐方案。 */
  private async synthesize(): Promise<void> {
    this.setStatus("synthesizing");
    const synthesizer = this.agentByRole("synthesizer");
    if (synthesizer) synthesizer.status = "thinking";
    const transcript = formatTranscript(this.messages);
    const res = await this.runner.complete(
      requireRole("synthesizer"),
      requireRole("synthesizer").systemPrompt,
      buildSynthesisUserMessage(this.requirement, transcript, this.config.planCount),
      0,
    );
    const plans = parseRecommendationPlans(res.content, this.config.planCount);
    this.plans = plans;
    if (synthesizer) synthesizer.status = "done";
    this.emit({ type: "plans", plans, at: Date.now() });
  }

  // --- 交互确认（模块三闭环） ---------------------------------------------
  /** 用户选择某方案（交互闭环：选择）。 */
  selectPlan(planId: string): void {
    this.selectedPlanId = planId;
  }

  /** 模块四：任务执行前置 —— 拆解确认方案为有序任务，返回引擎载荷。 */
  prepareTasks(planId?: string): ConfirmPayload {
    const id = planId ?? this.selectedPlanId ?? this.plans[0]?.id;
    const plan = this.plans.find((p) => p.id === id);
    if (!plan) throw new Error("未找到选中的方案");
    this.selectedPlanId = plan.id;
    const tasks = decomposePlanHeuristic(plan);
    this.tasks = tasks;
    this.emit({ type: "task.changed", tasks, at: Date.now() });
    return buildConfirmPayload(this.requirement, plan, this.cwd ?? "", tasks);
  }

  /** 标记执行阶段完成（由 API 路由在 createChange+startRun 后调用）。 */
  markExecuting(): void {
    this.setStatus("executing");
  }

  markDone(): void {
    this.setStatus("done");
    this.emit({ type: "done", snapshot: this.getSnapshot(), at: Date.now() });
  }

  /** 退回重议（交互闭环：退回）—— 彻底重置讨论状态，注入用户反馈作为新的需求约束，重跑讨论。 */
  async rediscuss(feedback: string): Promise<void> {
    if (this.running) return;
    // 彻底重置，避免重议时 agents 重复实例化、messages 轮次错乱。
    this.error = undefined;
    this.agents = [];
    this.messages = [];
    this.rounds = [];
    this.plans = [];
    this.tasks = [];
    this.selectedPlanId = undefined;
    this.convergence = { converged: false, reason: "none", round: 0 };
    this.pendingFeedback = feedback;
    await this.run();
  }

  cancel(): void {
    this.setStatus("cancelled");
  }

  // --- 内部工具 -------------------------------------------------------------
  private pushMessage(partial: Omit<DiscussionMessage, "id" | "at">): DiscussionMessage {
    this.msgSeq += 1;
    const msg: DiscussionMessage = {
      id: `msg_${this.id}_${this.msgSeq}`,
      at: Date.now(),
      ...partial,
    };
    this.messages.push(msg);
    this.emit({ type: "message", message: msg, at: msg.at });
    return msg;
  }
}

// ---------------------------------------------------------------------------
// globalThis 注册表（跨请求 / 热重载存活）
// ---------------------------------------------------------------------------
declare global {
  var __piOrchestrators: Map<string, AgentOrchestrator> | undefined;
}

function registry(): Map<string, AgentOrchestrator> {
  if (!globalThis.__piOrchestrators) globalThis.__piOrchestrators = new Map();
  return globalThis.__piOrchestrators;
}

export function createOrchestrator(opts: OrchestratorOptions): AgentOrchestrator {
  const orch = new AgentOrchestrator(opts);
  registry().set(orch.id, orch);
  return orch;
}

export function getOrchestrator(id: string): AgentOrchestrator | undefined {
  return registry().get(id);
}

export function listOrchestrators(): AgentOrchestrator[] {
  return [...registry().values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function latestOrchestrator(): AgentOrchestrator | undefined {
  return listOrchestrators()[0];
}

export function disposeOrchestrator(id: string): void {
  registry().delete(id);
}
