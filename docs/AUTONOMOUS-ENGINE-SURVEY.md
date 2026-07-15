# 自主编程引擎深度调研与落地可行性报告

> 调研对象：本项目内置「自主编程引擎」——vendored `comet`（钉选 `a2b804d`）、`autoplan`（钉选 `e06c2b2`）、`lib/unified-engine/` 适配层，以及自研 `lib/agent-orchestrator/` + `components/PlanPanel.tsx`。
> 调研日期：2026-07-15
> 方法：静态源码通读（code-explorer 子代理）+ 上游 GitHub 最新版差异比对（`git ls-remote` / `git diff` 于 `vendor/*` 本地 `.git`）。
> 供应链约束：vendor 视为不可信上游，**全程仅读源码、未执行任何上游代码/脚本**。

---

## 0. 执行摘要与关键结论

1. **三套「自主编程」实现并行存在，且互相重复**：
   - `lib/agent-orchestrator/`（自研，已上线，TS，无 Electron 依赖）——负责计划生成 + 多角色讨论 + 收敛；
   - `lib/unified-engine/`（comet/autoplan 适配层，半接入）——自带独立前端 `AutonomousCodingDashboard` 与独立 API `/api/engine/*`，与 PlanPanel 主链路平行、零复用；
   - `vendor/comet` / `vendor/autoplan`（上游引擎，未经 trim 裁剪）。
2. **autoplan 本地钉选镜像缺真实后端，但上游已补**：上游最新 `origin/main` 在 commit `bbce9de` 新增了完整 **Go 后端**（`backend/cmd/autoplan-server/main.go` + `go.mod` + `internal/application/...`，甚至提交了 `autoplan-server.exe`）。本地钉选 `e06c2b2` 仅含 Electron/前端骨架，**无 backend**——这正是 unified-engine `tryLoadVendorAutoPlan` 打开即抛错、被迫退回 LLM 直写桩的根因。该 Go 后端是**独立 sidecar 进程**，无法在 Next.js 内 import，需单独编译运行并经 IPC 对接。
3. **unified-engine「可演示但无真实价值 + 未并入主闭环」**：`hotfix` 预设 + `COMET_SKIP_BUILD=1` + `safeGuard/safeAdvance` 默认放行 + `prepareVerifyArtifacts` 伪造验证报告，使 build/verify 守卫**从未真实验证**；autoplan 真实后端缺失使其仅能 LLM 直写文件。
4. **统一决策建议（见 §6）**：以 **agent-orchestrator 为计划生成与多角色讨论主引擎**，将 unified-engine 收敛为**可选执行出口**（comet TS 状态机做真实守卫），合并持久化/事件/前端为**一套**；autoplan Go 后端作为独立 phase，不阻塞「全链路无报错」验收。

---

## 1. 开源库调研对比

### 1.1 能力矩阵

| 维度                       | comet（上游 TS 引擎）                                | autoplan（上游，钉选镜像=前端骨架）            | autoplan（上游最新=含 Go 后端）  | 自研 agent-orchestrator                             |
| -------------------------- | ---------------------------------------------------- | ---------------------------------------------- | -------------------------------- | --------------------------------------------------- |
| 语言/运行时                | TypeScript / Node                                    | Electron+React / Node（钉选仅前端）            | + Go sidecar（新增）             | TypeScript / Node                                   |
| 计划生成                   | 阶段守卫 + 外部 CLI 编排                             | `src/loop/planGeneration.js`                   | 同左 + Go `automation` 域        | 多轮角色讨论 + `plan-synthesizer`                   |
| 多角色讨论/收敛            | 无（确定性状态机）                                   | 无（任务队列）                                 | Go `chat` 域（provider_service） | **独有**：`orchestrator`+`convergence`+`controller` |
| 执行/写码                  | `classic-guard` spawnSync 调 openspec/git            | `src/loop/taskExecution.js` + `executorRunner` | Go `executors`/`runtime_handler` | 不直接写码，产出方案任务                            |
| 持久化                     | `.comet/run-state.json` + trajectory                 | `src/database.js`（sql.js WASM）               | Go + 迁移工具                    | `persistence.ts`（jsonl）                           |
| 事件/SSE                   | 无（CLI 输出）                                       | `src/renderer/lib/api/eventStream.ts`          | Go `events` 域                   | `/api/plan/[id]/events`                             |
| 宿主耦合                   | `crypto`/`fs`/`child_process`/`http`（Node Runtime） | `electron`/`node-pty`/`sql.js` WASM（重度）    | Go 进程 + IPC                    | 纯 TS，可 Node Runtime                              |
| 是否可纯 import 进 Next.js | 受限（须 Node Runtime + 隔离进程/端口）              | **不可**（Electron）                           | **不可**（Go 进程）              | **可**                                              |

