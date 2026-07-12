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

### 提交 / 推送约定（2026-07-12 确认）
- husky `pre-commit` 钩子（`.husky/pre-commit`）实际只跑：`npx lint-staged` → `npm run type-check` → `npm run test:node` → `npm run test:coverage`。**不调用 comet-guard**；`[guard]FATAL` 来自 comet 工作流/手动调用，非 git 钩子。提交时钩子会自动复跑这些校验，须全绿才提交成功。
- lint-staged 配置：`.{js,mjs,cjs,jsx,ts,tsx}` → prettier --write + eslint --fix；`.{json,md,yaml,yml,css}` → prettier --write。
- `openspec/**/.comet/` 已在 `.gitignore` 排除（comet-guard 运行时产物，类似 `.next/`）；`.comet.yaml` 仍受版本管理，需随 change 记录提交。
- `vendor/comet/`、`vendor/autoplan/` 已被 `.gitignore` 忽略（vendored upstream）。
- 仓库规范完整 CI：`npm run ci` = format:check && lint && type-check && test:node && test:coverage。

### 前端共用模块约定（2026-07-13 确立）
- **禁止**在客户端组件里裸写 `fetch(url, { headers: csrfHeaders({...}), body: JSON.stringify(...) })` + `res.json()` 模式。一律改用 `lib/csrf-fetch.ts` 的 `csrfFetchJson<T>(url, { method, body, headers })` → 返回 `{ ok, status, data }`（空/非 JSON 响应用 `.catch(() => ({}))` 兜底）。
- 配置面板 UI 复用 `components/ui/ConfigModal.tsx` 原语：`ConfigModal`(外壳) / `ConfigSidebar` / `ConfigListRow`(选中+hover) / `ModalButton`(primary/secondary/danger) / `SaveButton`(带 saved-pop 勾选动画)。API 成功响应统一用 `lib/api-utils.ts` 的 `jsonOk(data, init)`。
- 重构策略：保留各面板既有正确遮罩外壳，仅局部抽取重复逻辑（避免整体重写大体量 return 块引发视觉/行为回归）。
