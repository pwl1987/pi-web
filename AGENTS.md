# Pi Agent Web — 开发指南

## 项目概述

Pi Agent Web（`@agegr/pi-web`）是 pi coding agent 的本地 Web UI，一个 **Next.js 16（App Router）全栈应用**。它在命令行智能体之上套了一层浏览器界面，支持会话浏览、实时聊天、模型配置、技能/插件/MCP 管理、todo 面板、文件预览与 Git worktree 切换。

**核心依赖**（`package.json`）：

- `@earendil-works/pi-coding-agent` ^0.80.3（智能体运行时）
- `@earendil-works/pi-ai` ^0.80.3（模型层）
- `next` 16.2.9 + `react` ^19.2.4 + `typescript` ^5（strict，`@/*` → 仓库根）
- **Node >= 20.19**（`engines`）
- 安装后自动跑 `scripts/postinstall.mjs`（CI / 全局安装 / 非仓库目录跳过），可 `npm run setup:lsp` 手动触发

---

## 快速开始与常用命令

| 类别 | 命令                          | 用途                                                                                           |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| 启动 | `npm run dev`                 | `next dev -p 30141`                                                                            |
| 启动 | `npm run start`               | `next start -p 30141`（生产）                                                                  |
| 构建 | `npm run build`               | `next build --webpack`，**仅发版时执行**（污染 `.next/`）                                      |
| 检查 | `npm run lint`                | ESLint（v9 flat config）                                                                       |
| 检查 | `npm run lint:fix`            | `eslint . --fix`                                                                               |
| 检查 | `npm run type-check`          | `tsc --noEmit`                                                                                 |
| 格式 | `npm run format`              | `prettier --write .`                                                                           |
| 格式 | `npm run format:check`        | `prettier --check .`（CI 用）                                                                  |
| 测试 | `npm test`                    | `test:node && vitest run`                                                                      |
| 测试 | `npm run test:watch`          | `vitest` 监听                                                                                  |
| 测试 | `npm run test:ui`             | `vitest --ui`                                                                                  |
| 测试 | `npm run test:coverage`       | `vitest run --coverage`（v8）                                                                  |
| 测试 | `npm run test:node`           | `node --test --experimental-strip-types lib/*.test.mjs lib/i18n/index.test.mjs bin/*.test.mjs` |
| CI   | `npm run ci`                  | `format:check && lint && type-check && test:node && test:coverage`                             |
| 环境 | `npm run setup` / `setup:lsp` | 安装 LSP（json/typescript/yaml-language-server）                                               |
| 发布 | `npm run release`             | `npm version patch --no-git-tag-version && build && npm publish --access public`               |

**运行单个测试**：

- node：`node --test --experimental-strip-types lib/<name>.test.mjs`
- vitest：`npx vitest run <path>`（默认 `node` 环境；需 DOM 的文件加 `// @vitest-environment jsdom`，如 `components/SessionSidebar.test.tsx`）

**环境变量**：`PI_CODING_AGENT_DIR`（默认 `~/.pi/agent`）；`PORT` / `--port` 覆盖端口；`bin/pi-web.js` 还支持 `--hostname/-H` 与 `install`/`uninstall`（systemd/launchd 注册）。

