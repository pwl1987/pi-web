# Plan 讨论模式 · 多 Agent 协同工作流系统

> 在「Plan 讨论模式」基础上，参考 [jnMetaCode/agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator)
> 的设计理念（**角色库即 system-prompt 插件 + 变量注入式通信 + 轮次/收敛阈值 + 人工审批节点**），
> 实现一套可落地的多智能体编排系统，作为自主编程引擎的前置规划模块。

---

## 1. 设计目标与参考映射

| agency-orchestrator 概念                         | 本实现对应                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| 角色库（216 专家 YAML，作为 system prompt 插件） | `lib/agent-orchestrator/role-library.ts` 内置 11 个专业角色 + 仲裁者 + 方案合成者 |
| YAML 声明式 DAG + `depends_on` 变量注入          | 讨论引擎的「消息队列」上下文注入；任务调度器生成有序依赖链                        |
| `loop.max_iterations`（轮次硬上限）              | `OrchestratorConfig.maxRounds`（收敛阈值之一）                                    |
| DAG Fan-in 汇总角色                              | 仲裁者（arbiter）每轮判定共识，合成者（synthesizer）汇总为多方案                  |
| 人工审批节点 `type: approval/human_input`        | PlanPanel 的「选择 / 修改 / 退回」交互闭环                                        |
| `ao compose "一句话"` 自动选人组队               | 意图解析（intent-parser）按需求动态实例化相关角色                                 |

本实现**不**把多个真实 `AgentSession` 拉进讨论，而是用「角色化单轮补全」：
每一轮、每个角色 = 一次带该角色系统提示词的 `completeSimple` 调用（参考 `app/api/agent/enhance`）。
这天然满足「只讨论、不写码」的硬约束，且后端可插拔（Mock / 真实 LLM）。

---

## 2. 总体架构

```
┌──────────────────────────────────────────────────────────────────┐
│  UI 层                                                            │
│  ChatInput（计划模式开关）──plan-mode-store──▶ AppShell           │
│  PlanPanel（需求输入→讨论时间线→多方案→确认）                       │
│       │  SSE 订阅              │  POST                            │
│       ▼                       ▼                                  │
│  /api/plan/[id]/events   /api/plan/{orchestrate,select,confirm,rediscuss} │
└───────────────┬───────────────────────────┬──────────────────────┘
                │                           │
                ▼                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  lib/agent-orchestrator（编排核心，与后端无关）                      │
│  ┌────────────┐  ┌──────────────┐  ┌────────────┐  ┌────────────┐  │
│  │intent-parser│→│discussion-    │→│convergence │→│plan-       │  │
│  │需求解析+    │  │engine(编排器) │  │收敛判定    │  │synthesizer│  │
│  │动态实例化   │  │多轮讨论/事件  │  │轮次/信号/  │  │共识→多方案 │  │
│  └────────────┘  └──────┬───────┘  └────┬───────┘  └─────┬──────┘  │
│                         │              │                │         │
│                  ┌──────┴───────┐  ┌────┴─────┐   ┌──────┴───────┐ │
│                  │ role-library │  │ runner   │   │task-scheduler│ │
│                  │ 角色库       │  │ LLM 后端  │   │方案→有序任务 │ │
│                  └─────────────┘  └──┬───────┘   └──────────────┘ │
│                                      │                            │
│                                llm-backend (completeSimple)       │
└──────────────────────────────────────┬───────────────────────────┘
                                        │
                                        ▼
                          统一自主编程引擎（createChange + startRun）
```

---

## 3. 四大核心模块

### 模块一：需求接收与解析（`intent-parser.ts`）

- 输入用户原始需求文本。
- `parseIntentHeuristic` 用中文关键词表（`TAG_KEYWORDS`）命中专业领域标签（product/architecture/security…）。
- `selectRolesFromTags` 依据标签从角色库**动态实例化**相关参与者，并强制加入
  「产品负责人」「架构师」作为基线锚点角色。
