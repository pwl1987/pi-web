# 长期记忆 (MEMORY.md)

## 用户偏好 / 项目约定

### 中文模式本地化约束（2026-07-12 起）
中文语境下所有输出（进度/任务列表/交互回复/代码注释）必须全中文，禁裸英文状态提示；用户可见文案走 `lib/i18n/zh.ts`。内部标识符保留英文（行业惯例，改动会破坏编译）。

### 系统提示词优化框架（2026-07-15 实现）
- 模块：`lib/prompt-system/`（纯逻辑 node:test）+ `lib/pi-model-creds.ts` + `lib/prompt-modules-state.ts`（侧车 `~/.pi/agent/pi-web-prompt-modules.json`）+ `app/api/prompts/**` + `components/PromptsConfig.tsx`。
- 能力：压缩(compress.ts 离线 + compress-llm.ts 可选 LLM，失败兜底离线)、动态开关(switches.ts + 侧车)、动态提交(select.ts 子串打分 + select-llm.ts 可选 LLM，底线 20%，失败回退全量)、单入口 composeSystemPrompt。
- 回归安全：`enhance-modules.ts` 的 ENHANCE_LINES 是原 buildEnhanceSystemPrompt 逐字副本；enhance 路由默认用 `buildEnhanceSystemPrompt`（全量），`ENHANCE_DYNAMIC_SELECT=1` 才走 `buildEnhanceSystemPromptSelected`。
- coding agent 接入：`lib/rpc-manager.ts` 的 modular 总闸（getAgentsMdModular 默认关）开启时 `composeModularAgentsMdSystemPrompt` **只替换**完整 systemPrompt 的 AGENTS.md `<project_instructions>` 段，绝不整体替换（否则清空身份/工具约束）。
- 约定：纯逻辑模块禁 `@/`、相对 value import 带 `.ts` 后缀；服务侧用 `@/`；LLM 凭证统一走 `resolveDefaultModelCredentials(cwd?)`（抛 ModelCredentialsError=400）。i18n 用 `promptOpt.*` 命名空间。

### Plan 讨论模式编排器（2026-07-12）
- `lib/agent-orchestrator/`（纯逻辑）+ `lib/plan-mode-store.ts` + `app/api/plan/**` + `components/PlanPanel.tsx`。
- 设计：角色化单轮 `completeSimple` 补全（非拉起真实 AgentSession），天然「只讨论不写码」。单测须直接 import `./orchestrator.ts` 等，**不能** import `./index.ts`（依赖 `@/` 纯 Node 无法解析）。

### 插件全局总开关（2026-07-15）
- 状态：`~/.pi/agent/pi-web-plugin-master.json`（`{enabled, snapshot}`），`lib/plugin-master-switch.ts` 读写。
- 行为：总闸关时 `ensureRecommendedPlugins()` 直接 skipped；PUT /api/plugins/master 复用 `setPackageDisabled` 清空非核心包资源数组并快照。`getPluginsMasterEnabled()===false` 时 /api/plugins 的 enable/install/update 返回 409（评审 L2 修复）。核心插件 DEFAULT_PLUGINS（pi-subagents、rpiv-todo）不触碰。禁用作用 global 作用域。

### 提交 / 推送约定（2026-07-12）
- husky `pre-commit` 实际只跑：`lint-staged` → `type-check` → `test:node` → `test:coverage`（不调 comet-guard）。提交须全绿。lint-staged：代码文件 prettier+eslint --fix；json/md/yaml/css prettier。
- 完整 CI：`npm run ci` = format:check && lint && type-check && test:node && test:coverage。

### 自主编程引擎架构事实（2026-07-15 收口）
- 统一为 agent-orchestrator（计划主引擎）+ unified-engine（执行出口）；前端合并为 `components/EngineDashboard.tsx` 单一消费 `useEngineRuntime`。PlanPanel 走独立 `usePlanMode`。
- 安全修复（已落地）：守卫未安装才降级放行、否则阻断；`prepareVerifyArtifacts` 真实验证默认开（ENGINE_REAL_VERIFY=0 才写诚实存根）；`executeTests` 消除 shell:true 解析为 argv（修复命令注入）；`DEFAULT_WORKFLOW` 经 ENGINE_WORKFLOW 校验。
- **autoplan 迁移 = 纯 TS 等价实现，禁用 Go**：移除 `lib/autoplan-sidecar.ts`、`scripts/build-autoplan.mjs`、`app/api/engine/autoplan/route.ts`、`vendor/autoplan/backend/`；当前 `lib/unified-engine/autoplan-adapter.ts` 纯 TS（vendor 动态加载/真实 LLM/内存兜底）。调研见 `docs/AUTONOMOUS-ENGINE-SURVEY.md`、`docs/AUTONOMOUS-ENGINE-FUSION.md`（其 Go sidecar 方案已作废）。
- comet 接入：仅 Node Runtime，白名单调用 `vendor/comet/assets/skills/comet/scripts/*.mjs`。