---

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│  浏览器 (React 19 客户端)                                │
│  AppShell → SessionSidebar + ChatWindow + FileViewer    │
│  hooks/useAgentSession：消息流、SSE、分支、对账          │
└───────────┬──────────────────┬──────────────────────────┘
            │ REST (JSON)      │ SSE (text/event-stream)
            ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│  Next.js Server (app/api/** 路由处理器)                  │
│  - 浏览：只读 .jsonl（lib/session-reader.ts）            │
│  - 发送：lib/rpc-manager.ts 在进程内建 AgentSession      │
└───────────┬──────────────────────────────────────────────┘
            │ serverExternalPackages
            ▼
┌─────────────────────────────────────────────────────────┐
│  @earendil-works/pi-coding-agent + pi-ai (智能体内核)    │
│  经 lib/pi-ports.ts 接口 + lib/pi-sdk-adapter.ts 适配    │
│  持久化：~/.pi/agent/sessions/*.jsonl                   │
└─────────────────────────────────────────────────────────┘
```

**核心原则**：

- **读 / 写分离**：浏览历史只读 `.jsonl`（`session-reader.ts`）；发消息才在进程内建 `AgentSession`（`rpc-manager.ts` 的 `startRpcSession()`）
- **`globalThis` 跨热重载存活**：Session 注册表、运行态、路径缓存、扩展注册表全部挂在 `globalThis` 上
- **SDK 解耦**：`lib/pi-ports.ts` 定义 `PiSdkPort` 接口，`lib/pi-sdk-adapter.ts` 实现，`lib/pi-types.ts` 定义领域类型。详见 `docs/ARCHITECTURE-DECOUPLING.md`
- **SDK 不进客户端 bundle**：`@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai` 在 `next.config.ts` 列为 `serverExternalPackages`，**仅限** `app/api/**`、`lib/rpc-manager.ts`、`lib/pi-sdk-adapter.ts` 导入

---

## 技术栈

| 维度     | 选型                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 框架     | Next.js 16 (App Router) + React 19                                                                                                                                      |
| 语言     | TypeScript 5（strict，`@/*` → 仓库根）                                                                                                                                  |
| 样式     | Tailwind CSS 4（`@tailwindcss/postcss` 插件）+ CSS 变量主题（明/暗）                                                                                                    |
| 流式     | 原生 SSE（`EventSource` + `ReadableStream`），端点 `app/api/agent/[id]/events` 与 `app/api/agent/running/events`                                                        |
| Markdown | `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex/raw/sanitize` + `react-syntax-highlighter` + `mermaid`                                                  |
| 智能体   | `@earendil-works/pi-coding-agent` ^0.80.x + `@earendil-works/pi-ai` ^0.80.x；`lib/pi-sdk-adapter.ts` 端口适配                                                           |
| 测试     | 双轨：node:test（纯逻辑）+ vitest 4（默认 `node`，DOM 文件加 jsdom pragma）                                                                                             |
| 扩展     | 浏览器侧可信 ES module（`extensions/` 内置 + `~/.pi-web/extensions/` 本地；动态 `import(/* webpackIgnore */ url)`，React 实例经 `window.React`/`window.ReactDOM` 共享） |
| i18n     | 自研零依赖（`lib/i18n/{index,en,zh,types}.ts`，`useSyncExternalStore` + localStorage）                                                                                  |
| CLI      | `bin/pi-web.js`（`bin: pi-web`，`--port` / `-H` / `install` / `uninstall`）                                                                                             |

---

## 目录结构

```
pi-web/
├── app/                                # Next.js App Router
│   ├── layout.tsx                      # 字体 + KaTeX + preload 防 FOUC 脚本
│   ├── page.tsx                        # 唯一页面 → <Suspense> 包裹 <AppShell/>
│   ├── globals.css                     # 全局样式 + CSS 变量主题
│   └── api/                            # 全部 REST/SSE 路由（按业务域）
│       ├── agent/                      # new / [id] / [id]/events(SSE) / running/events / enhance
│       ├── agents-md/                  # AGENTS.md 优化（route + optimize）
│       ├── auth/                       # all-providers / providers / api-key / login / logout（按 provider）
│       ├── cwd/validate/, default-cwd/, worktrees/, home/, git-diff/
│       ├── extensions/                 # list / install / uninstall / manifest / config / git-status / [extensionId]/[...asset]
│       ├── file-index/, files/[...path]/
│       ├── mcp-adapter/, mcp-config/   # 路由 + env/scan + env/setup + codegraph/setup + test
│       ├── models/, models-config/test/
│       ├── pinned-dirs/, plugins/{config,recommended}/
│       ├── sessions/ + sessions/[id]/{context,export}/
│       ├── settings/, skills/{install,search}/, subagents/
│       ├── task-list/, todos/, token-usage/[provider]/, web-search-config/
├── components/                         # 56 个 .tsx + 5 测试 + 1 registry（新增 Settings/ 子目录 11 文件 + useSettings.test.tsx）
│   ├── AppShell.tsx ★                  # 顶层布局 + URL 状态 + 标签/面板编排
│   ├── ChatWindow.tsx ★                # 聊天组合 + useAgentSession 容器
│   ├── ChatInput.tsx, MessageView.tsx
│   ├── SessionSidebar.tsx ★            # 会话树 + FileExplorer
│   ├── BranchNavigator.tsx, SessionItem.tsx
│   ├── CommandPalette.tsx              # 命令面板（扩展 actions 入口）
│   ├── MarkdownBody.tsx
│   ├── FileExplorer.tsx, FileViewer.tsx, FileIcons.tsx, Icons.tsx, PathLabel.tsx
│   ├── ChatMinimap.tsx, TabBar.tsx, TopBarButton.tsx, AnimatedDropdown.tsx
│   ├── LazyLoader.tsx, Skeleton.tsx, ErrorBoundary.tsx, ErrorState.tsx
│   ├── *Config.tsx                     # Models/Skills/Plugins/Mcp/Agents/Extensions/WebSearch/Settings 等模态面板
│   ├── InspectorPanel.tsx, InspectorTaskRow.tsx
│   ├── SubagentsPanel.tsx, SubagentBadge.tsx
│   ├── TodoPanel.tsx, TodoSidebar.tsx, TodoBadge.tsx
│   ├── TokenUsageIndicator.tsx, StatusIndicators.tsx
│   ├── PinnedDirsList.tsx, PinCurrentDirButton.tsx, EnvProvisionButton.tsx
│   ├── PluginConfigPage.tsx, PiAgentTitle.tsx
│   ├── Settings/                        # 方案 A 拆分：schema-driven 设置面板
│   │   ├── index.tsx                    # 三面板编排入口
│   │   ├── P1General.tsx                # 通用设置（语言/主题/声音）
│   │   ├── P1BuiltinPlugins.tsx         # 内置插件设置，含 P1.1/P1.2/P1.3 三档折叠
│   │   ├── P2Advanced.tsx               # 高级设置（debug/feature flag）
│   │   ├── FoldSection.tsx              # 折叠容器（details 原生实现）
│   │   ├── controls/                    # 控件组件库
│   │   │   ├── Switch.tsx, NumberInput.tsx, TextInput.tsx
│   │   │   ├── Select.tsx, Textarea.tsx, StringList.tsx
│   │   └── fields/FieldRenderer.tsx     # 按 FieldType 分发到对应控件
│   └── *.test.tsx                      # vitest（jsdom）
├── hooks/                              # 18 个业务 hook + 7 测试（新增 useSettings.test.tsx）
│   ├── useAgentSession.ts ★            # 消息流、SSE、分支、fork、滚动、对账
│   ├── useExtensions.ts                # UI 扩展加载
│   ├── useI18n.ts, useTheme.ts         # 国际化 / 主题（useSyncExternalStore）
│   ├── useAudio.ts, useDragDrop.ts, useIsMobile.ts, useOnlineStatus.ts
│   ├── useConfiguredProviders.ts, useGlobalShortcuts.ts, useIsCwdPinned.ts
│   ├── useMessageScroll.ts, useScrollToEntry.ts, useTaskKeyboardNav.ts
│   ├── usePersistentState.ts, useScramble.ts, useTodoLiveRefresh.ts, useTokenUsage.ts
│   └── *.test.tsx
├── lib/                                # ~66 个服务端/共享模块 + 配套测试（新增 config-schema / all-schemas / settings-storage-adapter）
│   ├── pi/                             # SDK 解耦层
│   │   ├── pi.ts, pi-ports.ts          # PiSdkPort 接口
│   │   ├── pi-sdk-adapter.ts           # 端口实现
│   │   ├── pi-types.ts, env-types.ts   # 领域类型
│   ├── rpc-manager.ts ★                # AgentSessionWrapper + startRpcSession
│   ├── session-reader.ts ★             # 只读会话读取 + 路径缓存 + buildSessionContext
│   ├── session-registry.ts, session-reparent.ts, session-utils.ts, session-file-references.ts(_core)
│   ├── agent-runtime-store.ts, agent-client.ts, agent-session-helpers.ts
│   ├── session-state-store.ts          # 重启恢复 sidecar（pi-web-state.json）
│   ├── task-entry-resolver.ts, compaction-summary.ts, token-usage.ts
│   ├── normalize.ts                    # toolCall 字段归一化
│   ├── tool-presets.ts, tool-labels.ts, worktree.ts
│   ├── file-access.ts, file-types.ts, file-paths.ts, file-fuzzy.ts, file-links.ts
│   ├── markdown.ts, syntax-highlighter-theme.ts, extension-theme.ts
│   ├── ansi.ts, clipboard.ts, scroll-into-view.ts, message-display.ts, draft-store.ts
│   ├── inspector-task-id.ts, allowed-commands.ts, allowed-roots.ts
│   ├── extensions/                     # UI 扩展系统（types/registry/discovery/event-bus）
│   ├── i18n/                           # 零依赖 i18n
│   ├── constraints/                    # 约束引擎
│   ├── api-shared.ts, api-types.ts, api-utils.ts, csrf.ts, csrf-client.ts
│   ├── config-schema.ts ★               # 方案 A：插件配置元信息 SSoT（discriminated union）
│   ├── all-schemas.ts                   # 33 插件 / 81 字段具体 schema 数据
│   ├── settings-storage-adapter.ts      # 持久化抽象（localStorage + BroadcastChannel）
│   ├── config-file.ts, config-validators.ts
│   ├── plugin-*, mcp-*, recommended-plugins.ts, npx.ts, patch.ts
│   ├── pinned-dirs-bus.ts, prompt-enhance.ts
│   ├── test-fetch-mock.ts              # 端到端 fetch mock
│   ├── types.ts                        # SessionEntryBase / AgentMessage 等
│   └── *.test.{mjs,ts}
├── extensions/                         # 内置 UI 扩展
│   └── git-status/                     # {index.ts, index.js, package.json}
├── scripts/                            # 仓库级工具
│   ├── postinstall.mjs                 # 自动检测 + 安装 LSP（CI/全局/非仓库跳过）
│   └── setup-lsp.mjs                   # 手动安装 json/typescript/yaml-language-server
├── bin/
│   ├── pi-web.js                       # npm CLI 入口
│   └── hostname.test.mjs
└── docs/
    ├── ARCHITECTURE-ANALYSIS.md        # 主架构分析
    ├── ARCHITECTURE-DECOUPLING.md      # Pi SDK 解耦
    ├── component-splitting-strategy.md # 组件拆分策略
    ├── plugin-and-sessiond-design.md   # 插件与 sessiond 设计
    ├── release.md                      # Release Checklist
    ├── remote-access.zh-CN.md
    ├── worktrees.md / worktrees.zh-CN.md
    └── screenshot2.png