- 输出 `IntentParseResult { summary, keywords, tags, selectedRoleIds, confidence }`。
- 可选 `useLlmIntent`：经 LLM 抽取结构化意图（更准，需后端）。

### 模块二：Agent 调度与讨论（`orchestrator.ts` + `runner.ts`）

- **事件驱动 / 消息队列**：编排器是单次讨论的运行时实例，每条发言作为一条
  `DiscussionMessage` 入队；通过 `subscribe` 向外广播 `round.start / agent.thinking /
message / round.end / plans / done` 等事件（SSE 推送）。
- **多轮通信**：第 `r` 轮中，每个参与者角色基于「需求 + 截至当前的讨论上下文」产生发言；
  上下文以 `formatTranscript` 注入用户消息，对应参考架构的「变量注入」。
- **调度并发度**：`config.concurrency` 控制同一轮内参与者是串行还是并行调用 runner。
- **讨论约束**：每个角色系统提示词强制 `DISCUSS_ONLY`（只讨论、不写码）。

### 模块三：方案生成与交互确认（`plan-synthesizer.ts` + `PlanPanel.tsx`）

- 收敛后由**方案合成者**产出 `planCount` 个相互独立、各有鲜明侧重点的推荐方案，
  每个含 `title / summary / pros / cons / scenarios / confidence`。
- `parseRecommendationPlans` 优先解析 JSON，失败回退启发式分段。
- **交互闭环（选择 / 修改 / 退回）**：
  - 选择：`POST /api/plan/[id]/select`
  - 退回重议：`POST /api/plan/[id]/rediscuss` 注入用户反馈，清空轮次/方案后重跑讨论
  - 确认：`POST /api/plan/[id]/confirm`

### 模块四：任务执行（`task-scheduler.ts` + 统一引擎）

- `decomposePlanHeuristic` 将确认方案拆为有序任务（线性依赖链 `dependsOn`）。
- `buildConfirmPayload` 生成引擎载荷（标题 + 结构化描述含优缺点/场景/任务清单 + cwd）。
- `confirm` 路由调用统一引擎 `createChange` + `startRun`，并置位
  `requestOpenEngine`，由 `AppShell` 自动跳转引擎面板——实现「无缝触发自动编码」。

---

## 4. Agent 生命周期管理

```
        instantiate          join round 0
   [未创建] ───────────▶ [pending] ───────────▶ (讨论中)
                                      │
                          agent.thinking（每轮发言前）
                                      │
                          agent.responded（发言后）
                                      │
                          所有轮次结束 ──▶ [done]
                                      │
                          失败/取消     异常/用户 ──▶ [failed]/[cancelled]
```

- 角色实例 `AgentInstance` 持有 `status`、`joinedRound`、`lastMessageId`、`tokens`。
- 生命周期状态变更均通过 `emit` 广播，前端实时反映各角色「思考中/已发言」。
- 编排器实例本身挂在 `globalThis.__piOrchestrators` 注册表，跨请求 / 热重载存活；
  `latestOrchestrator()` / `getOrchestrator(id)` / `disposeOrchestrator(id)` 管理生命周期。

---

## 5. 收敛判定（`convergence.ts`）

满足任一即停止讨论（`ConvergenceState`）：

1. **arbiter_signal**：仲裁者发言以 `CONSENSUS` 开头 → `reason: arbiter_signal`。
2. **stabilized**：连续两轮「讨论指纹」Jaccard 相似度 ≥ `stabilizeThreshold`
   （默认 0.85）→ `reason: stabilized`。指纹用字符二元组（shingle）相似度，对中文友好。
3. **round_threshold**：轮次达 `maxRounds` 硬上限 → `reason: round_threshold`。

---

## 6. 关键时序（确认交接）

