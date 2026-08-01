# Pi Agent Web — 项目架构分析文档

> 分析对象：`@agegr/pi-web`（pi coding agent 的 Web UI），版本 0.7.9
> 分析日期：2026-07-11
> 本文档基于源码静态分析，覆盖架构总览、技术栈、目录结构、入口与路由、核心模块、状态管理与数据流向。

---

## 1. 架构总览

Pi Agent Web 是一个 **Next.js（App Router）全栈应用**，本质是为命令行编程智能体 `pi`（`@earendil-works/pi-coding-agent`）套上一层浏览器界面。整体分为三层：

```
┌─────────────────────────────────────────────────────────────┐
│  浏览器 (React 19 客户端)                                      │
│   AppShell → SessionSidebar + ChatWindow + FileViewer ...    │
│   hooks/useAgentSession 负责消息流、SSE、滚动、分支导航        │
│   lib/agent-client (fetch 封装) · lib/agent-runtime-store     │
└───────────────┬───────────────────────────┬─────────────────┘
                │  REST (JSON)               │  SSE (text/event-stream)
                ▼                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Next.js Server (app/api/** 路由处理器)                        │
│   - 会话浏览：只读读 .jsonl（SessionManager）                  │
│   - 发送消息：lib/rpc-manager 在进程内创建 AgentSession         │
└───────────────┬───────────────────────────────────────────────┘
                │  import (serverExternalPackages)
                ▼
┌─────────────────────────────────────────────────────────────┐
│  @earendil-works/pi-coding-agent / pi-ai (智能体内核)          │
│   AgentSession · SessionManager · 模型注册表 · 工具/扩展系统    │
│   持久化：~/.pi/agent/sessions/*.jsonl                        │
└─────────────────────────────────────────────────────────────┘
```

**关键设计原则（来自 AGENTS.md 与源码）：**

- **两种会话访问路径**：
  - _会话浏览（只读）_：直接通过 SDK 的 `SessionManager` 读取磁盘上的 `.jsonl` 文件，不创建 `AgentSession`（见 `lib/session-reader.ts`、`app/api/sessions/**`）。
  - _发送消息（交互）_：`lib/rpc-manager.ts` 的 `startRpcSession()` 在 **Next.js 进程内** 创建一个 `AgentSession`，并通过 `AgentSessionWrapper` 包裹，供后续命令与 SSE 复用。
- **`globalThis` 跨热重载存活**：Session 注册表、运行态、路径缓存、扩展注册表都挂在 `globalThis` 上，使 Next.js dev 热更新不会丢失内存中的会话状态（`session-registry.ts`、`agent-runtime-store.ts`、`session-reader.ts`、`extensions/registry.ts`）。
- **SDK 不可进入客户端 bundle**：`@earendil-works/pi-coding-agent` 与 `pi-ai` 被 `next.config.ts` 列为 `serverExternalPackages`，只在 `app/api/**` 与 `lib/rpc-manager.ts` 中通过服务端导入。

---

## 2. 技术栈

| 维度          | 选型                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 框架          | Next.js 16（App Router，`force-dynamic` 的 SSE 路由）、React 19                                                                                |
| 语言          | TypeScript 5（`strict`，路径别名 `@/*` → 仓库根）                                                                                              |
| 样式          | Tailwind CSS 4（`@tailwindcss/postcss`），大量内联 style + CSS 变量（`--bg`、`--text`、`--accent` 等），支持明暗主题                           |
| 流式通信      | 原生 `EventSource`（SSE）+ `ReadableStream` 服务端推送                                                                                         |
| Markdown 渲染 | `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-raw` + `rehype-sanitize`；代码高亮 `react-syntax-highlighter`       |
| 其他渲染      | `mermaid`（图）、`katex`、`mammoth`（docx 解析）                                                                                               |
| 智能体内核    | `@earendil-works/pi-coding-agent` `^0.80.3`、`@earendil-works/pi-ai` `^0.80.3`                                                                 |
| 图标          | `@lobehub/icons`                                                                                                                               |
| 测试          | 两类：`node --test --experimental-strip-types lib/*.test.mjs`（直接 import `.ts`，Node 22+ 原生去类型）+ `vitest run`（React 组件测试，jsdom） |
| 扩展系统      | 浏览器侧可信 ES module（动态 `import`，`webpackIgnore`），React 实例经 `window.React`/`window.ReactDOM` 共享                                   |
| 国际化        | 自研零依赖 i18n（`lib/i18n`，`useSyncExternalStore` + localStorage）                                                                           |
| 发布脚本      | `bin/pi-web.js`（CLI `bin: pi-web`，支持 `--port`/`-H` 及 `install`/`uninstall` 注册 systemd/launchd 自启）                                    |