```

---

## 关键模块速览

| 模块                         | 职责                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/rpc-manager.ts`         | `AgentSessionWrapper` 包裹 SDK `AgentSession`，暴露统一 `send(command)`（prompt / abort / get_state / fork / navigate_tree / compact / set_tools）。空闲 10 分钟自动 `destroy`。并发 `startRpcSession()` 通过 `globalThis.__piStartLocks` 合并。                                                                                                                                                                                                 |
| `lib/session-reader.ts`      | `listAllSessions()` 遍历 `SessionManager.listAll()`，补 `projectRoot`/`worktreeBranch`，填路径缓存（`globalThis.__piSessionPathCache`，60s TTL）。`buildSessionContext(entries, leafId?)` 从叶子回溯到根构建 UI 消息列表。                                                                                                                                                                                                                       |
| `hooks/useAgentSession.ts`   | SSE 连接与重连（5s 超时）、事件解析（`agent_start` / `message_update` / `tool_execution_*` / `compaction_*`）、发送 / abort / fork / 分支导航 / 模型切换 / 压缩 / slash。**对账**：每 15s 或 `visibilitychange`/`online` 时 `GET /api/agent/[id]` 与 SSE 对齐。**runId 单调守卫**防过期响应复活旧流式气泡。                                                                                                                                      |
| `lib/agent-runtime-store.ts` | `useSyncExternalStore` + `globalThis` 单例，让 ChatWindow 之外的组件（顶部栏、扩展面板）观察 running / phase / tools / stats / contextUsage。                                                                                                                                                                                                                                                                                                    |
| `lib/extensions/`            | 可信 ES module，三类贡献：`actions`（Cmd+K 命令面板）、`workspacePanels`（右侧标签）、`workspaceLabels`（会话列表内联元数据）。`discovery.ts` 扫 `extensions/` + `~/.pi-web/extensions/`；`hooks/useExtensions.ts` 在挂载时 `fetch manifest → import(/* webpackIgnore */ url) → registry.register()`。AppShell 暴露 `window.React`/`window.ReactDOM` 共享 React 实例；`register()` 校验 id（`extensionId:localId`，正则 `^[a-z][a-z0-9.-]*$`）。 |

