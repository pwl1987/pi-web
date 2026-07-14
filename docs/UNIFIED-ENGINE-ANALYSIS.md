# 自主编程融合引擎 · 深度分析报告

> 分析对象：pi-web 的「统一自主编程引擎」（Unified Engine）
> 融合来源：`@rpamis/comet`（五阶段状态机）+ `@lyming99/autoplan`（需求/计划/任务）
> 分析日期：2026-07-14
> 范围：架构剖析 / 代码质量 / 性能瓶颈 / 安全漏洞 / 上游对比 / 关键阻塞排序 / A-B 两阶段建议
> 上游对比素材：`/tmp/pi-web-upstream-analysis/`（克隆落盘，不纳入 git）

---

## 0. 摘要（TL;DR）

引擎采用**端口与适配器（Hexagonal）+ 门面（Facade）+ 单例（Singleton）**架构，分层清晰、对外接口稳定。当前默认实现的 `autoplan-adapter` 是**纯内存桩**，仅借用上游的「需求→计划→任务」词汇，并未接入真实 autoplan 引擎；`comet-adapter` 通过白名单 `child_process` 调用 vendored `comet/*.mjs` 脚本，是真正可运行的状态机骨架。

**最关键的阻断问题**是 `POST /api/engine/runs` 的 `start`/`resume` 会 `await` 整个五阶段循环（`runLoop`）才返回响应——接真实 LLM/autoplan 后必挂死超时。其次为模块级 Map 内存泄漏、pause 无法中断在途循环、cwd 任意目录写/路径穿越风险、前端裸 `fetch` 且无 SSE 重连。

本报告同时给出 A 阶段（加固桩流程+打磨 UI，让五阶段端到端稳定可演示）与 B 阶段（真实 autoplan 接入骨架与开关）的落地建议。

---

## 1. 架构剖析

### 1.1 设计模式

| 模式                      | 落点                                                                                      | 说明                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 端口与适配器（Hexagonal） | `unified-engine-ports.ts` / `plan-generator-ports.ts` / `workflow-state-machine-ports.ts` | 业务层只依赖 `UnifiedEnginePort` 等接口，不感知 comet/autoplan 差异。                                                 |
| 门面（Facade）            | `unified-engine-adapter.ts`                                                               | `createUnifiedEngineAdapter()` 把 `PlanGeneratorPort` + `WorkflowStateMachinePort` + `EngineRuntime` 组装成统一端口。 |
| 单例（Singleton）         | `unified-engine-runtime.ts` `getEngineRuntime()`                                          | 实例挂在 `globalThis.__piEngineRuntime`，跨 Next.js 热重载存活（与 `rpc-manager` 同思路）。                           |
| 发布/订阅（Observer）     | `EngineRuntime.subscribe()`                                                               | 状态变更经 `emit()` 推送给 SSE 订阅者。                                                                               |
| 仓储/持久化（Repository） | `persistence.ts`                                                                          | `loadAllEngineRuns` / `saveEngineRun`，整文件原子重写落 `<agentDir>/pi-web-engine-runs.jsonl`。                       |
| 不可信供应链隔离          | `guards/comet-cli.ts`                                                                     | 绝不 `import()` 上游 471KB 运行时，全部经白名单 `child_process` 隔离执行。                                            |

### 1.2 目录结构与模块依赖

```
app/api/engine/
├── runs/route.ts        POST: {runId, action: start|pause|resume}；GET: 列举
├── changes/route.ts     POST: 创建变更（需求 + comet change）
├── stream/route.ts      GET: SSE 事件流
├── history/route.ts     GET: 历史（同 runs 逻辑，rehydrate）
└── log/route.ts         GET: 结构化日志尾部（读 pi-engine.log）

lib/unified-engine/
├── unified-engine-adapter.ts    [组合根] 唯一上游导入处
├── unified-engine-runtime.ts    [编排] runLoop: open→design→build→verify→archive
├── unified-engine-ports.ts      UnifiedEnginePort 门面接口
├── unified-engine-types.ts      Stage / RunState / Task 等领域类型
├── plan-generator-ports.ts      PlanGeneratorPort（autoplan 侧）
├── workflow-state-machine-ports.ts  WorkflowStateMachinePort（comet 侧）
├── autoplan-adapter.ts          PlanGeneratorPort 的内存桩实现
├── comet-adapter.ts             WorkflowStateMachinePort 的脚本调用实现
├── guards/comet-cli.ts          白名单 child_process 封装
└── persistence.ts               运行态 jsonl 持久化（原子 tmp+rename）

hooks/useUnifiedEngine.ts        前端状态机 + SSE 订阅
components/AutonomousCodingDashboard.tsx + StageStepper / PlanTaskCard / RequirementTree
vendor/comet/*.mjs               真实状态机脚本（被 comet-cli 调用）
vendor/autoplan/                 仅前端骨架，无后端引擎（见 §5）
```