---

## 3. 目录结构说明

```
pi-web/
├── app/                      # Next.js App Router 入口与全部 API
│   ├── layout.tsx            # 根布局：字体、KaTeX CSS、preload 防 FOUC 脚本
│   ├── page.tsx              # 唯一页面 → 渲染 <AppShell/>
│   ├── globals.css           # 全局样式与 CSS 变量（主题）
│   └── api/                  # 服务端路由（按业务域分组）
│       ├── agent/            # 智能体交互：new / [id] (state+command) / [id]/events (SSE) / running/events
│       ├── sessions/         # 会话浏览：list / [id] / [id]/context / [id]/export
│       ├── auth/             # API Key 与 OAuth/设备码登录
│       ├── models/ models-config/  # 模型列表与 models.json 读写/测试
│       ├── cwd/ default-cwd/ worktrees/  # 工作目录与 git worktree
│       ├── files/ file-index/  # 文件预览（只读）与 @ 自动补全索引
│       ├── plugins/ skills/ subagents/ agents-md/  # 能力扩展管理
│       ├── extensions/       # 浏览器侧 UI 扩展发现与资源
│       └── token-usage/ ...  # 配额用量等
├── components/              # 36 个 .tsx：UI 组件（全部客户端）
│   ├── AppShell.tsx         # 顶层布局 + URL 状态 + 标签/面板编排（约 1450 行）
│   ├── ChatWindow.tsx       # 聊天组合 + useAgentSession 容器
│   ├── ChatInput.tsx        # 输入框 + 模型/思考/工具/压缩控件
│   ├── MessageView.tsx      # 单条消息渲染
│   ├── SessionSidebar.tsx   # 会话树 + FileExplorer
│   ├── BranchNavigator.tsx  # 会话内分支切换
│   ├── MarkdownBody.tsx / FileViewer.tsx / TabBar.tsx ...
│   └── *Config.tsx          # Models/Skills/Plugins/Extensions/MCP/Subagents 等模态面板
├── hooks/                   # 21 个：业务 hooks
│   ├── useAgentSession.ts   # 核心：消息流、SSE、分支、fork、滚动、扩展 UI（约 1660 行）
│   ├── useI18n.ts useTheme.ts useExtensions.ts useIsMobile.ts useAudio.ts useDragDrop.ts usePersistentState.ts ...
├── lib/                     # 50 个 .ts + 测试（服务端/共享逻辑）
│   ├── rpc-manager.ts       # ★ AgentSessionWrapper + startRpcSession + 重启恢复
│   ├── session-registry.ts  # ★ globalThis 会话注册表 + 运行态广播
│   ├── session-reader.ts    # ★ 只读会话读取 + 路径缓存 + buildSessionContext
│   ├── session-state-store.ts # sidecar 状态文件（重启预热的会话清单）
│   ├── agent-client.ts      # 客户端 fetch 封装（POST /api/agent/[id]）
│   ├── agent-runtime-store.ts # 运行时状态 store（useSyncExternalStore）
│   ├── i18n/                # 轻量 i18n 核心（index.ts + en.ts + zh.ts）
│   ├── extensions/          # 浏览器侧扩展系统（types/registry/discovery/event-bus）
│   ├── normalize.ts         # ToolCall 字段归一化（文件格式 ↔ 类型）
│   ├── tool-presets.ts worktree.ts file-access.ts ansi.ts patch.ts ...
│   └── *.test.mjs           # 与模块同目录的 node:test 测试
├── extensions/              # 内置示例 UI 扩展（git-status：action+panel+label）
├── bin/pi-web.js            # CLI 入口与系统服务注册
├── docs/                    # 发布/文档
└── config 文件              # next.config.ts / tailwind.config.ts / tsconfig.json / eslint.config.mjs
```