---

## 数据流

### 发送消息（主链路）

```
ChatInput.handleSend
  → useAgentSession.handleSend
    ├─ 乐观追加用户气泡（ref 记 key，去重）
    ├─ 新会话：POST /api/agent/new → sessionId
    ├─ ensureEventsConnected() → new EventSource(/api/agent/[id]/events)
    └─ sendAgentCommand(id, {type:"prompt", message, images?})
          │ fetch POST /api/agent/[id]
          ▼
      AgentSessionWrapper.send({type:"prompt"})
        → inner.prompt(message) → SDK 事件 emit 回 wrapper
  ◀── SSE /api/agent/[id]/events ── session.onEvent → encode(event) ──▶
EventSource.onmessage → handleAgentEvent → setMessages → MessageView
```

### SSE 端点

| 端点                            | 用途                     |
| ------------------------------- | ------------------------ |
| `GET /api/agent/[id]/events`    | 单会话事件流             |
| `GET /api/agent/running/events` | 全局运行中会话列表       |
| `POST /api/agent/enhance`       | 提示词增强（独立短流程） |

服务端 `ReadableStream`：先发 `{type:"connected"}`，随后 `session.onEvent(e => encode(e))`，30s 心跳 `:\n\n` 防代理超时，`req.signal abort` 时清理。

