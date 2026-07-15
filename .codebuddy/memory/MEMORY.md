# 长期记忆 (MEMORY.md)

## 用户偏好 / 项目约定

### 中文模式本地化约束（2026-07-12 起生效）
在中文语境下，AI 代码助手的所有输出必须严格保持全中文，禁止出现未经翻译的英文状态/提示。适用范围：

- **进程状态 / 进度追踪 / TODO / 任务列表**：全部用中文表达。
- **交互回复 / 最终回复 / 系统提示**：全中文，不含裸英文短语。
- **代码注释**：新写的注释用中文（如适用；纯技术标识符注释可保留英文术语）。
- **变量命名**：内部标识符（变量/函数/类名）保留英文是行业惯例，改动会破坏编译与引用，故按 "如适用" 处理——仅当用户明确另要求时才中文化；用户可见的展示文案一律走 `lib/i18n/zh.ts` 中文。

**硬性约束**：中文模式下不得输出未翻译的英文状态或提示；所有执行步骤、进度、任务列表与最终回复必须全中文，以达成完全本地化开发体验。

> 注：本仓库已有自研零依赖 i18n（`lib/i18n/zh.ts` + `en.ts`），用户可见文案应走 i18n 而非硬编码。

### Plan 讨论模式 · 多 Agent 协同编排器（2026-07-12 实现）
- 位置：`lib/agent-orchestrator/`（纯逻辑，与后端无关）+ `lib/plan-mode-store.ts` + `app/api/plan/**` + `components/PlanPanel.tsx`。
- 设计核心：**不是**拉起多个真实 `AgentSession` 讨论，而是用「角色化单轮补全」——每个角色每轮 = 一次带该角色 systemPrompt 的 `completeSimple` 调用（参考 `app/api/agent/enhance`）。天然满足「只讨论不写码」。
- 四大模块：意图解析(inten-parser 动态实例化角色) → 多轮讨论(orchestrator 事件总线/SSE) → 收敛(convergence：仲裁者 CONSENSUS 信号 / 相似度稳定 / 轮次上限) → 方案合成(plan-synthesizer 多套方案 pros/cons/scenarios) → 确认交接统一引擎(createChange+startRun，AppShell 跳转引擎面板)。
- 可插拔 `AgentRunner`：Mock（单测用）与 `createCompleteSimpleRunner(createPiLlmCompletion(cwd))`（真实后端）。
- 单测：`lib/agent-orchestrator/orchestrator.test.mjs`（node --test --experimental-strip-types，脱 LLM）。注意：测试须直接 import `./orchestrator.ts` 等具体文件，**不能** import `./index.ts`（它会 re-export `llm-backend.ts`，后者依赖 `@/` 别名，纯 Node 无法解析）。
- 参考项目：`jnMetaCode/agency-orchestrator`（原需求误写为 jetaCode）。

### 插件全局总开关（2026-07-15 实现）
- 目标：一键关闭全部插件以省 token——关闭时彻底停止插件后台安装/运行与数据请求，开启时恢复。
- 状态持久化：`~/.pi/agent/pi-web-plugin-master.json`（`{enabled, snapshot}`），由 `lib/plugin-master-switch.ts` 读写（globalThis 缓存）。
- 行为闸门：
  - `lib/plugin-auto-install.ts` 的 `ensureRecommendedPlugins()` 在 `getPluginsMasterEnabled()` 为 false 时直接返回 skipped（不发任何安装网络请求）；新增 `resetAutoInstall()` 清空缓存锁，便于关闭→开启后真正触发安装。
  - `app/api/plugins/master`（GET/PUT）切换时复用 `lib/plugin-disable.ts` 的 `setPackageDisabled` 把每个「非核心」可选插件包在 settings.json 的资源数组清空（与单包 disable 同机制，agent 运行时不再加载其 extension/skill/prompt/theme），并快照各包关闭前禁用态以便原样恢复。核心插件 = `DEFAULT_PLUGINS`（pi-subagents、rpiv-todo），总开关不触碰，避免破坏关键 UI。
  - 切换后需「重新加载会话」对正在运行的会话生效；新会话自动应用。
