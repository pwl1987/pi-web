# 自主编程引擎融合 · 开发实施计划

> 文档状态：草案（待评审）
> 创建日期：2026-07-15
> 关联文档：`docs/COMET-AUTOPLAN-FUSION-PRD.md`（产品需求文档）、`docs/COMET-AUTOPLAN-FUSION-REPORT.md`（融合架构调研）
> 硬约束：全量 TypeScript，**零 Go 依赖**；文档与用户可见文案全中文。

---

## 1. 计划概述

### 1.1 目标

依据 PRD，消除"状态面三套并存 + 三看板缺失"的结构性偏离，将底层已就绪的引擎骨架收敛为**唯一状态源 + 唯一可交互三看板前端**，并完成守卫真实化与安全合规收尾。

### 1.2 批次策略

| 批次   | 范围                                              | 优先级 | 依赖                                |
| ------ | ------------------------------------------------- | ------ | ----------------------------------- |
| 批次 A | FR-1 状态面合并 + FR-2 三看板（耦合，必须同批）   | P0     | 无                                  |
| 批次 B | FR-4 守卫真实化 + FR-5 执行体安全修复             | P1     | 批次 A（store 契约稳定后）          |
| 批次 C | FR-3 autoplan-ts 生命周期贯通（含执行体选型决策） | P0/P1  | 待 §4 分叉拍板；建议并入批次 A 收尾 |
| 批次 D | FR-6 DEFAULT_WORKFLOW 决策 + FR-7 遗留清理        | P2/P3  | 批次 B/C                            |

> 说明：FR-3 执行体选型依赖产品决策（PRD §4 分叉 1）。若决策为"委托 AgentSession"，建议并入批次 A 一并实施；若维持 `autoplan-llm-adapter`，则仅做状态桥接（轻量），可后置到批次 C。

### 1.3 时间排期（工期估算）

> 按单人日（1 d ≈ 1 个标准工作日）估算，假设前后端协作顺畅、决策前置。

| 里程碑             | 包含任务             | 估算工期      | 完成标志                                                      |
| ------------------ | -------------------- | ------------- | ------------------------------------------------------------- |
| M1 状态面合并      | T1.1–T1.4            | 3 d           | `grep -r useUnifiedEngine` 0 命中；单 SSE 订阅                |
| M2 三看板上线      | T2.1–T2.4            | 4 d           | 三看板随 SSE 实时更新、窄屏折叠、无 console 错误              |
| M3 守卫真实化+安全 | T4.1–T4.3、T5.1–T5.3 | 3 d           | 失败守卫 run 进入 failed；`shell:true` 0 命中；audit 高危清零 |
| M4 生命周期贯通    | T3.1–T3.4            | 3 d（视决策） | autoplan 状态桥接 store；全生命周期无异常                     |
| M5 决策与清理      | T6.1、T7.1–T7.2      | 1.5 d         | 文档化默认值；空目录删除；Go 零引用                           |
| **合计**           | —                    | **≈ 14.5 d**  | 通过 `npm run ci` 全链路验收                                  |

---

## 2. 任务拆解（对应 PRD FR-1 ~ FR-7）

### 批次 A · P0

#### T1.1 状态源收敛：新增 `autoplan` 桥接字段（FR-1 / V7）

- **文件**：`lib/engine-runtime-store.ts:42`
- **要点**：
  - 在 `UnifiedEngineState` 接口扩展 `autoplan?: { ready: boolean; features: string[] }`；
  - 在 `EMPTY` 默认对象补充 `autoplan: { ready: false, features: [] }`；
  - 在 `publish()` / `buildState()` 路径中从 autoplan-ts 运行时读取 `ready` 与已启用的 `features`（如 `llm`、`memory`、`vendor`）。
- **验收**：`type-check` 全绿；`autoplan` 字段可被 `useEngineRuntime` 订阅到。

#### T1.2 删除平行状态面 `useUnifiedEngine`（FR-1 / V1）

- **文件**：`hooks/useUnifiedEngine.ts`、`app/api/engine/runs/`（若存在直读路由）
- **要点**：
  - 确认 `useUnifiedEngine` 全部消费方（当前仅 `AutonomousCodingDashboard`，见 V1）；
  - 将消费方迁移到 `useEngineRuntime` 后，删除 `hooks/useUnifiedEngine.ts` 及其依赖的 `/api/engine/runs` 直读；
  - 保留 `/api/engine/state` 与 `/api/engine/stream` 为唯一后端出口。
- **验收**：`grep -r "useUnifiedEngine" components/ hooks/` → 0 命中；全局仅 `useEngineRuntime` 一处订阅 SSE。

#### T1.3 改造 `AutonomousCodingDashboard` 消费统一 store（FR-1 / V1 / V9）