### 会话分支（两种，不可混淆）

- **Fork**（用户消息上的 Fork 按钮）：创建**新的独立 .jsonl 文件**，侧栏树通过 `parentSession` header 显示为子会话。完成后**立即 `destroy()`** 原 wrapper（SDK `fork()` 会原地改写 `inner.sessionId`）
- **会话内分支**（Continue / BranchNavigator）：同一文件内 `navigate_tree`，多条共享 `parentId`。切换时 `/api/sessions/[id]/context?leafId=`

---

## 状态管理

不引入 Redux/Zustand，按作用域分层，统一 `useSyncExternalStore` "外部 store" 模式；需跨热重载存活的单例挂 `globalThis`：

| 状态                                | 存储位置                                     | 消费者                   |
| ----------------------------------- | -------------------------------------------- | ------------------------ |
| 会话消息、流式、工具、模型、分支    | `useAgentSession` 内部 state/ref             | ChatWindow 子树          |
| 运行态（running/phase/tools/stats） | `agent-runtime-store`（globalThis）          | AppShell、扩展面板       |
| Session 注册表 + 运行集合           | `session-registry`（globalThis）             | 侧栏、running/events SSE |
| 路径缓存                            | `session-reader` 缓存（globalThis, 60s TTL） | 所有读会话 API           |
| UI 扩展贡献                         | `extensions/registry`（globalThis）          | 命令面板、右侧栏         |
| 主题/语言                           | localStorage + `<html>` 属性                 | 全局                     |
| UI 偏好                             | `usePersistentState`（localStorage）         | AppShell                 |
| 重启恢复                            | `pi-web-state.json` sidecar                  | rpc-manager 启动预热     |

`ChatWindow` 以 `session.id` 为 React `key`，仅会话身份变化时才重挂载。

---

## 工程化约束

### ESLint（v9 flat config）

`eslint.config.mjs`：层次 `eslint-config-next/core-web-vitals` → `eslint-config-next/typescript` → 自定义覆盖。

- 放宽：`react-hooks/{immutability,refs,set-state-in-effect}: off`
- 加严：`@typescript-eslint/consistent-type-imports: error`（`inline-type-imports`）、`no-explicit-any: warn`、`array-type: array-simple`、`no-non-null-assertion: warn`、`no-console: warn`（仅允许 `warn`/`error`）
- **不开 type-aware 规则**（避免 `parserOptions.project` 与 `tsc --noEmit` 重复）
- 忽略：`.next/`、`node_modules/`、`dist/`、`coverage/`、`*.min.js`

### Prettier / EditorConfig

`.prettierrc` + `.prettierignore`（`npm run format` / `format:check`）；`.editorconfig` 统一编辑器行为。

### Husky + lint-staged

`.husky/pre-commit`（按序执行）：

```sh
npx lint-staged
npm run type-check
npm run test:node
npx vitest run
```

> 覆盖率门禁（`test:coverage`）不在 pre-commit 里跑——它是防回归手段，CI 的 `npm run ci` 已覆盖。pre-commit 只跑 `vitest run`（无 coverage 报告生成开销），兼顾反馈速度与本地通过 CI 的保证。

`package.json` `lint-staged`：

- `*.{js,mjs,cjs,jsx,ts,tsx}` → `prettier --write` + `eslint --fix --no-warn-ignored`
- `*.{json,md,yaml,yml,css}` → `prettier --write`

### 提交规范

仓库未启用 commitlint；pre-commit 仅做格式化 + 类型检查 + 测试，commit message 自由。

---

## 样式与 Tailwind 4