---

## 4. 入口文件与路由设计

### 4.1 入口链路

1. `app/layout.tsx`：根布局。注入 `Noto_Sans_Mono` 字体、KaTeX CSS、`globals.css`；`<head>` 内联 preload 脚本在读 `localStorage` 的 `pi-theme`/`pi-language` 后于首帧前给 `<html>` 打上 `dark`/`data-lang`，消除主题与语言的 FOUC。
2. `app/page.tsx`：单一页面，用 `<Suspense>` 包裹 `<AppShell/>`（AppShell 使用 `useSearchParams` 必须 Suspense）。
3. `components/AppShell.tsx`：整个应用的客户端根，负责三栏布局（左 Sidebar / 中 Chat / 右 File+Panel）、顶部栏、命令面板（Cmd+K）、各配置模态、以及把选取的会话传给 `ChatWindow`（以 `session.id` 作为 `key` 控制重挂载）。

### 4.2 API 路由（`app/api`，均按域分组）

| 路由                                                              | 方法             | 作用                                                                        |
| ----------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| `/api/sessions`                                                   | GET              | 列出所有会话 + 当前运行中的 id（`listAllSessions()`）                       |
| `/api/sessions/[id]`                                              | GET/PATCH/DELETE | 读取（含 `?includeState` 拉取实时 agentState）/改名/删                      |
| `/api/sessions/[id]/context`                                      | GET              | 指定 `leafId` 的分支上下文（`buildSessionContext`）                         |
| `/api/sessions/[id]/export`                                       | GET              | 导出 HTML                                                                   |
| `/api/agent/new`                                                  | POST             | 新建会话（`cwd`/`modelId`/`toolNames`/`thinkingLevel`），返回真实 sessionId |
| `/api/agent/[id]`                                                 | GET/POST         | GET 取状态；POST 透传任意命令（prompt/fork/set_model/compact…）             |
| `/api/agent/[id]/events`                                          | GET              | **SSE** 推送该会话的实时事件流                                              |
| `/api/agent/running/events`                                       | GET              | SSE 推送“当前运行中会话 id”集合变化                                         |
| `/api/auth/**`                                                    | GET/POST         | API Key 状态、OAuth/设备码、登出                                            |
| `/api/models` `/api/models-config/**`                             | GET/PUT/POST     | 模型列表、`models.json` 读写与测试                                          |
| `/api/cwd` `/api/default-cwd` `/api/worktrees`                    | —                | 工作目录校验/创建、git worktree                                             |
| `/api/files/[...path]` `/api/file-index`                          | GET              | 只读文件预览、@ 自动补全索引                                                |
| `/api/plugins` `/api/skills/**` `/api/subagents` `/api/agents-md` | GET/POST         | 能力包/技能/子代理管理                                                      |
| `/api/extensions/**`                                              | —                | 浏览器侧 UI 扩展的 manifest 与资源                                          |
| `/api/token-usage/**` 等                                          | —                | 配额用量等                                                                  |

所有 `/api/agent/**` 的写命令统一由 `lib/agent-client.ts` 的 `sendAgentCommand()` 封装：`POST /api/agent/<id>` → 返回 `{ success, data }` 或 `{ error }`。

---

## 5. 核心模块功能描述

### 5.1 `lib/rpc-manager.ts` — 智能体会话中枢 ★

