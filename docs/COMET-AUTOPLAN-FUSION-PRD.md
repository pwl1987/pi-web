# 自主编程引擎融合 · 产品需求文档（PRD）

> 文档状态：草案（待评审）
> 创建日期：2026-07-15
> 关联文档：`docs/COMET-AUTOPLAN-FUSION-REPORT.md`（融合架构调研）、`docs/AUTONOMOUS-ENGINE-FUSION.md`（架构方案，其中 Go sidecar 落地方案已加注作废）、`docs/AUTONOMOUS-ENGINE-SURVEY.md`（结构化调研）
> 硬约束：全量 TypeScript，**零 Go 依赖**（2026-07-15 起生效）；文档与用户可见文案全中文（走 `lib/i18n/zh.ts`）。

---

## 0. 验证结论（报告 vs 当前代码 · 实测）

本 PRD 的全部落地型结论，均基于上一轮对 `docs/COMET-AUTOPLAN-FUSION-REPORT.md`（以下简称"报告"）与当前 pi-web 代码的**逐项代码实测**。核心发现：**底层引擎骨架已达标，但报告定义的"统一状态面 + 三看板前端"尚未落地，且实际出现了比报告所述更严重的"状态面分裂"（三套并存）**。

| #   | 报告主张                                                                                 | 当前代码实测                                                                                                                                                                             | 差异等级                     |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| V1  | `engine-runtime-store`+`useEngineRuntime` 是"双引擎合并的唯一监控状态表面"，前端统一消费 | `useEngineRuntime` 全仓库**无任何 UI 消费**（仅自身 + 文档引用）；`AutonomousCodingDashboard` 实际用平行的 `hooks/useUnifiedEngine.ts`（消费 `/api/engine/runs` + `/api/engine/stream`） | **严重冲突**                 |
| V2  | 合并为唯一 `EngineDashboard.tsx`，含进程监控 / 需求全生命周期 / 任务状态**三看板**       | `EngineDashboard.tsx` **不存在**；`AutonomousCodingDashboard` 为单 run 视角（runs/stages/tasks/logs），无三看板；`PlanPanel.tsx` 仍独立存在                                              | **严重缺失**                 |
| V3  | autoplan 执行体委托 pi-web `AgentSession`（`startRpcSession().send()`）                  | `autoplan-llm-adapter.runTask`（`:296-339`）**自包含** LLM 直写 + `safeWrite` + `executeTests`，未用 `AgentSession`                                                                      | **冲突（中）**               |
| V4  | `safeGuard/safeAdvance` 失败须**上抛错误**而非静默放行                                   | `unified-engine-runtime.ts:500` 与 `:509-510` 捕获异常后仍 `passed:true`（"comet 不可用，默认放行"）；守卫绕过仍在                                                                       | **冲突（P1 未修）**          |
| V5  | `DEFAULT_WORKFLOW` 改为 `"standard"`                                                     | 仍为 `"hotfix"`（`unified-engine-types.ts:19-24` 注释解释：桩仅产出 proposal/tasks.md，仅 hotfix 能跳过四项守卫）                                                                        | **合理差异（待产品决策）**   |
| V6  | 删除 `prepareVerifyArtifacts` 伪造报告                                                   | `comet-adapter.ts:47-68` 仍写中文 `verification-report.md`，但受 `ENGINE_REAL_VERIFY=1` 门控且带诚实标注                                                                                 | **部分缓解（待决策默认值）** |
| V7  | 统一状态含 `autoplan?: { ready, features }` 桥接字段                                     | `UnifiedEngineState` **无该字段**（`engine-runtime-store.ts:42-49`）；autoplan-ts 状态未桥接                                                                                             | **缺失**                     |
| V8  | autoplan 专属 API `app/api/engine/autoplan/route.ts` 已移除                              | `app/api/engine/autoplan/` 目录**存在但为空**（无 route 文件）                                                                                                                           | **遗留空目录**               |
| V9  | 需求全生命周期看板数据来自 `requirementLifecycle`                                        | `engine-runtime-store` 有 `requirementLifecycle` 字段，但 `AutonomousCodingDashboard` 不读它（走 `useUnifiedEngine`）→ 该看板无数据来源                                                  | **缺失（派生于 V1）**        |

**正向确认（已达标项）**：