- **PostCSS**（`postcss.config.mjs`）：唯一插件 `@tailwindcss/postcss`
- **Tailwind**（`tailwind.config.ts`）：`content` 覆盖 `pages/components/app/**/*.{js,ts,jsx,tsx,mdx}`，`theme.extend` 留空
- **CSS 变量**（`app/globals.css`）：`@theme` 内联块 + `:root` / 暗色双套变量。核心 token：`--bg`、`--bg-panel`、`--bg-hover`、`--bg-selected`、`--border`、`--text`、`--text-muted`、`--text-dim`、`--accent`、`--user-bg`、`--tool-bg`、`--font-mono`，语义别名 `--color-error-soft`、`--color-success-bg`、`--color-doc-bg` 等
- **主题切换**：View Transitions API + `hooks/useTheme.ts` 在 `transition.ready` 后驱动 circular wipe；UA 默认 cross-fade 已 `animation: none` 关闭

---

## 关键设计决策与陷阱

### 导入规则

- `@/*` → 仓库根（`tsconfig.json` `paths`）。**app/components/hooks 用 `@/*`，`lib/` 内互引用用相对路径**
- **禁止客户端代码导入 `@earendil-works/pi-coding-agent` / `pi-ai`**——`serverExternalPackages`，仅限 `app/api/**`、`lib/rpc-manager.ts`、`lib/pi-sdk-adapter.ts`

### AgentSession 生命周期

`globalThis.__piSessions` 以 id 索引 `AgentSessionWrapper`（跨热重载存活）。空闲 10 分钟超时；并发 `startRpcSession()` 通过 `globalThis.__piStartLocks` 合并。

### Fork 必须立即销毁 wrapper

`AgentSession.fork()` **原地改写** `inner.sessionId`。若 wrapper 仍以旧 id 存活，再次 fork 会产生错误 `parentSession` 链。**正确做法**：`send("fork")` 捕获 `newSessionId` 后立即 `this.destroy()`，下次按原 id 请求时从原始文件重新加载。

### ToolCall 字段归一化

pi 存 `{type:"toolCall", id, name, arguments}`，`ToolCallContent` 用 `{toolCallId, toolName, input}`。`lib/normalize.ts` 的 `normalizeToolCalls()` 在 `session-reader.ts`（文件加载）与 `ChatWindow.handleAgentEvent()`（流式）两条路径都调用。

### 新建会话的工具预设

`POST /api/agent/new` → `toolNames[]` 传工具名列表。已有会话挂载时 `get_tools` → `getPresetFromTools()` 推断活跃预设。完全禁用（`toolNames=[]`）时 `rpc-manager.ts` 传空白名单，并在启动 / 重载 / 资源发现后强制 `agent.state.systemPrompt = ""`。

### completeSimple 的系统提示词必须放在 Context 上

`completeSimple(model, context, options)` 的 `systemPrompt` 是 **`context.systemPrompt`**（第二个参数顶层字段），**不是** `options`（第三个参数）。`@earendil-works/pi-ai` 各 provider（anthropic-messages、openai-completions、google-vertex、mistral-conversations 等）只读 `context.systemPrompt`。误放 `options` 会被**静默丢弃**——模型只收到用户消息却不报错。

正确写法：

```ts
await completeSimple(
  model,
  {
    systemPrompt, // ✅ 必须在 context 上
    messages: [{ role: "user", content: buildEnhanceUserMessage(prompt) }],
  },
  { apiKey, headers, maxTokens: 4096, timeoutMs: 60_000, maxRetries: 0 },
);
```

`app/api/agent/enhance/route.ts` 提示词增强依赖此点——系统提示里硬编码"禁止执行 / 只重写 / few-shot 示例"，传错位置会退化成通用模板。

### SSE 重连与对账

- `ChatWindow` 挂载时 `GET /api/agent/[id]`；若 `state.isStreaming === true` 自动重连 SSE
- 运行期间每 15s 对账；`visibilitychange`/`online` 时触发
- **runId 单调守卫**：旧运行的延迟 SSE 或对账响应必须忽略，防止复活已结束的流式气泡

### Compaction 事件兼容

新版 `compaction_start` / `compaction_end`，旧版 `auto_compaction_start` / `auto_compaction_end`。`handleAgentEvent` 同时接受两套以保持 `isCompacting` 同步。手动压缩是阻塞 POST——按钮禁用直到响应返回。

### 会话文件可完全重写

`parentSession` header **仅用于显示元数据**——对聊天内容无影响。可用 `writeFileSync` 安全重写整个文件（pi 自身迁移时也这样做）。

### Worktree 与项目分组

