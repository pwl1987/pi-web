# AutoPlan 源码级分析（vendored @ e06c2b2）

> 钉选 commit：`e06c2b2be052e141ccb19c1e18b16f2927d5cd89`（main）｜License：Apache-2.0
> 定位：支持 24 小时自主执行编程任务的开源工具；依赖外部 AI 编码引擎（Claude/Codex/OpenCode）实际写码。

## 1. 形态与关键事实（集成前提）

- **Electron 桌面应用**，但业务逻辑全部是纯 Node CommonJS 模块，与前端（React/Vite）在 `src/renderer/` 中完全分离，可独立抽取为服务端模块。
- 核心逻辑层**不依赖浏览器 API**；持久化使用 `sql.js`（WASM SQLite，单文件 `.sqlite`）。
- **必须排除**（仅前端/Electron 侧）：`src/renderer/`（React+Vite）、`src/terminal/`（xterm.js + node-pty）、`src/main.js`（Electron 主进程组装）、`src/preload.js`。

## 2. 目录布局与职责

```
src/
├── database.js            # AppDatabase 工厂 + 全部 SQL 表结构（sql.js）——持久化核心
├── loopService.js         # ★ LoopService 主类：调度/扫描/执行/事件/快照（~848 行）
├── intakeService.js       # ★ IntakeService：需求/反馈/项目的创建与去重入口
├── agentCli.js            # ★ CLI 参数拼装：codex/claude/opencode 的 spawn 参数构造
├── chat/
│   ├── llmClient.js       # 统一 LLM 客户端（openai SDK，支持多 provider）
│   └── aiConfigService.js  # 解析 ai_configs 表 → provider/baseUrl/apiKey/model
├── loop/
│   ├── planGeneration.js       # 计划生成（issue 扫描驱动 + 单条需求驱动）
│   ├── builtinPlanGenerator.js # ★ LLM 结构化计划生成（调用内置 llmClient）
│   ├── planLifecycle.js        # Plan 生命周期：insertPlan/redo/激活/状态机
│   ├── planTaskSync.js         # 从 Markdown 解析任务 → plan_tasks 表
│   ├── taskExecution.js        # ★ 任务执行/重试/完成（processPlan）
│   ├── taskEvents.js           # 任务事件状态枚举（TASK_EVENT_STATUS/TYPES）
│   ├── runtime.js              # ★ 工作循环运行时：调度器、进程注册表、启停
│   ├── structuredPlanSpec.js   # PlanSpec 校验/规范化（数据模型）
│   ├── planAgentCli.js / agentCliRunner.js / agentCliConfig.js / planBackendConfig.js
│   └── planParser.js / planRenderer.js / snapshots.js / acceptance.js / validation.js / concurrency.js
├── executors/
│   ├── executorRunner.js   # shell/plugin 进程 spawn 与依赖编排
│   ├── executorStore.js    # 执行器 CRUD（DB）
│   └── executorConfig.js
└── mcpServer.js / mcpTools.js / mcpConfig.js  # MCP(JSON-RPC) 服务端（天然服务端接口）
```

## 3. 自动化计划生成逻辑

- 生成有两种入口，均支持三种策略（`loop/planGeneration.js`）：
  1. `external-cli-markdown`：调用外部 coding agent（codex/claude/opencode）直接写 Markdown plan 文件。
  2. `external-cli-structured`：调用外部 agent，输出 PlanSpec JSON 文件。
  3. `builtin-llm-structured`：★ 由 AutoPlan **内置 LLM** 生成 PlanSpec（不依赖外部 agent）。
- 主入口：
  - `generatePlan(service, helpers, projectId, workspace, issueScan)` — issue 扫描驱动。
  - `generatePlanForIntake(service, helpers, projectId, workspace, intake)` — 单条需求/反馈驱动（集成首选）。
- 内置生成器 `builtinPlanGenerator.js` 调用 `chat/llmClient.js`（openai SDK，多 provider）→ 产出结构化 `PlanSpec`（`loop/structuredPlanSpec.js` 校验/规范化）。

## 4. 任务队列与执行

- 数据模型：`plan_tasks` 表（由 `database.js` 定义）+ `PlanSpec`（任务列表）。任务含状态、重试、回溯链。
- 入队：`planTaskSync.js` 从 Markdown/PlanSpec 解析任务写入 `plan_tasks`。
- 派发/执行：`taskExecution.js` 的 `processPlan(...)` 负责执行、重试、完成；`taskEvents.js` 定义状态枚举。
- 持久化：`database.js`（sql.js WASM SQLite，单文件 `.sqlite`）。

## 5. 执行器桥接（外部 agent）

- `agentCli.js` 拼装 codex/claude/opencode 的 spawn 参数；`loopService.js` 的 `runShell(...)` 实际 spawn。
- `executors/executorRunner.js` 负责用户自定义 shell/plugin 脚本的进程 spawn 与依赖编排。
- **安全提示**：这部分会 shell-out 到外部 coding agent，属供应链/运维风险；集成时必须 feature flag 门禁（`ENGINE_AUTOPLAN_EXECUTOR`），且要求目标 CLI 与凭证已就绪。

## 6. 需求与反馈流

- `intakeService.js`：`createRequirement(...)` / `createFeedback(...)` 为需求/反馈的创建与去重入口。
- 反馈闭环：任务执行失败/验证不通过时，feedback 回灌重规划。

## 7. 工作循环调度

- `loop/runtime.js`：调度器（`createUnrefInterval`）、进程注册表、启停。
- `loopService.js` 的 `start()` / `runOnce()`：24h 循环主体；空闲/重启行为由 runtime 控制。

## 8. 集成映射（PlanGeneratorPort → 真实模块）

| 端口方法                           | 真实调用                                                | 说明                       |
| ---------------------------------- | ------------------------------------------------------- | -------------------------- |
| `generatePlan(req)`                | `loop/planGeneration.js: generatePlanForIntake(...)`    | 单条需求驱动计划生成       |
| `enqueueTasks(planId)`             | `loop/planTaskSync.js` + `planLifecycle.js: insertPlan` | 解析 PlanSpec → plan_tasks |
| `runTask(taskId, ctx)`             | `loop/taskExecution.js: processPlan(...)`               | 任务执行/重试              |
| `submitFeedback(taskId, feedback)` | `intakeService.js: createFeedback(...)`                 | 反馈回流重规划             |

**集成约束**：

- autoplan 核心依赖 `sql.js` + LLM 配置（`chat/aiConfigService.js`）+ 外部 agent CLI。适配层经 `dynamic require('@/vendor/autoplan/src/...')` 接入，但须：
  1. 由 `ENGINE_AUTOPLAN_ENABLED` 门禁；
  2. 提供不依赖外部 agent 的**降级路径**（如内置 PlanSpec 解析 + 内存任务队列）保证引擎可演示；
  3. 所有外部 spawn 走白名单 + 参数校验。
- `src/renderer`、`src/terminal`、`src/main.js` 绝不引入。