- UI：插件面板头部（`components/PluginsConfig.tsx`）新增总开关（复用 `Toggle`），关闭时锁定单插件启停并提示。i18n 键 `plugins.master*`（zh/en）。
- 注意：禁用作用于 **global** 作用域（auto-installer 的安装目标）；project 作用域的可选插件不在总开关覆盖范围内。

### 提交 / 推送约定（2026-07-12 确认）
- husky `pre-commit` 钩子（`.husky/pre-commit`）实际只跑：`npx lint-staged` → `npm run type-check` → `npm run test:node` → `npm run test:coverage`。**不调用 comet-guard**；`[guard]FATAL` 来自 comet 工作流/手动调用，非 git 钩子。提交时钩子会自动复跑这些校验，须全绿才提交成功。
- lint-staged 配置：`.{js,mjs,cjs,jsx,ts,tsx}` → prettier --write + eslint --fix；`.{json,md,yaml,yml,css}` → prettier --write。
- `openspec/**/.comet/` 已在 `.gitignore` 排除（comet-guard 运行时产物，类似 `.next/`）；`.comet.yaml` 仍受版本管理，需随 change 记录提交。
- `vendor/comet/`、`vendor/autoplan/` 已被 `.gitignore` 忽略（vendored upstream）。
- 仓库规范完整 CI：`npm run ci` = format:check && lint && type-check && test:node && test:coverage。

### 自主编程引擎（comet/autoplan/unified-engine）架构事实（2026-07-15）
- **三引擎并存**：`lib/agent-orchestrator`（自研、已上线、TS、无 Electron 依赖，计划生成+多角色讨论+收敛）+ `lib/unified-engine`（comet/autoplan 适配层，半接入，独立 `/api/engine/*` + `AutonomousCodingDashboard`，与 PlanPanel 平行零复用）+ vendored `comet`/`autoplan`。
- **统一决策**：以 agent-orchestrator 为计划主引擎，unified-engine 收敛为可选执行出口；合并持久化/事件/前端为一套（新增 `lib/engine-runtime-store.ts` 统一状态层 + `app/api/engine/state` + `hooks/useEngineRuntime`）。
- **前端状态面合并（2026-07-15 批次 A 已落地）**：删除 `hooks/useUnifiedEngine.ts` 与 `components/AutonomousCodingDashboard.tsx`（原平行状态面，V1）；新增 `components/EngineDashboard.tsx` 三看板（进程监控/需求生命周期/任务状态）单一消费 `useEngineRuntime`（唯一 SSE）。`UnifiedEngineState` 含 `runs: RunState[]` 透传 + `autoplan:{ready,features}` 桥接字段（`setAutoPlanStatusProvider` 注入点待 T3.2 填充）。`/api/engine/runs` 仅保留 POST 控制，GET 直读已移除。`PlanPanel` 走 `usePlanMode`（agent-orchestrator 计划模式，独立域）不并入引擎状态面。
- **守卫真实化 + 安全修复（2026-07-15 批次 B 已落地）**：`guards/comet-cli.ts` 新增 `isCometAvailable()`（探测 comet-guard.mjs 是否存在）；`unified-engine-runtime.ts` 的 `safeGuard`/`safeAdvance` 改为「仅当 comet 未安装才降级放行，其余一律阻断」——守卫语义失败（passed:false）或推进被守卫阻止（advanceStage 抛错）不再静默通过（V4）。`comet-adapter.ts` `prepareVerifyArtifacts` 真实验证默认开（`ENGINE_REAL_VERIFY !== "0"` 才兜底写诚实存根，V6）。`autoplan-llm-adapter.ts` `executeTests` 消除 `shell:true`，受控命令字符串解析为 argv（V5，修复命令注入）。tsc/eslint 0 错，引擎 node 单测 16 项全绿。
- **生命周期贯通 + 遗留清理（2026-07-15 批次 C+D 已落地）**：执行体选型定为**方案 b**（维持 `autoplan-llm-adapter` 自包含真实执行，方案 a 委托 AgentSession 因风险高暂缓）。`autoplan-adapter.ts` 新增 `getAutoPlanStatus()` 并在 `createAutoPlanAdapter` 三分支注册 `setAutoPlanStatusProvider`，使 `UnifiedEngineState.autoplan` 实时反映就绪/特性（T3.2）。新增 `autoplan-lifecycle.test.mjs`（T3.4，memory 脱 LLM 跑通全生命周期）。`DEFAULT_WORKFLOW` 决策维持 hotfix 并加 `ENGINE_WORKFLOW` 取值校验（非法回退 hotfix，T6.1）。删空目录 `app/api/engine/autoplan/`、Go 零引用确认（T7.1/T7.2）。PRD 四批次 A/B/C/D 全部完成，tsc/eslint 0 错、引擎 node 单测 19 绿。
- **autoplan 功能迁移 = 纯 TypeScript 等价实现（禁用 Go，2026-07-15 修正）**：本功能迁移任务明确**禁止使用 Go 语言**。因此不拉起任何 Go 进程/二进制，autoplan 的「需求立项→计划生成→任务入队→交付物落盘→任务执行→反馈回收」生命周期在**本仓库既有 TypeScript 运行时**内做等价移植，契约 `PlanGeneratorPort` 不变，功能逻辑不变。
  - 上游事实（仅调研价值，不再落地为 Go sidecar）：本地钉选 `e06c2b2` 仅前端骨架、无 backend；上游 `origin/main@bbce9de` 含完整 Go 后端（426 .go / ~69k 行，含 `backend/cmd/autoplan-server` daemon + `AUTOPLAN_GO_*_API` 特性门 fail-closed + `X-Autoplan-Session` 鉴权等式）。`go build` 曾实测成功（go1.25.0 工具链自动下载），但**现已按约束作废**。
  - **已移除的 Go 相关代码**：`lib/autoplan-sidecar.ts`、`scripts/build-autoplan.mjs`、`app/api/engine/autoplan/route.ts`、`vendor/autoplan/backend/`、`package.json` 的 `autoplan:build`、`engine-runtime-store.ts` 的 `autoplan` 进程态字段。
  - **当前实现**：`lib/unified-engine/autoplan-adapter.ts` 纯 TS —— `tryLoadVendorAutoPlan()`（ENGINE_AUTOPLAN_VENDOR=1 时动态加载 vendored TS 端口 `autoplan-loop-service`，无 Go/无子进程）+ `createLlmAutoPlanAdapter`（真实 LLM）+ `createMemoryAutoPlanAdapter`（兜底）。功能逻辑与原 `PlanGeneratorPort` 消费方完全一致。
  - 验收：`tsc`/`eslint`(0 错)/`node --test` 57 项全绿；无残留 Go 引用。
  - 报告：`docs/AUTONOMOUS-ENGINE-FUSION.md`（架构调研有效；其 §0–§6 的 Go sidecar 落地方案已加注作废）。