**依赖方向（单向、无环）**：
`API 路由 → unified-engine-adapter（门面）→ EngineRuntime → {autoplan-adapter, comet-adapter} → comet-cli → vendor/comet/*.mjs`。
客户端（`hooks/components`）**只**依赖 `unified-engine-types` 与 `csrf-fetch`，不会把 vendor 拉进 bundle（满足 `serverExternalPackages` 约束）。

### 1.3 运行时编排（`runLoop`）

```
createChange → 建 requirement + comet openChange(changeName, hotfix, cwd) → 落盘 RunState(idle)
startRun     → status=running, emit, await runLoop(run)
  runLoop:
    ensureChange(自愈)
    generatePlan(需求→计划) → enqueueTasks(→ tasks) → prepareBuildDeliverables(写 proposal.md/tasks.md)
    advanceStage("open")        // open→build（hotfix 直接到 build）
    for task in tasks: runTask  // 桩：直接 completed
    advanceStage("build") 前的 guard("build")
    prepareVerifyArtifacts(写 verification-report.md + 置 branch_status=handled)
    guard("verify") → advanceStage("verify")
    stage=archive, status=completed
```

---

## 2. 代码质量（技术债与异味）

| #   | 位置                                  | 异味 / 技术债                                                                                                                                                     | 严重度 |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Q1  | `autoplan-adapter.ts:22-24`           | 模块级 `requirements/plans/tasks` 三个 `Map` **只增不减**，跨请求常驻，无清理路径（内存泄漏）。                                                                   | 中     |
| Q2  | `runtime:39-40` vs `autoplan-adapter` | **双份 requirement 真相源**：runtime 持 `requirements`，adapter 又持一份；rehydrate 仅重建 runtime 侧，adapter 侧 `generatePlan` 依赖入参而非 Map，二者易不一致。 | 中     |
| Q3  | `autoplan-adapter.ts:80`              | `generatePlan` 写 `requirementId: req.title`，用标题冒充 requirementId，语义错位（虽当前无 lookup 依赖，属于误导性代码）。                                        | 低     |
| Q4  | `runtime:166-195`                     | `startRun` / `resumeRun` 直接 `await this.runLoop(run)`，HTTP 与长任务耦合（见 §4 P0）。                                                                          | 高     |
| Q5  | `runtime:177-184`                     | `pauseRun` 仅置 `paused`，**不中断**已在 `await` 中的 `runLoop`；`runLoop` 各步骤间不检查 `status`，导致 pause 实际无效。                                         | 高     |
| Q6  | `runtime:186-195`                     | `resumeRun` 重头跑完整 `runLoop`（重新 generatePlan、重跑全部 task），非断点续跑，重复劳动且会覆盖已有进度。                                                      | 高     |
| Q7  | `comet-adapter.ts:47-64`              | `prepareVerifyArtifacts` 把 `verification_report` 写盘并在 `.comet.yaml` 记录相对路径——逻辑正确但散落在适配器里，缺统一的「交付物写入」抽象。                     | 低     |
| Q8  | `useUnifiedEngine.ts:34-35,66-72`     | 前端**裸写 `fetch + res.json()`**，违反项目约定（应使用 `csrfFetchJson`），无乐观更新、无重试。                                                                   | 中     |
| Q9  | `useUnifiedEngine.ts:44-56`           | `EventSource` 无 `onerror` 重连逻辑；断线后事件流静默失效（对齐 `PlanPanel` 的 `onerror→setTimeout` 重连模式缺失）。                                              | 中     |
| Q10 | `AutonomousCodingDashboard.tsx`       | 控制按钮（start/pause/resume）无「进行中禁用态」；无失败红色横幅；任务级失败原因未展示；加载/空/错态不统一。                                                      | 中     |