- `AgentSessionWrapper`：包裹 SDK 的 `AgentSession`，暴露统一的 `send(command)` 接口（`prompt`/`abort`/`get_state`/`set_model`/`fork`/`navigate_tree`/`compact`/`set_tools`/`get_commands`/`reload`/扩展 UI 交互等）。
- 职责：订阅 SDK 事件并 `emit`、维护空闲计时器（**10 分钟**无活动自动 `destroy`）、桥接 **扩展 UI 上下文**（把 `select`/`confirm`/`input`/`editor`/`custom` 等请求转发到浏览器端弹窗）。
- `startRpcSession(id, file, cwd, toolNames?)`：用 `globalThis.__piStartLocks` 合并并发启动，避免重复创建；创建后写入 sidecar（`recordActiveSession`）并触发懒加载的扩展绑定。
- **Fork 必须立即销毁 wrapper**：`fork` 后 SDK 会原地改写 inner 的 `sessionId`，若不销毁会导致后续 fork 链错乱（见源码注释）。
- **工具全关时强制空 systemPrompt**：`toolNames=[]` 时 `setForceEmptySystemPrompt(true)`。

### 5.2 `lib/session-registry.ts` — 会话注册表与运行态广播 ★

- 维护 `globalThis.__piSessions`（id→`SessionHandle`）与 `__piStartLocks`。
- `notifyRunningChange()`：在运行会话集合变化时广播给 `subscribeRunningSessions` 的订阅者（驱动侧边栏实时高亮）。

### 5.3 `lib/session-reader.ts` — 只读会话读取 ★

- `listAllSessions()`：遍历 `SessionManager.listAll()`，补充 `projectRoot`/`worktreeBranch`（经 `resolveProject`），并填充路径缓存。
- `buildSessionContext(entries, leafId?)`：从分支叶子回溯到根，构建 UI 消息列表；保留 compact/branch_summary 为内联摘要，从而**完整展示**被压缩的历史（与 SDK 仅给模型上下文不同）。
- 路径缓存 `globalThis.__piSessionPathCache`（60s TTL），`resolveSessionPath` 在缓存失效时回退到全量扫描。

### 5.4 `lib/session-state-store.ts` — 重启恢复 sidecar

- 写入 `~/.pi/agent/pi-web-state.json`，记录最近 20 个活跃会话 + `toolsDisabled` 标志 + 固定目录。
- 进程首次访问注册表时 `maybeRestore()` → `restoreActiveSessions()` 预热最近 5 个会话（fire-and-forget，失败不阻塞启动）。

### 5.5 `hooks/useAgentSession.ts` — 前端会话状态机 ★

- 单一巨型 hook，封装：加载会话/上下文、SSE 连接与重连（5s 连接超时 + 断线自动重连）、事件处理（`handleAgentEvent` 解析 `agent_start`/`message_update`/`tool_execution_*`/`compaction_*`/`extension_ui_request` 等）、发送消息、abort、fork、分支导航、模型/思考/工具切换、压缩、slash 命令、通知（notice）、扩展对话框、滚动跟随与“用户主动滚动意图”判定、以及**对账机制**（每 15s 或页面可见/网络恢复时，用 `GET /api/agent/[id]` 与 SSE 对齐，防止丢事件导致永久“流式”假象）。
- 通过 `getAgentRuntimeStore().update(...)` 把运行时状态（running/phase/tools/stats/contextUsage）同步到全局 store，供 AppShell 与扩展面板消费。

### 5.6 `lib/agent-runtime-store.ts` 与 `lib/extensions/registry.ts` — 全局 store

- 两者均采用 `useSyncExternalStore` + `globalThis` 单例模式。
- `AgentRuntimeStore`：让 ChatWindow 之外的组件（顶部栏、扩展面板）观察当前会话运行状态。
- `ExtensionRegistry`：持有已加载 UI 扩展的 `actions`/`panels`/`labels` 贡献，按 `extensionId:localId` 限定 id，每次 `register` 自增 version 触发重渲染。

### 5.7 扩展系统 `lib/extensions/`