- `/api/engine/state`、`/api/engine/stream` 路由已就绪，且 `publish()` 每次 `emit` 都会刷新 store（`unified-engine-runtime.ts:134-143`）。
- `autoplan-llm-adapter` 已做**真实 LLM 写码 + 测试验证 + 熔断**（优于内存桩）。
- comet 守卫在可用时真实执行：`advanceStage` 失败抛错（`comet-adapter.ts:71-74`）。
- `engine-runtime-store` 已内置 `requirementLifecycle`（`RequirementNode[]`）与 `taskStatus`（`TaskStatusSummary`）派生逻辑（`engine-runtime-store.ts:46-49, 60+`）。

> 结论：本 PRD 以"对齐报告设计、消除状态面分裂"为首要目标。

---

## 1. 项目背景与目标

### 1.1 背景

本项目（pi-web，`@agegr/pi-web`，Next.js 16 App Router + TypeScript 19/React 19 全栈应用）内置"自主编程引擎"，来源有三：

- **comet**：阶段守卫 / OpenSpec 生命周期（TS/Node，vendored 于 `vendor/comet/`）。
- **autoplan**：需求 → 计划 → 任务 → 执行 → 反馈全生命周期（上游为 Go 后端，已按**禁用 Go**约束全量 TS 等价移植于 `lib/unified-engine/autoplan-adapter.ts` 等）。
- **pi-web 既有 `AgentSession`**：真实写码执行体（`lib/rpc-manager.ts`）。

调研与可行性报告已产出（见关联文档）。现状问题：底层引擎骨架已建，但**前端状态面分裂为三套**，且报告定义的统一监控看板未落地，导致交付物不可观测、不可交互。

### 1.2 目标

- **G1 统一状态面**：消除 `PlanPanel` / `AutonomousCodingDashboard`（经 `useUnifiedEngine`）/ 孤儿 `engine-runtime-store` 三套并存，收敛为唯一状态源 + 唯一看板。
- **G2 全链路无报错**：底层引擎（comet 守卫 + autoplan-ts 生命周期）端到端可跑通。
- **G3 可交互前端**：交付进程监控 / 需求全生命周期 / 任务状态三看板，实时 SSE 驱动。
- **G4 安全合规**：消除命令注入面、锁版本、真实守卫执行、高危清零。
- **G5 硬约束**：全程 TypeScript，**零 Go 依赖**。

### 1.3 范围与非目标

- **在范围内**：状态面合并、三看板前端、autoplan-ts 生命周期贯通、守卫真实化、安全修复、遗留清理。
- **非目标（本次不做）**：复刻 autoplan Go 的 SQLite/PTY/MCP 进程外壳（报告 §5.1 已判定"无需复刻"，同进程编排即可）；Electron 迁移证据网关。

---

## 2. 功能需求清单（含优先级与验收标准）

### FR-1 统一引擎状态层（解决 V1 / V7 / V9）

- **优先级 P0**
- **内容**：
  - 确认 `engine-runtime-store` 为唯一状态源；
  - `UnifiedEngineState` 新增 `autoplan?: { ready: boolean; features: string[] }`（`engine-runtime-store.ts:42` 接口处）；
  - `AutonomousCodingDashboard` 与 `PlanPanel` 全部改消费 `useEngineRuntime` / `engine-runtime-store`；
  - 删除平行 `useUnifiedEngine` 与 `/api/engine/runs` 直读。
- **验收**：
  1. `grep -r "useUnifiedEngine" components/ hooks/` → 0 命中；
  2. 全局仅 `useEngineRuntime` 一处订阅 SSE；
  3. `RequirementNode[]` / `EngineProcess[]` / `TaskStatusSummary` 三切片均有数据来源（不再依赖 `useUnifiedEngine`）；
  4. `npm run type-check` 全绿。

### FR-2 三看板交互前端（解决 V2）

- **优先级 P0**
- **内容**：新建/改造 `components/EngineDashboard.tsx`，三栏：
  - `ProcessMonitor`：进程监控（autoplan-ts supervisor pid / AgentSession 运行时 + 进度环 + 折叠日志）；
  - `RequirementLifecycle`：需求全生命周期（received → discussing → converged → executing → delivered，点击联动任务）；
  - `TaskStatusBoard`：任务状态（pending/running/completed/failed/skipped 计数卡 + 阻塞置顶标注原因）。
  - 窄屏（`useIsMobile`）折叠为标签页；客户端统一 `csrfFetchJson`；模态复用 `components/ui/ConfigModal.tsx`。
- **验收**：
  1. 三看板随 SSE 实时更新，无 console 错误；
  2. 窄屏折叠生效；
  3. 点击需求联动任务列表；
  4. 通过 `npm run lint` 与 `type-check`。