- `lib/worktree.ts` 将关联 worktree 解析回主仓库 `projectRoot`；`listAllSessions()` 附加到每个 `SessionInfo`，使同一仓库的所有 worktree 在侧栏分组
- 新建 worktree 放 `<repoRoot>-worktrees/<sanitized-branch>`，已有分支复用，否则 `git worktree add -b`
- 删除脏 worktree 返回 `409 { dirty: true }`，UI 可询问后加 `force` 重试
- 指向已删除 worktree 的会话会回退到主项目，不会变孤立项目行

### 文件访问白名单

`/api/files` 非通用浏览器。允许根：会话 cwd、解析后的项目根、`~/pi-cwd-*`、`allowFileRoot()` 显式添加。预览大小 / 扩展名→MIME 在 `lib/file-types.ts`。

### Auth 与模型配置

- `ModelsConfig` 合并 `~/.pi/agent/models.json` 与 pi 的 `AuthStorage`/`ModelRegistry` 认证状态
- OAuth / 设备码由 `GET /api/auth/login/[provider]` 流式推送；手动码 `POST` 返回；短期 token 存 `globalThis.__piLoginCallbacks`
- API Key 状态端点**绝对不能返回原始 key**

### i18n

- `lib/i18n/index.ts`：`getSnapshot` 读 `<html data-lang>`（layout preload 脚本首帧前设置），`getServerSnapshot` 始终 `"en"`（SSR 安全）
- `en.ts` + `zh.ts`：扁平点号键（`"namespace.subkey"`）+ `{var}` 插值。**新增键必须同步写入两个文件**
- 持久化 `localStorage("pi-language")`，切换按钮在 AppShell 顶部栏
- `app/layout.tsx` preload `<script>` 首帧前设 `<html data-lang>` + `lang`，消除 FOUC

### 完成提示音

`hooks/useAudio.ts` 存 `pi-sound-enabled`，复用单 `AudioContext`。浏览器自动播放要求从用户手势解锁：`ChatInput` 从交互控件调解锁 hook，`ChatWindow` 在 `onAgentEnd` 播放提示音。

---

## Pi 会话文件格式

存储：`~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` 在 `SessionContext` 是 `messages[]` 的平行数组——将每条显示消息映射回 `.jsonl` 条目 id，用于 fork 和 `navigate_tree`。

---

## Vendor 集成约定（autoplan / comet 融合引擎）