- **浏览器侧 UI 扩展**（≠ SDK 插件）：可信 ES module，三类贡献：`actions`（Cmd+K 命令面板）、`workspacePanels`（右侧标签）、`workspaceLabels`（会话列表内联元数据）。
- `discovery.ts` 服务端扫描 `extensions/`（内置）与 `~/.pi-web/extensions/`（本地）；`hooks/useExtensions.ts` 在挂载时 `fetch manifest → import(/* webpackIgnore */ url) → registry.register()`；AppShell 把 `window.React/ReactDOM` 暴露出来以保证扩展共享同一 React 实例。

### 5.8 其他 lib 要点

- `normalize.ts`：把文件的 `{id,name,arguments}` 归一化为 `{toolCallId,toolName,input}`，文件加载与流式两条路径共用。
- `tool-presets.ts`：PRESET_NONE/DEFAULT/FULL 与 `getPresetFromTools`/`toolsToToolNames`，支撑工具开关 UI。
- `i18n/`：扁平点号键（`namespace.subkey`）+ `{var}` 插值；翻译键需同时在 `en.ts` 与 `zh.ts` 添加。

---

## 6. 状态管理方式

本项目**没有引入 Redux/Zustand 等集中式状态库**，而是按作用域分层，统一采用 `useSyncExternalStore` 的“外部 store”模式，并把需要跨热重载存活的单例挂在 `globalThis`：

| 状态                                                                   | 存储位置                                                | 消费者                             | 机制                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------- | -------------------------------------------- |
| 当前会话、消息、流式、工具、模型、思考级别、分支、通知、扩展 UI 对话框 | `useAgentSession` 内部 `useState`/`useReducer`/`useRef` | ChatWindow 子树                    | React 局部状态                               |
| 会话运行时（running/phase/tools/stats/contextUsage）                   | `agent-runtime-store`（globalThis）                     | AppShell、扩展面板、InspectorPanel | `useSyncExternalStore`                       |
| 已加载会话注册表 + 运行集合                                            | `session-registry`（globalThis）                        | 侧边栏、running/events SSE         | 直接读写 + 订阅                              |
| 会话路径→文件路径缓存                                                  | `session-reader` 路径缓存（globalThis，60s TTL）        | 所有读会话的 API                   | 直接读写                                     |
| UI 扩展贡献                                                            | `extensions/registry`（globalThis）                     | 命令面板、右栏、会话列表           | `useSyncExternalStore`                       |
| 主题 / 语言                                                            | `localStorage` + `<html>` 属性                          | 全应用                             | `useTheme`/`useI18n`（useSyncExternalStore） |
| 文件标签、右栏开关、侧栏开关等 UI 偏好                                 | `usePersistentState`（localStorage）                    | AppShell                           | React 状态 + 持久化                          |
| 重启恢复所需的“哪些会话开着 + toolsDisabled”                           | `pi-web-state.json` sidecar                             | `rpc-manager` 启动预热             | 同步文件读写                                 |

**要点**：`ChatWindow` 以 `session.id`（或新会话的 `new:<cwd>`）作为 React `key`，只有当会话身份真正变化时才重挂载；轻量刷新（如插件重载 `pluginsRefreshKey`、模型改动 `modelsRefreshKey`）走 `useEffect` 就地重取，避免重建 1600 行的 `useAgentSession`。

---

## 7. 数据流向

### 7.1 启动 / 会话列表

```
浏览器 GET /api/sessions
  → lib/session-reader.listAllSessions()
      → SessionManager.listAll()（磁盘扫描）+ resolveProject（cwd→项目根/worktree）
  → 返回 { sessions, runningSessionIds }
  → SessionSidebar 渲染会话树（含 ExtensionRegistry 的 workspaceLabels 内联元数据）
```

### 7.2 发送一条消息（交互主链路）

```
ChatInput.handleSend
  → useAgentSession.handleSend
      ├─ 乐观追加用户气泡（ref 记 key，用于去重）
      ├─ 新会话：ensureNewSession() POST /api/agent/new → 得到真实 sessionId
      ├─ ensureEventsConnected() → new EventSource(/api/agent/[id]/events)
      └─ sendAgentCommand([id], { type:"prompt", message, images? })
            │  (fetch POST /api/agent/[id])
            ▼
        GET/POST /api/agent/[id]
            → getRpcSession(id)；若未存活 → resolveSessionPath → startRpcSession
            → AgentSessionWrapper.send({type:"prompt"})
                → inner.prompt(message, { source:"rpc" })
                → SDK 订阅事件 emit 回 wrapper
      ◀── SSE /api/agent/[id]/events ── wrapper.onEvent → encode(event) ──▶
  ◀─ EventSource.onmessage → handleAgentEvent → setMessages/dispatch(stream) → MessageView 渲染
```