- **文件**：`components/AutonomousCodingDashboard.tsx`
- **要点**：
  - 将内部状态来源从 `useUnifiedEngine` 切换为 `useEngineRuntime`；
  - 让 `requirementLifecycle`（`RequirementNode[]`）真正驱动需求全生命周期视图（解决 V9 无数据源）；
  - 让 `taskStatus`（`TaskStatusSummary`）驱动任务状态视图；`processes`（`EngineProcess[]`）驱动进程监控视图。
- **验收**：三切片均有数据来源；`npm run type-check` 全绿。

#### T1.4 改造 `PlanPanel` 复用统一 store（FR-1）

- **文件**：`components/PlanPanel.tsx`
- **要点**：将 PLanPanel 中独立的引擎状态订阅改为消费 `useEngineRuntime`，避免二次状态面。若 PlanPanel 与引擎看板功能重叠，评估合并进 `EngineDashboard`（T2.1）。
- **验收**：无重复 SSE 订阅；`lint` 通过。

### 批次 A · P0（前端）

#### T2.1 新建 `EngineDashboard` 三看板外壳（FR-2 / V2）

- **文件**：`components/EngineDashboard.tsx`（新建）、复用 `components/ui/ConfigModal.tsx` 原语
- **要点**：
  - 三栏布局：`ProcessMonitor` / `RequirementLifecycle` / `TaskStatusBoard`；
  - 容器统一调用 `useEngineRuntime()` 取 `processes` / `requirementLifecycle` / `taskStatus`；
  - 客户端所有写操作走 `lib/csrf-fetch.ts` 的 `csrfFetchJson`（禁止裸 fetch）。
- **验收**：组件可挂载；`type-check` / `lint` 通过。

#### T2.2 `ProcessMonitor` 进程监控（FR-2）

- **文件**：`components/EngineDashboard.tsx`（子组件）
- **要点**：渲染 `EngineProcess[]`（autoplan-ts supervisor pid / AgentSession 运行时），含进度环、折叠日志；进程状态色用 CSS 变量主题。
- **验收**：进程列表随 SSE 实时更新；无 console 错误。

#### T2.3 `RequirementLifecycle` 需求全生命周期（FR-2 / V9）

- **文件**：`components/EngineDashboard.tsx`（子组件）
- **要点**：渲染 `RequirementNode[]`（received → discussing → converged → executing → delivered）；点击某需求 → 联动高亮 `TaskStatusBoard` 中该需求相关任务。
- **验收**：点击联动生效；阶段流转实时。

#### T2.4 `TaskStatusBoard` 任务状态 + 窄屏折叠（FR-2 / NF-6）

- **文件**：`components/EngineDashboard.tsx`（子组件）、`hooks/useIsMobile.ts`
- **要点**：pending/running/completed/failed/skipped 计数卡；阻塞任务置顶标注原因；`useIsMobile` 为真时三栏折叠为标签页（lib/i18n/zh.ts 命名）。
- **验收**：窄屏折叠生效；计数实时；i18n 文案走 `lib/i18n/zh.ts`。

### 批次 B · P1

#### T4.1 守卫失败上抛（FR-4 / V4）

- **文件**：`lib/unified-engine/unified-engine-runtime.ts:500`、`:509-510`
- **要点**：
  - `safeGuard` / `safeAdvance` 在 comet 可用但守卫**失败**时上抛 `Error`（当前 `passed:true` + "comet 不可用，默认放行" 逻辑需改为：仅当 comet 进程本身不可达才降级，守卫语义失败必须抛错）；
  - 区分"comet 不可用（降级放行）"与"comet 可用但守卫拒绝（抛错阻断）"两类。
- **验收**：构造失败守卫 → run 进入 `failed` 且原因可见；`npm run test:node` 含回归用例。

#### T4.2 真实验证默认化（FR-4 / V6）

- **文件**：`lib/unified-engine/comet-adapter.ts:47-68`
- **要点**：`prepareVerifyArtifacts` 默认走真实验证输出；`ENGINE_REAL_VERIFY` 默认取真实验证（建议默认开），仅在显式关闭时兜底写诚实标注的存根报告。
- **验收**：默认环境变量下不再产出"公关式通过"报告；有测试覆盖分支。

#### T4.3 守卫回归测试（FR-4）

- **文件**：`lib/unified-engine/*.test.mjs`（参照既有 `engine-optimizations.test.mjs`）
- **要点**：新增 node:test 用例：① 守卫拒绝 → 抛出异常；② 守卫通过 → 正常推进；③ comet 不可达 → 降级放行（明确语义）。
- **验收**：`npm run test:node` 全绿。

#### T5.1 消除 `shell:true` 注入面（FR-5）