pi-web 把 [autoplan](https://github.com/lyming99/autoplan)（自动计划生成/任务执行/反馈迭代）与 [comet](https://github.com/rpamis/comet)（五阶段可恢复状态机/OpenSpec 工件/守卫脚本）作为上游 vendoring 镜像融合为统一「自主编程引擎」，代码位于 `lib/unified-engine/` + `app/api/engine/**` + `components/AutonomousCodingDashboard.tsx`。

- **Vendoring 基座**：`vendor/autoplan`、`vendor/comet` 是上游在 `vendor/VENDOR.lock` 钉选 commit 的【原样镜像】，**禁止直接编辑**；仅锁文件与 `vendor/patches/<repo>/*.patch` 入库（镜像目录已加 `.gitignore`）。
- **同步机制**：`scripts/sync-vendor.mjs` 读 `VENDOR.lock` → `git fetch+checkout` 钉选 commit → 按文件名分层应用 `compat`/`fusion` 补丁 → 按 `trim` 规则裁剪非运行时目录（如 autoplan 的 `src/renderer`、comet 的 `website/docs`）→ 校验 `HEAD` 锁定 → 可选 `--typecheck` 跑 `npm run type-check`。支持 `--check`/`--dry`。
- **不可信供应链**：上游 `.mjs`/脚本**绝不 `import()`**，统一经白名单 `child_process` 调用（`lib/unified-engine/guards/comet-cli.ts` 仅允许 `comet-*.mjs`，校验绝对 `cwd` 与 `..`/空参）。autoplan 执行器默认关闭，由 `ENGINE_AUTOPLAN_EXECUTOR` flag 门禁；`ENGINE_AUTOPLAN_VENDOR=1` 才允许 `createRequire` 加载 vendor/autoplan。
- **分层反腐端口**（复用 `lib/pi` 范式）：业务层只依赖 `UnifiedEnginePort`（`unified-engine-ports.ts`）；其下 `PlanGeneratorPort`(autoplan) / `WorkflowStateMachinePort`(comet) 两能力端口分别由 `autoplan-adapter.ts` / `comet-adapter.ts` 唯一导入对应 vendor；`unified-engine-adapter.ts` 组合两端口做融合编排。
- **运行时**：`unified-engine-runtime.ts` 复用 `globalThis` 单例 + 10 分钟空闲销毁；以 comet 五阶段状态机为骨架，Build 阶段由引擎调 autoplan 拆任务并驱动执行，完成后触发 comet 守卫校验，通过则流转、失败则把守卫错误回灌 autoplan 重规划。
- **降级**：当 comet CLI 不可用时，引擎退化为内存态并默认放行守卫，保证可演示；vendor 已被 `tsconfig.json` `exclude` 排除，宿主永不类型检查上游。
- **人工决策分支**：进入自主编程引擎**不是默认行为**——Plan 讨论模式确认方案时，用户在「自主编程引擎模式」与「普通模式」间二选一；两种模式都先把方案完整落盘到 `docs/plans/<task-slug>.md`（`lib/plan-doc-store.ts`），只有引擎模式才会 `createChange` + `startRun`。详见下文「方案保存位置」。
- 详见：`docs/VENDOR-INTEGRATION.md`（解耦/融合/更新机制）、`docs/vendor-autoplan.md`、`docs/vendor-comet.md`（源码级分析）。

## 文档索引（`docs/`）

| 文档                                  | 主题                                           |
| ------------------------------------- | ---------------------------------------------- |
| `ARCHITECTURE-ANALYSIS.md`            | 主架构分析                                     |
| `ARCHITECTURE-DECOUPLING.md`          | Pi SDK 解耦（`PiSdkPort`）                     |
| `component-splitting-strategy.md`     | 组件拆分策略                                   |
| `plugin-and-sessiond-design.md`       | 插件与 sessiond 设计                           |
| `release.md`                          | Release Checklist（preflight → npm publish）   |
| `remote-access.zh-CN.md`              | 远程访问                                       |
| `worktrees.md` / `worktrees.zh-CN.md` | Worktree 行为详解                              |
| `VENDOR-INTEGRATION.md`               | autoplan/comet 解耦·融合·更新机制              |
| `vendor-autoplan.md`                  | autoplan 源码级分析（纯 Node 核心 + Electron） |
| `vendor-comet.md`                     | comet 源码级分析（.mjs CLI + YAML 状态机）     |
| `plans/`                              | 方案存档目录（按 `<task-slug>.md` 命名）       |

### 方案保存位置（Plan 讨论模式 · 确认产物）

用户在 Plan 讨论模式确认方案时，「自主编程引擎」是**人工决策分支**而非默认进入：

- **确认时二选一**（`components/PlanPanel.tsx` 底部操作栏）：
  - **自主编程引擎模式**（`mode: "engine"`）：落盘方案 → `createChange` + `startRun` → 跳转引擎面板，自动执行 编码→构建→测试→验证 循环。
  - **普通模式**（`mode: "plan"`）：仅产出完整开发方案、不启动引擎，用户人工确认后再执行。
- **无论哪种模式**，最终方案都以 Markdown 完整保存到 `docs/plans/<task-slug>.md`（`lib/plan-doc-store.ts`，中文 slug 保留 CJK 字符；落盘位置由 cwd 向上解析仓库根）。
- **模板含 11 节**：用户需求、确认方案、是否进入引擎（前置/风险/回退）、功能拆分、受影响文件清单、接口契约、依赖变更、关键代码示例、验收标准、测试与验证步骤、回滚方案。验证命令按目标项目 `package.json` scripts 动态探测。
- 接缝：`app/api/plan/[id]/confirm/route.ts` 的 `mode` 分支。

---

## 中文本地化约束（强制）

中文语境下，对所有 AI 代理与代码产出执行严格本地化：

- **用户可见文案（状态 / 提示 / 交互回复 / 系统提示）**：必须全中文，**禁止**输出未翻译英文。用户可见字符串一律走 `lib/i18n/zh.ts`（zh/en 双语）
- **TODO / 任务列表 / 进度追踪 / 执行步骤**：全中文
- **代码注释**：新写注释用中文
- **变量命名**：内部标识符（变量 / 函数 / 类名）保留英文（行业惯例，避免破坏编译与跨文件引用）；仅当用户显式要求时才中文化
- **最终回复**：全中文，不夹带裸英文短语

> 技术专有名词（API 名、库名、协议字段、CLI 命令）保留英文原词；面向用户的表述必须翻译。
> 本约定与 `.codebuddy/memory/MEMORY.md` 长期约定一致。