### 7.3 实时事件流（SSE）

```
服务端 /api/agent/[id]/events
  → startRpcSession(id)（必要时）
  → ReadableStream：先发 {type:"connected"}，随后 session.onEvent(e => encode(e))
  → 30s 心跳（`:\n\n`）防代理超时
  → req.signal abort → 清理 unsubscribe + close
客户端：EventSource 解析 JSON；连接超时/断开时按 runId 守卫 + 自动重连；
        同时对账机制（GET /api/agent/[id]）兜底丢失事件。
```

### 7.4 会话分支（两种）

- **Fork（新建独立 .jsonl 文件）**：`send("fork", {entryId})` 在 wrapper 内 `SessionManager.create/open` 生成新文件并返回 `newSessionId`，随后 **`this.destroy()`**；UI 用 `onSessionForked` 更新选中并改写 URL `?session=`。
- **会话内分支（navigate_tree）**：同一文件内切换 leaf，触发 `GET /api/sessions/[id]/context?leafId=` 重建消息列表，不新建文件。

### 7.5 重启恢复

```
进程首次访问 getRegistry()
  → process exit/SIGINT/SIGTERM 注册清理
  → maybeRestore() → restoreActiveSessions()
      → 读 pi-web-state.json → 预热最近 5 个会话（startRpcSession）
      → 对 toolsDisabled 的会话 setForceEmptySystemPrompt(true)
```

---

## 8. 关键交互流程小结（便于快速建立认知）

1. **读 vs 写分离**：看历史只读 `.jsonl`（`session-reader`）；发消息才在进程内建 `AgentSession`（`rpc-manager`）。
2. **单会话单 wrapper**：`globalThis.__piSessions` 以 id 索引；10 分钟空闲销毁；fork 即时销毁以防状态污染。
3. **双通道保活**：SSE 主通道 + `GET /api/agent/[id]` 周期对账，确保断网/后台标签不出现“永久流式”假象。
4. **状态分层**：ChatWindow 局部状态 + 全局 `agent-runtime-store`/`session-registry`/`extension-registry`，全部基于 `useSyncExternalStore` 且 `globalThis` 跨热重载存活。
5. **扩展体系两端**：服务端 SDK 插件（扩展智能体能力，`/api/plugins`）与浏览器侧 UI 扩展（扩展界面，`/api/extensions`）明确区分。
6. **可观测性**：顶栏聚合展示 token 用量、成本、上下文占用百分比、子代理状态、按 provider 的配额 pill，以及 compaction 进度。

---

## 9. 常见陷阱（开发须知）

- 切勿在客户端代码导入 `@earendil-works/pi-coding-agent` / `pi-ai`（已在 `serverExternalPackages`，仅限 `app/api/**` 与 `lib/rpc-manager.ts`）。
- Fork 后必须 `destroy()` wrapper（否则父会话被改写）。
- 不要在 dev 期间跑 `next build`（污染 `.next/`，破坏 `npm run dev`）。
- 新增 i18n 键要同时写入 `en.ts` 与 `zh.ts`；`lib/` 内模块互引用相对路径，app/components/hooks 用 `@/*` 别名。
- 单测：`lib/*.test.mjs` 直接 `import` 源码（Node 22+ 原生去类型）；改 `rpc-manager` 时优先把逻辑抽到可在裸 `node:test` 下运行的纯模块（如 `session-registry.ts`）。

---

_本分析基于仓库当前工作区快照（含未提交改动：token-usage、extension-theme、useConfiguredProviders 等新增文件），可作为建立项目整体认知的入口文档。_