---

## 3. 性能瓶颈

| #   | 位置                              | 问题                                                                                                                                                                  | 影响             |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| P1  | `autoplan-adapter.ts` 模块级 Map  | 只增不减，多会话/多次创建后持续占用内存；进程重启虽重置，但**长生命周期 dev server 下永不释放**。                                                                     | 内存泄漏（中）   |
| P2  | `persistence.saveEngineRun`       | 每次 stage 变化 / 每个 task 完成都**整文件重写**。一次 run ≈ 10 次全量重写。run 数多时 I/O 放大，但单 run 量小，属可接受的 best-effort。                              | 冗余 I/O（低）   |
| P3  | `useUnifiedEngine` 的 `refresh()` | 每个非 log/guard 事件都触发 `GET /api/engine/runs`。事件密集时产生「事件→刷新→列表」反馈环；`listRuns` 内 `ensureRehydrated` 首跑后做内存缓存，磁盘读仅一次，故尚可。 | 高频刷新（低）   |
| P4  | `runtime.runs` Map                | 未设上限；依赖 idle 超时清空 + 持久化 `MAX_RECORDS=100` 间接约束。长时间运行大量 run 时内存随在途数增长。                                                             | 内存无上界（低） |
| P5  | SSE 单订阅、无轮询                | 设计良好；无额外性能问题。                                                                                                                                            | —（正向）        |

> 结论：性能主要风险集中在 **Q1/P1 的内存泄漏**（模块级 Map 只增不减），其余为低危冗余。

---

## 4. 安全漏洞

| #   | 位置                                                                          | 风险                                                                                                                                                                            | 严重度 |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| S1  | `autoplan-adapter.writeDeliverables` / `comet-adapter.prepareVerifyArtifacts` | `cwd` 由前端任意传入，直接作为 `mkdirSync(join(cwd,"openspec/..."))` 与 `writeFileSync` 目标，**无 allowed-roots 校验** → 任意目录写 / 路径穿越（如 `cwd=/etc/` 或 `../../`）。 | 高     |
| S2  | `changes/route.ts` / `runs/route.ts`                                          | `title` / `description` / `cwd` 无长度与字符约束；超大 title 会撑大持久化文件与 proposal.md。                                                                                   | 中     |
| S3  | `guards/comet-cli.ts:48-52`                                                   | 已对 argv 拒绝 `..` 与 `\0`，但 `comet-state.mjs set <change> <field> <value>` 的 `value` 未做白名单/长度约束（当前值均为项目内生成，风险可控；接入真实 change 名时须补校验）。 | 低     |
| S4  | `stream/log/history/runs` GET                                                 | 无 CSRF（只读/SSE，可接受）；无鉴权（本地工具，与全站一致，可接受）。                                                                                                           | 低     |
| S5  | POST 路由                                                                     | 已 `validateCsrf`，符合约定。                                                                                                                                                   | 正向   |

> 核心安全改造点：**S1（cwd→allowed-roots）+ S2（输入约束）**。

---

## 5. 上游对比（vendored vs upstream）

克隆上游到 `/tmp/pi-web-upstream-analysis/` 后，与 `vendor/` 比对：

### 5.1 comet

| 维度 | upstream `rpamis/comet`                                                                     | vendored `vendor/comet`                             | 差异                                                              |
| ---- | ------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| 形态 | 纯 Node 运行时（0.4.0 起不再依赖 Bash/WSL），CLI + 脚本壳                                   | 同，保留 `assets/skills/comet/scripts/*.mjs`        | 微调：domains 117→109、test 130→116、assets 79→78，功能脚本无缺失 |
| 设计 | 状态机（open→design→build→verify→archive）+ phase guards + OpenSpec artifacts + Superpowers | pi-web 经 `comet-cli` 白名单调用其 `.mjs`，完美对齐 | 融合度高                                                          |

**融合评价**：comet 侧是「真骨架」，pi-web 的白名单隔离调用方式安全且对齐上游设计意图，是融合最成功的部分。

### 5.2 autoplan