### 1.2 GitHub 最新版差异比对（钉选 vs 最新）

| 仓库     | 钉选      | 最新      | 领先提交数 | 关键变更                                                                                                                                                                                                                                                                                                               | 对集成的含义                                                                                                 |
| -------- | --------- | --------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| comet    | `a2b804d` | `4dcf177` | **7**      | 多为 `test/`、`docs/`、release banner、CodeBuddy hook；运行时改动：`domains/comet-classic/*`（store/transitions/validate）、`domains/skill/*`（managed-markdown +175、platform-install、uninstall）、`domains/integrations/openspec.ts`(+12，即 #179 install scope 修复)、`platform/install/project-registry.ts`(+312) | 运行时确有改动，建议同步到最新 beta；`openspec.ts` 的 `@latest` 安装修复直接关系到 §4 P1 供应链风险          |
| autoplan | `e06c2b2` | `b40668e` | **12**     | **`bbce9de` 新增 Go backend**（`backend/go.mod` + `cmd/autoplan-server` + `internal/application/{acceptance,chat,automation,config,events,executors,...}`）；另 `src/renderer/lib/api/httpClient.ts`(+4267) 等大量前端/IPC 重构                                                                                        | **决定性差异**：真实执行引擎已在最新版以 Go sidecar 形式提供；钉选镜像缺此，导致 unified-engine 无真实委托源 |

> 结论：comet 差异较小、可平滑跟进；autoplan 差异巨大且含架构级新增（Go 后端），**钉选镜像已严重落后于"可用真实引擎"**。

---

## 2. 架构分析

### 2.1 分层与目录职责

**comet（`vendor/comet`）**

- `app/cli` → `app/commands` → `domains/{engine,comet-classic,skill,bundle,factory,integrations,dashboard}` → `platform/{fs,version,install,shell-quote}`。
- 依赖方向总体单向（CLI→domains→platform），但 `assets/skills/comet/scripts/comet-runtime.mjs`（471KB 预打包镜像）与 `domains/` 存在**同源双份实现**（见 §3）。

**autoplan（`vendor/autoplan`，钉选=前端骨架）**

- `src/main.js`（Electron 主进程）→ `src/loopService.js`（核心调度器 `LoopService extends EventEmitter`）→ `src/loop/*`（planGeneration/planLifecycle/taskExecution/runtime/concurrency/...）→ `src/executors/*` → `src/chat/llmClient.js`；`src/database.js`（sql.js WASM）。
- 循环依赖经 `runtime.js:584` 惰性 `require` 规避。
- 上游最新额外：`backend/`（Go）：`cmd/autoplan-server` + `internal/application/{acceptance,chat,automation,config,events,executors,attachments,...}`。

**unified-engine（`lib/unified-engine`）**

- 端口（`*-ports.ts`）为纯类型契约（无实现）；实现散在 `*-adapter.ts`；`unified-engine-runtime.ts` 编排；`guards/` 守卫；`persistence.ts` 独立 jsonl store。
- 反依赖：unified-engine 反向 `import` agent-orchestrator 的 `createPiLlmCompletion`（`unified-engine-adapter.ts:12`），耦合方向混乱。

**agent-orchestrator（`lib/agent-orchestrator`）**

- `orchestrator.ts`（事件驱动多轮）→ `controller.ts`（仲裁）→ `convergence.ts`（收敛）→ `plan-synthesizer.ts` / `role-library.ts`（角色）→ `runner.ts`（AgentRunner 可插拔：Mock / `createCompleteSimpleRunner`）→ `task-scheduler.ts` → `persistence.ts`（jsonl）。已接入 `app/api/plan/**`。

### 2.2 依赖拓扑与架构冲突点

- **Node 专用 API 冲突（comet）**：`tsconfig.json:18` 强制 `types:["node"]`；`domains/engine/state.ts:1-3`、`loop.ts:1` 直接 `import { randomUUID } from 'crypto'`、`import { promises as fs } from 'fs'`；`domains/dashboard/server.ts:1-3` 用 `http`/`net`。在 Next.js Edge/客户端构建期即崩溃，须限定 Node Runtime 且隔离进程。
- **全局进程副作用（comet）**：`app/cli/index.ts:71,138` `process.exit(0)`——在 Next.js server 进程内调用会杀掉整个 Node。
- **Electron 强耦合（autoplan）**：`src/main.js:5` 依赖 `electron`（`app/BrowserWindow/ipcMain`）;`src/terminal/terminalService.js:57` 用 `node-pty`。**宿主 Next.js 不应引入其 renderer/build/vite/Electron**。
- **重复建设（三处致命）**：持久化（unified-engine vs agent-orchestrator 各一套 jsonl）、事件/SSE（`EngineEvent` vs `OrchestratorEvent` + 两套路由）、前端（`AutonomousCodingDashboard` vs `PlanPanel` 零复用）。

---

## 3. 代码与性能问题清单（附 文件:行号）

### 3.1 技术债 / 代码异味 / 冗余

| 类别          | 位置                                                                                                                                                  | 问题                                                       | 证据        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------- |
| 重复实现      | `vendor/comet/domains/comet-classic/classic-guard.ts:341-350` vs `assets/skills/comet/scripts/comet-runtime.mjs:10348`                                | 同一套 spawnSync 推断 build 逻辑双份，改其一行为漂移       | 子代理比对  |
| 巨型文件      | `vendor/comet/assets/skills/comet/scripts/comet-runtime.mjs`（~471KB）、`domains/factory/package.ts`（>1600 行）、`classic-guard.ts`（35.85KB）       | 审计/维护难点                                              | 子代理      |
| 巨型函数      | `classic-guard.ts` 的 `runInferred`/`buildPasses`/`verificationCommandPasses`；`package.ts` 打包编排                                                  | >常规规模                                                  | 子代理      |
| 半成品抽象    | `vendor/comet/domains/engine/loop.ts:67-69`                                                                                                           | adaptive 模式引擎内 `return null` 依赖外部 Agent，契约不清 | 子代理      |
| 隐式配置面    | `comet-runtime.mjs` 读 `LOG_STREAM`/`LOG_TOKENS`/`COMET_*` 等大量 `process.env`                                                                       | 缺集中校验                                                 | 子代理      |
| 死层/平行系统 | `lib/unified-engine` + `components/AutonomousCodingDashboard.tsx`                                                                                     | 与 PlanPanel 主链路零复用，双 UI 并存                      | grep 0 引用 |
| 反依赖        | `lib/unified-engine/unified-engine-adapter.ts:12`                                                                                                     | unified-engine 反向 import agent-orchestrator              | 子代理      |
| 伪造验证      | `lib/unified-engine/comet-adapter.ts:47-64`（`prepareVerifyArtifacts` 写中文报告）、`unified-engine-runtime.ts:365-372`（archive 仅内存置 completed） | 守卫被"公关"通过，非真实验证                               | 子代理      |
| 降级掩盖      | `lib/unified-engine/unified-engine-runtime.ts:412-433,436-463`（`safeGuard/safeAdvance` 默认放行）                                                    | 真实失败被静默降级                                         | 子代理      |

### 3.2 性能排查（量化损耗）

| 问题                     | 位置                                                                                           | 损耗量化 / 说明                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 深冻结+深拷贝每次决策    | `vendor/comet/domains/engine/resolver.ts:20-30`                                                | `deepFreeze`+`structuredClone` 对大型 `SkillPackage` 每次 `decide`/`recordOutcome` 均 O(n) 拷贝，长链路 Run 累积 GC 压力                    |
| trajectory 全量读改写    | `vendor/comet/domains/engine/manual-run.ts:74-81`                                              | `appendEvent` 每次 `readTrajectory` 全量加载 `.comet/trajectory.jsonl` 再追加写回，随步数 **O(n) 重复读 + 全量写**，无增量 append，线性变慢 |
| 全仓库递归扫描无缓存     | `vendor/comet/domains/dashboard/collector.ts`（collectDashboardSnapshot）                      | 对 `openspec/changes` 整目录递归，大仓库 IO 放大                                                                                            |
| HTTP server 句柄泄漏风险 | `vendor/comet/domains/dashboard/server.ts:50,57`                                               | 每次 `dashboard` 命令新建 server；若调用方未显式 `close()` 泄漏监听端口（Next 进程内尤甚）                                                  |
| 迭代预算上限偏高         | `vendor/comet/assets/.../guardrails.yaml:11`（`maxIterations:500`）vs `load.ts:336`（默认 50） | 长循环上限 10×，放大上述拷贝/IO 累积                                                                                                        |

> 注：以上为静态推断的损耗量级；精确基准需端到端 profiling（见 §7 验收项）。

---

## 4. 分级安全漏洞

| 等级   | 位置                                                                                                                                                                                     | 漏洞                              | 说明 / 修复方向                                                                                                                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** | `vendor/comet/domains/comet-classic/classic-guard.ts:345`（`spawnSync(command,{shell:true})`）；`comet-runtime.mjs:10348,9658`；`classic-archive.ts:296`；`classic-state-command.ts:336` | **命令注入 / 任意命令执行**       | 命令字符串来自 `package.json` 推断 / `.comet/config.yaml` / `change` 参数；`shell:true` 分支未对参数消毒。若工作区/供应链被污染可 RCE。→ 禁用 `shell:true`，用数组传参；对 `change`/路径做白名单校验 |
| **P1** | `vendor/comet/domains/integrations/openspec.ts:175`（`npm install -g @fission-ai/openspec@latest`）；`codegraph.ts:64`（`install -g @colbymchenry/codegraph`）                           | **供应链漂移 / 未锁版本全局安装** | `@latest` 实际版本不可控，可能引入 CVE 包；最新版 #179 已修 install scope，但仍 `@latest`。→ 锁定精确版本 + 校验完整性                                                                               |
| **P1** | `vendor/comet/domains/dashboard/server.ts:50,58`（监听 127.0.0.1:4321）                                                                                                                  | **端口占用 / 进程内 server 泄漏** | 在 Next 同进程内启动会占用端口；须显式 `close()` 且限定仅本地                                                                                                                                        |
| **P2** | `vendor/autoplan/src/loop/`（安装包下载路径仅排除清单文件，未见哈希/签名校验）                                                                                                           | **下载产物完整性缺失**            | 安装包未做哈希/签名校验即执行（`shell:` 拼接命令）。→ 增加校验                                                                                                                                       |
| **P2** | `vendor/comet` 运行时无硬编码密钥（已核验 `test/` 外无 `api_key/token/secret`）                                                                                                          | 凭据管理良好                      | 配置走 `process.env`，无硬编码——保持                                                                                                                                                                 |
| **P3** | `vendor/comet/package-lock.json` / `pnpm-lock.yaml` 未做逐包 CVE 比对                                                                                                                    | 依赖漏洞待 SBOM 扫描              | 后续接 `npm audit` / `osv-scanner`                                                                                                                                                                   |
| **P3** | `vendor/*` 未按 VENDOR.lock 的 `trim` 裁剪（仍含 website/eval/platform/docs/test/ui/build）                                                                                              | **攻击面 / 体积扩大**             | 运行 `node scripts/sync-vendor.mjs` 重放 trim，或手工删非运行时目录                                                                                                                                  |

> 统一集成约束：上游视为不可信，**仅 import 经 trim 的运行时模块**（comet 的 `domains/engine`/`comet-classic` 核心、autoplan 的 Go sidecar 经 IPC），**绝不 import** `website/eval/platform/docs/test`。

---

## 5. 关键阻塞问题专项

### 类别 A：底层引擎

- **A1（最高优先级）autoplan 真实后端缺失**：钉选镜像仅前端骨架，vendored `autoplan` 无 `backend/`；`tryLoadVendorAutoPlan()` 打开 `ENGINE_AUTOPLAN_VENDOR=1` 即因 `createAutoPlanPort` 未导出而抛错（`lib/unified-engine/autoplan-adapter.ts:44-76`）。→ 上游最新已补 Go 后端，但需作为 sidecar 运行。
- **A2 comet 状态机被桩降级绕过真实验证**：`hotfix` 预设 + `COMET_SKIP_BUILD=1`（`guards/comet-cli.ts:75-80`）+ `safeGuard/safeAdvance` 放行 + `prepareVerifyArtifacts` 伪造报告（`comet-adapter.ts:47-64`），build/verify 守卫从未真实验证。
- **A3 comet Node 专用 API 与 Next.js 冲突**：`crypto`/`fs`/`child_process`/`http`（`state.ts:1-3`、`server.ts:1-3`），须 Node Runtime + 进程/端口隔离，否则构建期/运行期崩溃。

### 类别 B：联调

- **B1 双引擎持久化与事件模型重复且不互通**：`confirm` 路由同时依赖 agent-orchestrator（方案生成）与 unified-engine（执行出口），但两套全局单例 `getOrchestrator`/`getEngineRuntime` 各自独立、状态不互通（`app/api/plan/[id]/confirm/route.ts:23,74`；`unified-engine-runtime.ts:467`；`agent-orchestrator/orchestrator.ts:655`）。确认后 unified-engine 仅拿到 `prepareTasks` 拍平的 markdown，丢失多角色讨论上下文。
- **B2 反依赖方向混乱**：unified-engine 反向 import agent-orchestrator 的 `createPiLlmCompletion`（`unified-engine-adapter.ts:12`），难以独立演进/下线其一。

### 类别 C：UI 渲染

- **C1 两套并行前端零复用**：`PlanPanel.tsx`（主入口，agent-orchestrator）与 `AutonomousCodingDashboard.tsx`（unified-engine）完全独立；`PlanPanel.tsx` 内 0 引用 `StageStepper`/`RequirementTree`/`PlanTaskCard`（`components/PlanPanel.tsx` grep 0 命中）。用户面对两个互不相通的「自主编程」入口。
- **C2 监控维度缺失**：现有前端无统一的「进程监控 / 需求全生命周期 / 任务状态」三看板实时聚合；`AutonomousCodingDashboard` 仅展示 unified-engine 自身状态，未覆盖 orchestrator 运行时。

---

## 6. 分模块重构实施方案

### 6.1 统一决策（codebase-design）

> **方向：收敛为单一引擎表面，agent-orchestrator 为计划主引擎，unified-engine 降为可选执行出口。**

- **保留**：`lib/agent-orchestrator`（计划生成 + 多角色讨论 + 收敛，纯 TS、可 Node Runtime、已上线）。
- **收敛**：`lib/unified-engine` 仅作为**执行适配器**，提供 (a) comet TS 状态机真实守卫执行；(b)（可选）autoplan Go sidecar 代理。移除其独立 UI/API 与 agent-orchestrator 的竞争。
- **合并三处重复**：
  1. 持久化 → 统一为 `lib/engine-runtime-store.ts`（`globalThis` 单例 + `useSyncExternalStore`），orchestrator 与 engine 共享同一运行时状态，废 `lib/unified-engine/persistence.ts` 独立 store。
  2. 事件/SSE → 以 `/api/plan/[id]/events`（orchestrator 已有）为**唯一**流；废弃 `/api/engine/stream`，`EngineEvent` 并入 `OrchestratorEvent` 扩展字段。
  3. 前端 → 合并 `AutonomousCodingDashboard` 与 `PlanPanel` 为单一 `EngineDashboard`（见 §6.4），统一消费 `engine-runtime-store`。

### 6.2 底层引擎修复（unified-engine / comet / autoplan）

| 改造点                  | 文件                                                                           | 具体可编码修改                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 移除 hotfix 跳过验证    | `lib/unified-engine/unified-engine-types.ts:8-19`、`guards/comet-cli.ts:75-80` | `DEFAULT_WORKFLOW` 改为 `standard`（启用 build/tdd/verify 守卫）；删除 `COMET_SKIP_BUILD=1` 强制                                                                 |
| 真实守卫执行            | `lib/unified-engine/unified-engine-runtime.ts:412-463`                         | `safeGuard/safeAdvance` 失败时**上抛错误**而非静默放行；调用真实 `comet-guard.mjs`/`comet-state.mjs`（已确认存在于 `vendor/comet/assets/skills/comet/scripts/`） |
| 去除伪造验证            | `lib/unified-engine/comet-adapter.ts:47-64`                                    | 删除 `prepareVerifyArtifacts` 的 `writeFileSync` 伪造报告；改为读取 comet 真实 verify 输出                                                                       |
| autoplan 优雅降级       | `lib/unified-engine/autoplan-adapter.ts:44-76`                                 | `tryLoadVendorAutoPlan` 在 vendor 无 `createAutoPlanPort` 时**静默降级**到 LLM 直写（不抛错）；`ENGINE_AUTOPLAN_VENDOR=1` 且缺后端时记录 warn 而非中断           |
| trim 生效               | `vendor/*`（运行 `node scripts/sync-vendor.mjs`）                              | 按 VENDOR.lock 裁剪 comet 的 website/eval/platform/docs/test 与 autoplan 的 ui/build/snapshot，缩小攻击面                                                        |
| comet→Node Runtime 隔离 | `next.config.ts`（`serverExternalPackages`）、调用点                           | comet 调用限定 server 端；`dashboard/server.ts` 的 HTTP 监听禁用或显式 `close()`                                                                                 |

### 6.3 后端接入与状态同步（接口契约）

**`lib/engine-runtime-store.ts`（新增，统一状态）**

```typescript
export type EnginePhase = "idle" | "planning" | "discussing" | "executing" | "done" | "error";
export interface UnifiedEngineState {
  engineId: string;
  phase: EnginePhase;
  processes: EngineProcess[]; // 进程监控
  requirementLifecycle: RequirementNode[]; // 需求全生命周期
  taskStatus: TaskStatusSummary; // 任务状态可视
  stats: { startedAt: number; updatedAt: number; errorCount: number };
}
// globalThis 单例 + useSyncExternalStore；参考 lib/agent-runtime-store.ts
```

**SSE 端点**：扩展 `app/api/plan/[id]/events/route.ts`，在 `OrchestratorEvent` 基础上追加 `EngineProcess`/`RequirementNode`/`TaskStatus` 增量事件；`confirm` 路由在 engine 模式经统一 store 写入执行状态。

**前端订阅**：新增 `hooks/useEngineRuntime.ts`——`EventSource('/api/plan/[id]/events')` + 重连/对账（复用 `useAgentSession` 逻辑），写入 `engine-runtime-store`，组件按切片订阅，避免整页重渲染。

### 6.4 前端监控面板（EngineDashboard）

合并 `PlanPanel` + `AutonomousCodingDashboard` 为 `components/EngineDashboard.tsx`，三栏布局（暗色玻璃拟态，沿用 CSS 变量主题）：

- **顶部状态条**：phase 徽标、运行时长、错误计数、SSE 连接指示灯（hover 显示最近错误）。
- **进程监控看板 `ProcessMonitor.tsx`**：实时进程列表（运行/排队/失败），进度环、折叠日志；失败进程红色高亮 + 「查看堆栈」。
- **需求全生命周期 `RequirementLifecycle.tsx`**：需求节点泳道（已接收→讨论中→已收敛→执行中→已交付），点击联动任务列表，支持筛选/搜索。
- **任务状态可视化 `TaskStatusBoard.tsx`**：任务 pending/running/done/blocked 分布，计数卡 + 微动效；阻塞任务置顶并标注原因。

> 约束：客户端组件一律 `csrfFetchJson`（`lib/csrf-fetch.ts`），不裸写 `fetch`+`res.json()`；配置/模态复用 `components/ui/ConfigModal.tsx`；API 响应用 `jsonOk`（`lib/api-utils.ts`）。

---

## 7. 全链路落地验收标准

逐项可验证，全部须通过：

1. **质量门禁**：`npm run lint` + `npm run type-check` + `npm run test:node` + `npm run test:coverage` 全绿（husky pre-commit 门禁一致）。
2. **trim 生效**：运行 `node scripts/sync-vendor.mjs` 后，`vendor/comet` 不含 website/eval/platform/docs/test，`vendor/autoplan` 不含 ui/build/snapshot（攻击面收敛）。
3. **引擎无报错跑通（端到端）**：
   - `POST /api/plan/orchestrate` 成功创建编排 → SSE `/api/plan/[id]/events` 持续推送 phase 事件；
   - `POST /api/plan/[id]/confirm`（engine 模式）→ `getUnifiedEngineAdapter().createChange/startRun` 在 comet 适配层**不抛错**运行（移除了 hotfix 跳过 + 伪造验证后，真实守卫被执行或明确上抛）；
   - `tryLoadVendorAutoPlan` 在缺后端时**静默降级**而非中断。
4. **统一状态同步**：`engine-runtime-store` 单一实例被 orchestrator 与 engine 共用；SSE 增量写入，前端 `useEngineRuntime` 重连对账无丢失。
5. **前端交互验收**：`EngineDashboard` 三看板渲染，进程监控/需求生命周期/任务状态随 SSE 实时更新；无 console 错误；窄屏（`useIsMobile`）折叠为标签页。
6. **安全回归**：§4 中 P0（`shell:true` 命令执行）已改为数组传参 + 参数白名单；P1（`@latest` 全局安装）已锁定版本；复跑 `npm audit` 无新增高危。
7. **性能基线**：对长链路 Run，trajectory 改为增量 append（消除 `manual-run.ts:74-81` 全量读写），`decide` 深拷贝在大型 `SkillPackage` 场景做结构共享或懒拷贝，profiling 显示 GC/IO 不再随步数线性恶化。

---

## 附：核心证据索引

- comet 运行时：`vendor/comet/domains/engine/{loop,state,resolver,guardrails,manual-run}.ts`、`domains/comet-classic/classic-guard.ts`、`domains/integrations/openspec.ts`、`domains/dashboard/server.ts`、`tsconfig.json:18`。
- autoplan：`vendor/autoplan/src/{main.js,loopService.js,loop/*.js,executors/*.js,chat/llmClient.js,database.js}`；上游最新 `backend/`（Go）经 `git -C vendor/autoplan ls-tree origin/main backend` 确认。
- unified-engine：`lib/unified-engine/{unified-engine-runtime,unified-engine-adapter,unified-engine-types,autoplan-adapter,comet-adapter,persistence}.ts`、`guards/comet-cli.ts`。
- orchestrator：`lib/agent-orchestrator/{orchestrator,controller,convergence,plan-synthesizer,role-library,runner,task-scheduler,persistence}.ts`。
- 前端/路由：`components/PlanPanel.tsx`、`components/AutonomousCodingDashboard.tsx`、`components/{StageStepper,RequirementTree,PlanTaskCard}.tsx`、`hooks/useUnifiedEngine.ts`、`app/api/plan/**`（11 route）、`app/api/engine/**`。
- 供应链：`scripts/sync-vendor.mjs`、`vendor/VENDOR.lock`。