- **文件**：`lib/unified-engine/guards/comet-cli.ts`、`vendor/comet/**`（同步）
- **要点**：所有 `execFile`/`spawn` 调用由 `shell:true` + 字符串改为数组 argv + 参数白名单校验；禁止拼接用户输入进命令字符串。
- **验收**：`grep -rn "shell: true" lib/ vendor/` → 0 命中。

#### T5.2 依赖锁版本（FR-5）

- **文件**：`package.json`、`package-lock.json`
- **要点**：将 `@latest` 等浮动版本锁为精确版本；确认 `package-lock.json` 提交且 CI 启用 `npm ci`。
- **验收**：无浮动版本；`npm ci` 可复现。

#### T5.3 供应链审计（FR-5 / NF-3）

- **文件**：（命令）
- **要点**：复跑 `npm audit`；修复/豁免新增高危（记录于变更说明）。
- **验收**：`npm audit` 高危清零。

### 批次 C · P0/P1（依赖 §4 分叉决策）

#### T3.1 执行体选型决策落地（FR-3 / V3）

- **文件**：`lib/unified-engine/autoplan-llm-adapter.ts` 或 `lib/rpc-manager.ts`
- **要点**（二选一，依 PRD §4 分叉 1）：
  - **方案 (a) 委托 AgentSession**：在 autoplan 执行入口改为调用 `startRpcSession().send()`，复用主 agent 写码/测试能力，需适配 send/abort 协议与结果回写；
  - **方案 (b) 保留自包含**：维持 `autoplan-llm-adapter` 自包含执行，仅做状态桥接。
- **验收**：执行体按所选方案稳定工作；无能力割裂（方案 a）或状态桥接完整（方案 b）。

#### T3.2 autoplan 状态桥接 store（FR-3 / V7）

- **文件**：`lib/engine-runtime-store.ts`（T1.1 字段）、`lib/unified-engine/autoplan-adapter.ts`
- **要点**：将 autoplan-ts 的 `ready` 与启用的 `features` 实时写入 `UnifiedEngineState.autoplan`；在 `publish()` 链路触发刷新。
- **验收**：`engine-runtime-store.autoplan` 实时反映 autoplan 运行状态。

#### T3.3 全生命周期贯通验证（FR-3）

- **文件**：（集成测试）
- **要点**：需求立项 → 计划 → 任务入队 → 交付物落盘 → 执行 → 反馈 全流程跑通；记录各阶段耗时与失败点。
- **验收**：全流程无异常；store 实时更新。

#### T3.4 生命周期集成测试（FR-3 / NF-7）

- **文件**：`lib/unified-engine/*.test.mjs`
- **要点**：node:test 覆盖全生命周期关键跃迁；脱 LLM 用 memory adapter 兜底。
- **验收**：`npm run test:node` 含生命周期用例。

### 批次 D · P2/P3

#### T6.1 DEFAULT_WORKFLOW 决策与文档化（FR-6 / V5）

- **文件**：`lib/unified-engine/unified-engine-types.ts:19-24`、PRD §4 分叉 2
- **要点**：若保留 `hotfix`，在 PRD/本计划明确"自动化引擎仅走精简预设"边界；若启用 `full`，补齐 `build_mode`/`tdd_mode`/`isolation`/`verify_mode` 自动填充；文档化 `ENGINE_WORKFLOW` 取值。
- **验收**：`ENGINE_WORKFLOW` 文档化；对应路径有测试。

#### T7.1 删除空目录（FR-7 / V8）

- **文件**：`app/api/engine/autoplan/`
- **要点**：删除空目录；确认无残留 route 引用。
- **验收**：目录已删；`grep -r "engine/autoplan" app/"` 无活跃路由。

#### T7.2 Go 零引用校验（FR-7 / NF-1）

- **文件**：（命令）
- **要点**：`grep -r "go build\|autoplan-server\|backend/go.mod" lib/ app/` → 0；确认 vendored 上游无 Go 二进制被加载。
- **验收**：Go 零引用。

---

## 3. 优先级排序总览

| 优先级 | 任务                 | 批次 | 说明                                      |
| ------ | -------------------- | ---- | ----------------------------------------- |
| P0     | T1.1–T1.4, T2.1–T2.4 | A    | 状态面合并 + 三看板，耦合必同批，最高优先 |
| P0/P1  | T3.1–T3.4            | C    | 生命周期贯通，依赖执行体选型决策          |
| P1     | T4.1–T4.3, T5.1–T5.3 | B    | 守卫真实化 + 安全修复                     |
| P2     | T6.1                 | D    | DEFAULT_WORKFLOW 决策                     |
| P3     | T7.1–T7.2            | D    | 遗留清理                                  |

---

## 4. 技术实现要点与风险

### 4.1 状态面合并的"单一真相源"原则