```
用户(PlanPanel)           API 路由                AgentOrchestrator            LLM(runner)
    │                        │                          │                        │
    │ POST /orchestrate      │                          │                        │
    ├──────────────────────▶│  createOrchestrator      │                        │
    │                        ├─────────────────────────▶│  start()               │
    │                        │                          │─parseIntent─▶         │
    │                        │                          │─instantiateAgents─────│
    │                        │                          │─runDiscussion(多轮)───│─▶ 逐角色发言
    │   SSE snapshot/events  │◀──────── subscribe ──────│  emit(message/round)  │
    ├──────────────────────▶│  (事件流)                │                        │
    │                        │                          │─synthesize()──────────│─▶ 多方案
    │                        │                          │  status=awaiting_confirm│
    │ 选择方案 + 确认         │                          │                        │
    ├──────── POST /confirm ─▶│  prepareTasks()         │                        │
    │                        ├─────────────────────────▶│  buildConfirmPayload   │
    │                        │  createChange+startRun(引擎)                        │
    │                        │  markDone + requestOpenEngine                       │
    │  AppShell 跳转引擎面板 ◀│                          │                        │
```

---

## 7. 文件清单

| 文件                                                          | 职责                                         |
| ------------------------------------------------------------- | -------------------------------------------- |
| `lib/agent-orchestrator/orchestrator-types.ts`                | 全部领域类型                                 |
| `lib/agent-orchestrator/role-library.ts`                      | 内置角色库（11 专家 + 仲裁者 + 合成者）      |
| `lib/agent-orchestrator/intent-parser.ts`                     | 需求解析 + 动态角色实例化                    |
| `lib/agent-orchestrator/convergence.ts`                       | 收敛判定（轮次/信号/稳定）                   |
| `lib/agent-orchestrator/runner.ts`                            | 可插拔 LLM Runner（Mock + completeSimple）   |
| `lib/agent-orchestrator/plan-synthesizer.ts`                  | 共识→多方案 + 解析                           |
| `lib/agent-orchestrator/task-scheduler.ts`                    | 方案→有序任务 + 引擎载荷                     |
| `lib/agent-orchestrator/llm-backend.ts`                       | completeSimple 真实后端适配                  |
| `lib/agent-orchestrator/orchestrator.ts`                      | 编排门面 + 生命周期 + 事件总线               |
| `lib/plan-mode-store.ts`                                      | Plan 模式共享 store（跨组件 + 跳转引擎信号） |
| `app/api/plan/orchestrate/route.ts`                           | 创建并启动讨论                               |
| `app/api/plan/[id]/events/route.ts`                           | SSE 事件流                                   |
| `app/api/plan/[id]/{route,select,confirm,rediscuss}/route.ts` | 快照/选择/确认/退回                          |
| `components/PlanPanel.tsx`                                    | 讨论时间线 + 多方案 + 交互闭环 UI            |
| `components/ChatInput.tsx`                                    | 计划模式工具栏开关                           |
| `components/AppShell.tsx`                                     | 计划面板挂载 + 确认后跳转引擎                |

---

## 8. 扩展点

- **新增角色**：在 `role-library.ts` 增一项，并在 `TAG_TO_ROLES` 映射领域标签即可参与讨论。
- **替换后端**：实现 `AgentRunner` 接口（如接不同模型/多真实 Session），传给 `createOrchestrator`。
- **调整收敛**：改 `OrchestratorConfig`（maxRounds / stabilizeThreshold / planCount / concurrency）。
- **增强意图解析**：开启 `useLlmIntent` 走 LLM 结构化抽取。

---

## 9. 验证

- `npx tsc --noEmit` 通过；`npx eslint` 对新增文件无 error。
- `node --test --experimental-strip-types lib/agent-orchestrator/orchestrator.test.mjs`
  覆盖意图解析、收敛三条件、方案解析（JSON + 回退）、任务拆解、端到端（Mock 收敛产方案）、
  交互闭环（确认产出引擎载荷）。
- 手动冒烟：开计划模式 → 输入需求 → 多角色讨论 → 共识 → 多方案 → 选择/退回 → 确认 → 引擎自动建变更并运行 → 跳转引擎面板。