### FR-3 autoplan-ts 生命周期贯通（解决 V3 / V6 / V7）

- **优先级 P0**
- **内容**：需求立项 → 计划 → 任务入队 → 交付物落盘 → 执行 → 反馈，全流程在 TS 运行时内贯通；执行体决策（二选一，需产品拍板，见 §4）：
  - (a) 委托 `AgentSession`（`lib/rpc-manager.ts` 的 `startRpcSession()`）；
  - (b) 保留 `autoplan-llm-adapter` 自包含执行（已实现真实写码 + 测试 + 熔断，但与主 agent 能力割裂）。
  - 桥接状态到 `engine-runtime-store.autoplan`。
- **验收**：
  1. 全流程无异常；
  2. `engine-runtime-store` 实时更新；
  3. `ENGINE_REAL_VERIFY` 默认行为明确（建议默认开真实验证）。

### FR-4 守卫真实化（解决 V4 / V6）

- **优先级 P1**
- **内容**：
  - `safeGuard/safeAdvance` 在 comet 可用但守卫**失败时上抛错误**（不再 `passed:true` 静默放行，`unified-engine-runtime.ts:500 / 509-510`）；
  - `prepareVerifyArtifacts` 默认走真实验证输出，移除/标注伪造报告（`comet-adapter.ts:47-68`）。
- **验收**：
  1. 故意构造失败守卫 → run 进入 `failed` 且前端可见原因；
  2. `npm run test:node` 含回归用例。

### FR-5 执行体安全修复（报告 §3 P0/P1）

- **优先级 P1**
- **内容**：
  - comet `shell:true` 改数组传参 + 参数白名单（同步 `vendor/comet`）；
  - `@latest` 锁精确版本 + lockfile；
  - 复跑 `npm audit` 无新增高危。
- **验收**：
  1. `grep -rn "shell: true" lib/ vendor/` → 0 命中；
  2. `npm audit` 高危清零。

### FR-6 DEFAULT_WORKFLOW 策略决策（解决 V5）

- **优先级 P2**
- **内容**：产品确认默认工作流。若保留 `hotfix`（`unified-engine-types.ts:19-24`），须在 PRD 明确"自动化引擎仅走精简预设"的边界；若启用 `full`，须补齐 `build_mode`/`tdd_mode`/`isolation`/`verify_mode` 自动填充逻辑。
- **验收**：
  1. `ENGINE_WORKFLOW` 文档化；
  2. 对应守卫路径有测试覆盖。

### FR-7 清理遗留（解决 V8）

- **优先级 P3**
- **内容**：删除空目录 `app/api/engine/autoplan/`；确认无残留 Go 引用（`grep -r "go build\|autoplan-server\|backend/go.mod" lib/ app/` → 0）。
- **验收**：
  1. 目录已删；
  2. Go 零引用。

---

## 3. 当前项目与参考内容差异分析

| 维度              | 报告设计                    | 当前现实                                                 | 处置归属       |
| ----------------- | --------------------------- | -------------------------------------------------------- | -------------- |
| 状态面            | 单点 `engine-runtime-store` | 三套并存（PlanPanel / useUnifiedEngine / 孤儿 store）    | FR-1           |
| 前端看板          | `EngineDashboard` 三看板    | 单视角 `AutonomousCodingDashboard` + `PlanPanel`         | FR-2           |
| 执行体            | `AgentSession` 委托         | `autoplan-llm-adapter` 自包含                            | FR-3（待决策） |
| 守卫              | 失败上抛                    | 默认放行（`unified-engine-runtime.ts:500/509`）          | FR-4           |
| 验证报告          | 删除伪造                    | 受 `ENGINE_REAL_VERIFY` 门控（`comet-adapter.ts:47-68`） | FR-3/FR-4      |
| 默认工作流        | `standard`                  | `hotfix`（有注释依据，`unified-engine-types.ts:19-24`）  | FR-6           |
| autoplan 状态桥接 | `autoplan` 字段             | 无（`engine-runtime-store.ts:42-49`）                    | FR-1           |
| Go 依赖           | 零                          | 零（空目录遗留 `app/api/engine/autoplan/`）              | FR-7           |

---

## 4. 待产品决策的关键分叉（阻塞项）