- `engine-runtime-store` 挂在 `globalThis`（遵循项目既有跨热重载存活约定，见 AGENTS.md）；
- `useEngineRuntime` 是**唯一** SSE 订阅入口；任何组件不得自建 `/api/engine/runs` 直读；
- `isEngineStateEquivalent` 已实现的"抑制无变化重渲染"必须保留，避免三看板高频重渲染。

### 4.2 守卫真实化的语义边界（关键风险）

- 必须区分两类降级：
  1. **comet 进程不可达**（环境缺 vendor / 未构建）→ 可安全降级放行（记入 `stats.errorCount`）；
  2. **comet 可用但守卫拒绝**（代码未达标）→ **必须上抛阻断**，不得 `passed:true`。
- 误将 (2) 也降级放行，会重新引入"公关式通过"，与 FR-4 目标相悖。

### 4.3 执行体选型风险（T3.1）

- 方案 (a) 委托 `AgentSession`：需处理并发 `startRpcSession()` 锁合并（见 `lib/rpc-manager.ts` 的 `globalThis.__piStartLocks`）与空闲 10 分钟自动 `destroy`，避免引擎长跑被误销毁；
- 方案 (b) 保留自包含：简单但能力割裂，长期维护成本更高。

### 4.4 安全修复约束

- `shell:true` 改数组传参时，须同步 `vendor/comet` 内脚本调用约定，避免破坏 vendored 上游契约；
- 锁版本不得破坏 `npm run ci`；若上游要求浮动版本，需在变更说明记录豁免理由。

### 4.5 全中文与 i18n

- 所有用户可见文案（看板标题、状态标签、错误原因）走 `lib/i18n/zh.ts`；新增 key 同步 `en.ts`；
- 代码注释新写用中文（技术标识符保留英文）。

---

## 5. 验收与回归策略

### 5.1 质量门禁（必过）

- `npm run ci` = `format:check && lint && type-check && test:node && test:coverage` 全绿；
- husky pre-commit 自动复跑上述校验。

### 5.2 双轨测试

- **node:test**（`lib/*.test.mjs`）：纯逻辑（守卫、生命周期、store 派生），脱 LLM 用 `createMemoryAutoPlanAdapter` 兜底；
- **vitest**（`*.test.tsx`，DOM 文件加 `// @vitest-environment jsdom`）：三看板组件渲染与联动（脱 SSE，用 mock store）。

### 5.3 关键 grep 零命中校验

| 校验项              | 命令                                                            | 归属 |
| ------------------- | --------------------------------------------------------------- | ---- |
| 平行状态面已删      | `grep -r "useUnifiedEngine" components/ hooks/`                 | FR-1 |
| 无命令注入          | `grep -rn "shell: true" lib/ vendor/`                           | FR-5 |
| 零 Go 引用          | `grep -r "go build\|autoplan-server\|backend/go.mod" lib/ app/` | FR-7 |
| 无 engine/runs 直读 | `grep -r "engine/runs" app/ components/ hooks/`                 | FR-1 |

### 5.4 端到端手动验收（M2/M4 后）

- 启动 `npm run dev`，打开引擎面板，观察三看板随 `/api/engine/stream` 实时更新；
- 构造一次失败守卫，确认 run 进入 `failed` 且前端可见原因（FR-4）；
- 长链路 Run 跑数十步，目测无明显卡顿（`node --prof` 抽测性能，NF-2）。

---

## 6. 交付物清单

1. `docs/COMET-AUTOPLAN-FUSION-PRD.md`（已交付）
2. `docs/COMET-AUTOPLAN-FUSION-IMPLEMENTATION-PLAN.md`（本文件）
3. 代码交付：状态面合并（T1.x）、三看板（T2.x）、守卫真实化（T4.x）、安全修复（T5.x）、生命周期贯通（T3.x）、决策与清理（T6.x/T7.x）
4. 测试交付：`lib/unified-engine/*.test.mjs` 新增守卫与生命周期用例；`components/EngineDashboard.test.tsx` 联动用例

---

## 7. 待确认事项（阻塞启动项）

1. **执行体选型**（PRD §4 分叉 1）→ 决定 T3.1 走方案 (a) 还是 (b)，及是否并入批次 A。
2. **DEFAULT_WORKFLOW**（PRD §4 分叉 2）→ 决定 T6.1 是否补 `full` 自动配置。
3. **ENGINE_REAL_VERIFY 默认开关**（PRD §4 分叉 3）→ 决定 T4.2 默认值。

> 以上三项建议在本计划启动前由产品/技术负责人拍板；若暂不能定，可先按本计划"建议默认值"（执行体选 a、DEFAULT_WORKFLOW 维持 hotfix 但文档化、ENGINE_REAL_VERIFY 默认开）实施，待决策后微调。