### 前端共用模块约定（2026-07-13）
- 客户端禁裸 fetch+csrfHeaders+res.json 模式，统一用 `lib/csrf-fetch.ts` 的 `csrfFetchJson<T>`（空/非 JSON 响应 `.catch(()=>({}))` 兜底）。成功响应用 `lib/api-utils.ts` 的 `jsonOk(data, init)`。
- 配置面板复用 `components/ui/ConfigModal.tsx` 原语；重构保留既有遮罩外壳，仅局部抽取重复逻辑防回归。

## 对抗性评审进度（2026-07-31）
- 基线文档：`docs/ADVERSARIAL-REVIEW-2026-07-31.md`（S1–S10 安全 / P1–P12 性能 / L1–L23 逻辑 / A1–A3 API / B1–B3 浏览器 / C1–C3 约束）。
- 第 1 轮自动修复（commit `2cd9c5a`，快照 `20281b4`）：C1(ModelCredentialsError 400)、A1(enhance 动态选择加开关默认 OFF)、L1(引擎终态 run 409)、L2(插件总闸关时 409)、B3(import 归位)。type-check+359 node+281 vitest 全绿。
- 仍开放·需人工：P1/P2/P4(分页/缓存/去重)、P5/P6(idle 硬上限/并发 429)、L3(re-parent 绝对路径外键)、L8(重复发送不幂等)、L9(fork running 直接 destroy)。详见 REVIEW-LOOP.md §10。
- **S2 已落地（2026-07-31，commit `a9ab1f6`，CI_EXIT=0）**：`lib/csrf.ts` 的 `validateCsrf` 从「仅 production 校验、dev 放行」改为**默认全环境开启**，新增 `PI_WEB_DISABLE_CSRF=1` 降级开关（仿 S1 `PI_WEB_DISABLE_AUTH`）。更新 `lib/csrf.test.ts`：废除 dev 无条件放行旧断言，新增降级用例。回滚：`git reset --hard 625034c`（S2/L7 前快照）。
- **L7 已落地（2026-07-31，commit `a9ab1f6`，CI_EXIT=0）**：`app/api/agent/[id]/events/route.ts` 的 SSE `cleanup` 在客户端断连(abort)时若 `session.isRunning()` 为真则 `session.send({type:"abort"})` 停止后台工作，避免关标签页/网络断开后 AgentSession 持续烧 token。abort 幂等且受 `_alive` guard 保护。
- **S1 已落地（2026-07-31，commit `959fbb0`，CI_EXIT=0）**：本地访问令牌网关 + L10 归属收敛（文件新-1 sessionReference 受信根收敛）。OpenSpec 提案 `openspec/changes/s1-access-gateway/`。令牌启动生成、明文仅给终端+`?token=`自动打开、服务端只存 sha256 哈希于 `~/.pi/agent/pi-web-auth.json` 0600；`app/middleware.ts`(Edge) 三源校验 + 定时安全比较 + `PI_WEB_DISABLE_AUTH=1` 降级 + `/api/health` 开放；dev 强制令牌（D2 保守侧）。回滚：`git reset --hard 9d2d3c1`（S1 前快照）。
- **S3/S4/S5 已落地（2026-07-31，CI 全绿）**：S3 `mcp-config/test` stdio 探针命令白名单（`lib/mcp-probe-guard.ts`，拒 `/bin/bash` 等路径+`--` 元字符）；S4 `skills/install` 包名白名单（`lib/skill-pkg-guard.ts`）+`--ignore-scripts` 防 postinstall；S5 `installLocalExtension` 受信根校验（`realpathSync`+落 `~/.pi-web`/repo `extensions/`）。详见 REVIEW-LOOP.md §9。