- **comet 接入约束**：仅限 Node Runtime；`guards/comet-cli.ts` 白名单调用 `vendor/comet/assets/skills/comet/scripts/*.mjs`（`COMET_SKIP_BUILD` 现仅 dev 跳过）；`DEFAULT_WORKFLOW` 经 `ENGINE_WORKFLOW` 可配；伪造验证报告受 `ENGINE_REAL_VERIFY` 控制（默认开；仅 `=0` 才写诚实标注的存根报告）。
- 结构化调研报告：`docs/AUTONOMOUS-ENGINE-SURVEY.md`。

### 前端共用模块约定（2026-07-13 确立）
- **禁止**在客户端组件里裸写 `fetch(url, { headers: csrfHeaders({...}), body: JSON.stringify(...) })` + `res.json()` 模式。一律改用 `lib/csrf-fetch.ts` 的 `csrfFetchJson<T>(url, { method, body, headers })` → 返回 `{ ok, status, data }`（空/非 JSON 响应用 `.catch(() => ({}))` 兜底）。
- 配置面板 UI 复用 `components/ui/ConfigModal.tsx` 原语：`ConfigModal`(外壳) / `ConfigSidebar` / `ConfigListRow`(选中+hover) / `ModalButton`(primary/secondary/danger) / `SaveButton`(带 saved-pop 勾选动画)。API 成功响应统一用 `lib/api-utils.ts` 的 `jsonOk(data, init)`。
- 重构策略：保留各面板既有正确遮罩外壳，仅局部抽取重复逻辑（避免整体重写大体量 return 块引发视觉/行为回归）。