| 维度     | upstream `lyming99/autoplan`                                                                            | vendored `vendor/autoplan`                                       | 差异（关键）                                    |
| -------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| 形态     | Electron + Vite 桌面 App，**含 Go 后端 `backend/`（455 文件）** 与 `scripts/`                           | **仅保留 `src/`（前端 173 文件）+ `ui/` + `docs/`**              | `backend/`（Go 引擎）与 `scripts/` **完全缺失** |
| 真实引擎 | `loopService.js` + `intakeService.js` + `executors/` + `database.js`（SQLite）驱动 24h「需求→反馈」循环 | 无对应实现，仅有 `autoplan-adapter` 内存桩                       | 真实引擎不可用                                  |
| 设计     | 需求/计划/任务数据模型 + 持久化 + 事件流 + 循环驱动器                                                   | pi-web 仅借用其**词汇**（requirement/plan/task），未借其**引擎** | 融合度低（仅词汇层）                            |

**关键发现**：vendored autoplan **不包含可执行后端**，因此 B 阶段「真实接入」要么 (a) 补回缺失的 Go 后端并桥接，要么 (b) 在 `autoplan-adapter` 内用 `ENGINE_AUTOPLAN_VENDOR` 动态加载其 `loopService`/`intakeService`（JS 部分）重实现循环驱动器。当前桩实现仅满足「让五阶段流程跑通演示」，不产出真实代码。

### 5.3 融合点小结

- **骨架**：comet 五阶段状态机（真实可用）。
- **内容源**：autoplan 需求/计划/任务模型（仅词汇，桩实现）。
- **编排**：pi-web 自研 `EngineRuntime` 把两者粘合成 `open→design→build→verify→archive`。
- **缺口**：autoplan 的真实「循环驱动器 + LLM 执行」缺失，是 B 阶段的核心工作。

---

## 6. 关键阻塞问题排序

| 优先级 | 问题                                       | 编号      | 阻断表现                                            |
| ------ | ------------------------------------------ | --------- | --------------------------------------------------- |
| **P0** | `start`/`resume` `await` 整个 `runLoop`    | Q4        | 接真实 LLM/autoplan 后 HTTP 必挂死/超时（头号阻断） |
| **P1** | 模块级 Map 内存泄漏                        | Q1/P1     | 长生命周期 dev server 内存只增不减                  |
| **P1** | pause 无法中断在途循环、resume 重头跑      | Q5/Q6     | 控制失效、进度被覆盖                                |
| **P1** | cwd 任意目录写 / 路径穿越                  | S1        | 安全：可写任意路径                                  |
| **P2** | 前端裸 fetch + 无 SSE 重连 + 无禁用/错误态 | Q8/Q9/Q10 | UX：断线静默失效、状态不自洽                        |
| **P2** | 双份 requirement 真相源                    | Q2        | 一致性风险                                          |
| **P3** | title/description/cwd 无约束               | S2        | 输入放大                                            |
| **P3** | change 名/field 值校验不足                 | S3        | 接入真实 change 名时风险                            |

---

## 7. A / B 两阶段重构建议

### A 阶段（本次落地：让桩流程 + UI 稳定可演示）

1. **后端异步化（解 P0）**
   - `startRun` / `resumeRun` 仅置 `running`、持久化、`emit`、**不 `await` `runLoop`**，立即返回；`runLoop` 在微任务/后台执行，进度的全程经 `emit` → SSE。
   - 重入保护：`runtime` 维护 `runningIds: Set<string>`，已在跑的 run 忽略重复 `start`；`createChange` 幂等。
2. **内存与真相源修复（解 P1/Q1/Q2）**
   - `autoplan-adapter` 的模块级 Map 收拢为 **runtime 持有的实例字段** 或随 run 生命周期清理（run 完成/失败时清对应键），消除只增不减。
   - 单一 requirement 真相源：`requirements` 仅由 `EngineRuntime` 持有，`planGen.generatePlan` 继续使用入参。
3. **鲁棒性（解 P1/Q5/Q6）**
   - `runLoop` 在阶段切换与每个 task 后 **cooperatively 检查 `run.status === "paused"`**，命中则保存并 `return`（pause 真正中断在途循环）。
   - `resumeRun` 基于已落盘 `stage` **断点续跑**（跳过已完成阶段/任务），而非重头。
   - `runs` 内存 Map 增加上限裁剪（与 `MAX_RECORDS=100` 对齐）。