1. **执行体选型**：委托 `AgentSession`（复用既有写码能力、统一语言，但需适配其 send/abort 协议）vs 保留 `autoplan-llm-adapter` 自包含执行（已实现真实写码 + 测试 + 熔断，但与主 agent 能力割裂）。报告推荐前者，当前是后者。
2. **DEFAULT_WORKFLOW**：`hotfix`（易通过但弱验证）vs `full`（强验证但需补自动配置）。
3. **真实验证默认开关**：`ENGINE_REAL_VERIFY` 默认开 / 关。

> 建议：执行体选 (a) 委托 `AgentSession`（与 G1 同一收敛方向，避免能力割裂）；`DEFAULT_WORKFLOW` 暂维持 `hotfix` 但文档化边界；`ENGINE_REAL_VERIFY` 默认开，避免"公关式通过"。以上待产品确认。

---

## 5. 非功能性需求

- **NF-1 语言约束**：全量 TypeScript；`next.config.ts` 的 `serverExternalPackages` 隔离 Node 专用依赖；**零 Go 进程/二进制**（硬性，验收以 `grep` 校验）。
- **NF-2 性能**：长链路 Run 的 trajectory 改增量 append（消除全量读写）；`decide` 深拷贝在大型 `SkillPackage` 场景做结构共享；`isEngineStateEquivalent` 抑制无变化重渲染（已实现，保留）。
- **NF-3 安全**：命令注入清零、供应链锁版本、凭据复用 pi-web env/keychain、SSE 同源 + csrf、状态面无未授权暴露。
- **NF-4 可靠性**：SSE 断线 3s 重连 + REST 对账（已在 `useEngineRuntime` / `useUnifiedEngine` 实现，统一后保留）；空闲超时 flush 磁盘可恢复（`unified-engine-runtime.ts` 持久化段）。
- **NF-5 可维护性**：客户端统一 `csrfFetchJson`、模态复用 `ConfigModal`、API 成功响应统一 `jsonOk`；禁止在客户端裸写 `fetch` + `JSON.stringify` + `res.json()`。
- **NF-6 兼容性**：窄屏（`useIsMobile`）三看板折叠为标签页；用户可见文案走 `lib/i18n/zh.ts`。
- **NF-7 质量门禁**：`npm run ci`（format:check + lint + type-check + test:node + test:coverage）全绿，husky pre-commit 一致。

---

## 6. 全链路验收标准（综合）

1. `npm run ci` 全绿；
2. Go 零引用（`grep` 校验通过）；
3. 状态面唯一（无 `useUnifiedEngine`、无 `/api/engine/runs` 直读）；
4. 三看板随 SSE 实时更新、无 console 错误、窄屏折叠生效；
5. autoplan-ts 全生命周期贯通且桥接 `engine-runtime-store.autoplan`；
6. 守卫失败时 run 进入 `failed` 且前端可见原因；
7. `shell:true` 0 命中、`npm audit` 高危清零；
8. `ENGINE_REAL_VERIFY` / `ENGINE_WORKFLOW` 行为文档化且有测试；
9. 长链路 Run 性能不随步数线性恶化（`node --prof` 抽测）。

---

## 7. 关键代码位置索引（实施参考）

| 文件                                           | 关联需求                                 |
| ---------------------------------------------- | ---------------------------------------- |
| `lib/engine-runtime-store.ts`                  | FR-1（状态源、缺 `autoplan` 字段）       |
| `hooks/useEngineRuntime.ts`                    | FR-1（唯一 SSE 订阅，当前无消费方）      |
| `hooks/useUnifiedEngine.ts`                    | FR-1（待删除的平行状态面）               |
| `components/AutonomousCodingDashboard.tsx`     | FR-1 / FR-2（当前消费 useUnifiedEngine） |
| `components/PlanPanel.tsx`                     | FR-1（独立状态面，待改消费统一 store）   |
| `components/EngineDashboard.tsx`（待建）       | FR-2（三看板）                           |
| `lib/unified-engine/unified-engine-runtime.ts` | FR-4（`:500/509` 守卫放行）              |
| `lib/unified-engine/comet-adapter.ts`          | FR-4 / FR-6（`:47-68` 伪造报告门控）     |
| `lib/unified-engine/autoplan-llm-adapter.ts`   | FR-3（`:296-339` 自包含执行体）          |
| `lib/unified-engine/unified-engine-types.ts`   | FR-6（`:19-24` DEFAULT_WORKFLOW=hotfix） |
| `lib/unified-engine/guards/comet-cli.ts`       | FR-5（shell:true 注入面）                |
| `app/api/engine/{state,stream,autoplan}/`      | FR-1 / FR-7（空目录清理）                |