4. **安全加固（解 P1/S1/S2）**
   - `changes` / `runs` 路由对 `cwd` 调用 `allowedRoots` 校验（绝对路径 + 允许根集合），否则拒绝。
   - `title` / `description` 加长度（≤200）与字符约束。
   - 强化 `comet-cli`：change 名与 field 值白名单 + 长度 + 路径穿越校验。
5. **前端改造（解 P2/Q8/Q9/Q10）**
   - `useUnifiedEngine` 改用 `csrfFetchJson`；SSE `onerror→setTimeout` 重连；`controlRun` 乐观更新 + 禁用态。
   - 打磨 `AutonomousCodingDashboard`：进行中/禁用/错误/空态、任务进度条与失败原因、事件/日志双视图体验；阶段进行中旋转/脉冲指示；失败红色横幅。
   - 用户可见文案统一走 `lib/i18n/zh.ts`。
6. **验收**：保持 `npm run ci` 全绿（format:check / lint / type-check / test:node / test:coverage）。

### B 阶段（仅规划骨架与开关，不强制接真实 LLM）

1. **动态加载骨架**
   - 在 `autoplan-adapter` 增加 `ENGINE_AUTOPLAN_VENDOR` 分支，用 `createRequire(import.meta.url)` / `import()` **动态加载**（表达式不可被 webpack 静态求值，规避 "server relative imports are not implemented yet"）。
   - 真正消费其 `loopService` / `intakeService` 返回值，补回 vendored 缺失的循环驱动器，或文档化「需补回 Go 后端 `backend/`」。
2. **接入点清单**
   - `PlanGeneratorPort.runTask`：从「直接标 completed」改为委托真实执行器。
   - `EngineRuntime.runLoop`：design/build 阶段接入真实 LLM 补全与代码写入。
   - 持久化/事件模型已就绪，B 阶段主要替换桩实现，不动编排骨架。
3. **风险与后续任务**
   - vendored autoplan 缺后端 → 需决策「补回 Go 后端」或「用 JS 重实现循环驱动」。
   - 真实执行需受 `allowed-roots` / 命令白名单约束，复用现有安全加固。
   - 接 LLM 后须重测 SSE 长连接稳定性与内存上限。

### 7.1 B 阶段接入清单（核对表）

`autoplan-adapter.ts` 已落地 `ENGINE_AUTOPLAN_VENDOR` 动态加载骨架：

| 项                                   | 状态      | 说明                                                                                                                            |
| ------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 动态加载分支                         | ✅ 已落地 | `tryLoadVendorAutoPlan()`：`ENGINE_AUTOPLAN_VENDOR=1` 时 `createRequire(import.meta.url)(变量路径)` 加载，规避 webpack 静态求值 |
| 失败回退                             | ✅ 已落地 | 加载失败 → `log warn` + 回退内存桩，引擎始终可演示                                                                              |
| 映射接入点                           | 🔲 骨架   | `mapVendorToPlanGenerator()`：期望 vendored 导出 `createAutoPlanPort()`；未实现时明确抛错                                       |
| vendored 后端                        | 🔲 缺失   | `vendor/autoplan/backend/`（Go，455 文件）与 `scripts/` 不在 vendor 中，需补回或用 JS 重实现 `loopService`/`intakeService`      |
| `PlanGeneratorPort.runTask` 真实执行 | 🔲 待办   | 从「直接标 completed」改为委托真实执行器（写码 + 测试）                                                                         |
| `EngineRuntime.runLoop` 接 LLM       | 🔲 待办   | design/build 阶段接真实补全与代码写入（编排骨架不变）                                                                           |
| `AUTOPLAN_VENDOR_MODULE` 环境变量    | ✅ 已支持 | 可指定 vendor 模块路径，默认 `autoplan-loop-service`                                                                            |

> 打开开关（不接真实后端时仍走内存桩，仅多一次动态加载尝试）：
> `ENGINE_AUTOPLAN_VENDOR=1 npm run dev`

---

## 8. 结论

引擎架构设计合理（端口隔离、单例、SSE 推送），comet 侧融合成功。当前**最大阻碍是 `start/resume` 同步 `await` 长循环导致 HTTP 挂死**，以及内存泄漏、控制失效与安全校验缺失。A 阶段在不改变对外行为的前提下修复这些阻断并打磨 UI，即可让五阶段端到端稳定可演示；B 阶段再据动态加载骨架接入真实 autoplan 引擎。
