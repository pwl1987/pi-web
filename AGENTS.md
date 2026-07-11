# Pi Agent Web — 开发指南

## 项目概述

Pi Agent Web 是 [pi coding agent](https://github.com/badlogic/pi-mono) 的浏览器端 Web UI（`@agegr/pi-web`），一个 **Next.js 16（App Router）全栈应用**。它在命令行智能体之上套了一层浏览器界面，支持会话浏览、实时聊天、模型配置、技能管理、文件预览与 Git worktree 切换。

---

## 快速开始与常用命令

```bash
npm run dev          # 启动开发服务器，端口 30141
npm run lint         # ESLint 检查
npm test             # 运行全部测试：node:test（lib/*.test.mjs）+ vitest（组件/hooks 测试）
npm run test:watch   # vitest 监听模式
npm run test:ui      # vitest 可视化界面
```

**类型检查**：`node_modules/.bin/tsc --noEmit`

**环境变量**：`PI_CODING_AGENT_DIR` 覆盖 pi 数据目录（默认 `~/.pi/agent`）；`PORT`/`--port` 覆盖端口。

**运行单个测试**：
- node 测试：`node --test --experimental-strip-types lib/<name>.test.mjs`
- vitest 测试：`npx vitest run <file-path>`

**严禁在开发期间运行 `next build`**——会污染 `.next/` 目录，破坏 `npm run dev`。构建仅用于发版（`npm run release`）。

---

## 架构总览

三层结构：

```
┌─────────────────────────────────────────────────────────┐
│  浏览器 (React 19 客户端)                                  │
│  AppShell → SessionSidebar + ChatWindow + FileViewer     │
│  hooks/useAgentSession 负责消息流、SSE、分支等              │
└───────────────┬──────────────────┬──────────────────────┘
                │  REST (JSON)      │  SSE (text/event-stream)
                ▼                   ▼
┌─────────────────────────────────────────────────────────┐
│  Next.js Server (app/api/** 路由处理器)                    │
│  - 会话浏览：只读 .jsonl（SessionManager）                  │
│  - 发送消息：lib/rpc-manager 在进程内创建 AgentSession       │
└───────────────┬─────────────────────────────────────────┘
                │  import (serverExternalPackages)
                ▼
┌─────────────────────────────────────────────────────────┐
│  @earendil-works/pi-coding-agent / pi-ai (智能体内核)      │
│  AgentSession · SessionManager · 模型注册表 · 工具/扩展系统  │
│  持久化：~/.pi/agent/sessions/*.jsonl                     │
└─────────────────────────────────────────────────────────┘
```

**核心设计原则**：

- **读 / 写分离**：浏览历史只读 `.jsonl`（`lib/session-reader.ts`，不创建 `AgentSession`）；发消息才在进程内建 `AgentSession`（`lib/rpc-manager.ts` 的 `startRpcSession()`）。
- **`globalThis` 跨热重载存活**：Session 注册表、运行态、路径缓存、扩展注册表全挂在 `globalThis` 上，Next.js dev 热更新不丢失内存状态。
- **SDK 不进客户端 bundle**：`@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-ai` 在 `next.config.ts` 列为 `serverExternalPackages`，**仅限** `app/api/**` 和 `lib/rpc-manager.ts` 导入。

---

## 技术栈

| 维度 | 选型 |
|------|------|
| 框架 | Next.js 16 (App Router)、React 19 |
| 语言 | TypeScript 5 (`strict`，路径别名 `@/*` → 仓库根) |
| 样式 | Tailwind CSS 4 + CSS 变量主题（`--bg`、`--text`、`--accent` 等，支持明暗） |
| 流式通信 | 原生 SSE（浏览器侧 `EventSource`，服务端 `ReadableStream`） |
| Markdown | `react-markdown` + `remark-gfm/math` + `rehype-katex/raw/sanitize` + `react-syntax-highlighter` |
| 智能体内核 | `@earendil-works/pi-coding-agent` ^0.80.x、`@earendil-works/pi-ai` ^0.80.x |
| 测试 | 两类：`node --test --experimental-strip-types lib/*.test.mjs`（纯逻辑）+ `vitest`（组件/hooks，默认 `node` 环境，需 jsdom 的文件加 `// @vitest-environment jsdom` 文件级 pragma） |
| 扩展系统 | 浏览器侧可信 ES module（动态 `import` + `webpackIgnore`），React 实例经 `window.React`/`window.ReactDOM` 共享 |
| 国际化 | 自研零依赖 i18n（`useSyncExternalStore` + localStorage） |
| CLI | `bin/pi-web.js`（`bin: pi-web`，支持 `--port`/`-H` 及 `install`/`uninstall` 注册 systemd/launchd 自启） |

---

## 目录结构与核心模块

```
pi-web/
├── app/                          # Next.js App Router 入口与全部 API
│   ├── layout.tsx                # 根布局：字体、KaTeX、preload 防 FOUC 脚本
│   ├── page.tsx                  # 唯一页面 → <Suspense> 包裹 <AppShell/>
│   ├── globals.css               # 全局样式与 CSS 变量
│   └── api/                      # 按业务域分组的服务端路由
│       ├── agent/                # 智能体：new / [id](state+cmd) / [id]/events(SSE) / running/events
│       ├── sessions/             # 会话浏览：list / [id] / [id]/context / [id]/export
│       ├── auth/                 # API Key 与 OAuth/设备码登录/登出
│       ├── models/ models-config/  # 模型列表与 models.json 读写/测试
│       ├── cwd/ default-cwd/ worktrees/  # 工作目录校验/创建、git worktree
│       ├── files/ file-index/    # 只读文件预览、@ 自动补全索引
│       ├── plugins/ skills/      # 能力包与技能管理
│       ├── extensions/           # 浏览器侧 UI 扩展的 manifest 与资源
│       └── token-usage/          # 配额用量
├── components/                   # UI 组件（全部客户端），约 40 个 .tsx
│   ├── AppShell.tsx              # ★ 顶层布局 + URL 状态 + 标签/面板编排（~1450 行）
│   ├── ChatWindow.tsx            # ★ 聊天组合 + useAgentSession 容器
│   ├── ChatInput.tsx             # 输入框 + 模型/思考/工具/压缩控件
│   ├── MessageView.tsx           # 单条消息渲染（含 thinking、toolCall、toolResult）
│   ├── SessionSidebar.tsx        # ★ 会话树 + FileExplorer
│   ├── BranchNavigator.tsx       # 会话内分支切换
│   ├── MarkdownBody.tsx          # Markdown 渲染
│   ├── FileExplorer.tsx          # 文件树
│   ├── FileViewer.tsx            # 文件预览（源码/图片/音频/PDF/DOCX）
│   └── *Config.tsx               # Models/Skills/Plugins 等模态配置面板
├── hooks/                        # 业务 hooks，约 23 个
│   ├── useAgentSession.ts        # ★ 核心：消息流、SSE、分支、fork、滚动、对账（~1660 行）
│   ├── useExtensions.ts          # UI 扩展加载
│   ├── useI18n.ts / useTheme.ts  # 国际化/主题（useSyncExternalStore）
│   └── useAudio.ts / useDragDrop.ts / useIsMobile.ts ...
├── lib/                          # 服务端/共享逻辑，约 50 个 .ts + 同目录测试
│   ├── rpc-manager.ts            # ★ AgentSessionWrapper 生命周期 + startRpcSession
│   ├── session-reader.ts         # ★ 只读会话读取 + 路径缓存 + buildSessionContext
│   ├── session-state-store.ts    # 重启恢复 sidecar（pi-web-state.json）
│   ├── agent-runtime-store.ts    # 运行时状态全局 store（useSyncExternalStore）
│   ├── agent-client.ts           # 客户端 fetch 封装（POST /api/agent/[id]）
│   ├── extensions/               # 浏览器侧扩展系统（types/registry/discovery）
│   ├── i18n/                     # 零依赖 i18n（en.ts + zh.ts）
│   ├── normalize.ts              # ToolCall 字段归一化（{id,name,arguments}→{toolCallId,toolName,input}）
│   ├── tool-presets.ts           # 工具预置与 per-tool 粒度控制
│   ├── worktree.ts               # 项目/worktree 解析与 git worktree 操作
│   └── *.test.mjs                # node:test 测试，与模块同目录
├── extensions/                   # 内置示例 UI 扩展（git-status）
├── bin/pi-web.js                 # CLI 入口与系统服务注册
└── docs/                         # 发布与架构文档
```

### 五大核心模块

#### 1. `lib/rpc-manager.ts` — 智能体会话中枢
- `AgentSessionWrapper` 包裹 SDK 的 `AgentSession`，暴露统一 `send(command)` 接口（`prompt`/`abort`/`get_state`/`fork`/`navigate_tree`/`compact`/`set_tools` 等）。
- 空闲超时 **10 分钟**自动 `destroy`。并发 `startRpcSession()` 通过 `globalThis.__piStartLocks` 共享单个启动 Promise。
- **Fork 必须立即 destroy wrapper**：SDK 的 `fork()` 会原地改写 inner 的 `sessionId`，不销毁会导致后续 fork 链错乱。

#### 2. `lib/session-reader.ts` — 只读会话读取
- `listAllSessions()` 遍历 `SessionManager.listAll()`，补充 `projectRoot`/`worktreeBranch`，填充路径缓存（`globalThis.__piSessionPathCache`，60s TTL）。
- `buildSessionContext(entries, leafId?)` 从分支叶子回溯到根构建 UI 消息列表，保留 compact/branch_summary 为内联摘要以完整展示被压缩的历史。

#### 3. `hooks/useAgentSession.ts` — 前端会话状态机
- 单一巨型 hook：SSE 连接与重连（5s 超时 + 断线自动重连）、事件解析（`agent_start`/`message_update`/`tool_execution_*`/`compaction_*` 等）、发送消息/abort/fork/分支导航/模型切换/压缩/slash 命令。
- **对账机制**：每 15s 或页面可见/网络恢复时，`GET /api/agent/[id]` 与 SSE 对齐，防止丢事件导致永久"流式"假象。使用单调 runId 守卫防止过期响应复活旧的流式气泡。

#### 4. `lib/agent-runtime-store.ts` — 全局运行时 store
- 采用 `useSyncExternalStore` + `globalThis` 单例，让 ChatWindow 之外的组件（顶部栏、扩展面板）观察当前会话运行状态（running/phase/tools/stats/contextUsage）。

#### 5. 扩展系统 `lib/extensions/`
- **浏览器侧 UI 扩展**（≠ SDK 插件）：可信 ES module，三类贡献：`actions`（Cmd+K 命令面板）、`workspacePanels`（右侧标签）、`workspaceLabels`（会话列表内联元数据）。
- `discovery.ts` 服务端扫描 `extensions/`（内置）+ `~/.pi-web/extensions/`（本地）；`hooks/useExtensions.ts` 在挂载时 `fetch manifest → import(/* webpackIgnore */ url) → registry.register()`。
- AppShell 暴露 `window.React`/`window.ReactDOM` 使扩展共享同一 React 实例。`register()` 校验 id（`extensionId:localId`，正则 `^[a-z][a-z0-9.-]*$`）。

---

## 数据流

### 发送消息（主链路）
```
ChatInput.handleSend
  → useAgentSession.handleSend
    ├─ 乐观追加用户气泡（ref 记 key，用于去重）
    ├─ 新会话：POST /api/agent/new → 得到真实 sessionId
    ├─ ensureEventsConnected() → new EventSource(/api/agent/[id]/events)
    └─ sendAgentCommand(id, {type:"prompt", message, images?})
          │  (fetch POST /api/agent/[id])
          ▼
      POST /api/agent/[id]
        → startRpcSession → AgentSessionWrapper.send({type:"prompt"})
          → inner.prompt(message) → SDK 事件 emit 回 wrapper
    ◀── SSE /api/agent/[id]/events ── session.onEvent → encode(event) ──▶
◀─ EventSource.onmessage → handleAgentEvent → setMessages → MessageView 渲染
```

### SSE 实时事件流
- 服务端：`ReadableStream`，先发 `{type:"connected"}`，随后 `session.onEvent(e => encode(e))`，30s 心跳（`:\n\n`）防代理超时，`req.signal abort` 时清理。
- 客户端：`EventSource` 解析 JSON，按 runId 守卫 + 自动重连，对账机制兜底。

### 会话分支（两种，不可混淆）
- **Fork**（用户消息上的 Fork 按钮）：创建**新的独立 .jsonl 文件**。侧栏树中通过 `parentSession` header 字段显示为子会话。完成后立即 `destroy()` 原 wrapper。
- **会话内分支**（Continue 按钮 / BranchNavigator）：同一文件内调用 `navigate_tree`。多个条目共享 `parentId`。切换时调用 `/api/sessions/[id]/context?leafId=`。

### 重启恢复
```
进程首次访问 getRegistry()
  → maybeRestore() → restoreActiveSessions()
    → 读 pi-web-state.json（最近 20 个活跃会话 + toolsDisabled）
    → 预热最近 5 个会话（startRpcSession）
    → 对 toolsDisabled 的会话 setForceEmptySystemPrompt(true)
```
文件写入 `~/.pi/agent/pi-web-state.json`。Fire-and-forget，失败不阻塞启动。

---

## 状态管理

本项目**不引入 Redux/Zustand**，按作用域分层，统一采用 `useSyncExternalStore` 的"外部 store"模式，需跨热重载存活的单例挂 `globalThis`：

| 状态 | 存储位置 | 消费者 | 机制 |
|------|----------|--------|------|
| 会话消息、流式、工具、模型、分支、通知 | `useAgentSession` 内部 state/ref | ChatWindow 子树 | React 局部状态 |
| 运行时状态（running/phase/tools/stats） | `agent-runtime-store`（globalThis） | AppShell、扩展面板 | `useSyncExternalStore` |
| 会话注册表 + 运行集合 | session-registry（globalThis） | 侧边栏、running/events SSE | 直接读写 + 订阅 |
| 会话路径缓存 | session-reader 缓存（globalThis, 60s TTL） | 所有读会话 API | 直接读写 |
| UI 扩展贡献 | `extensions/registry`（globalThis） | 命令面板、右侧栏 | `useSyncExternalStore` |
| 主题/语言 | `localStorage` + `<html>` 属性 | 全局 | `useTheme`/`useI18n` |
| UI 偏好（文件标签、面板开关等） | `usePersistentState`（localStorage） | AppShell | React 状态 + 持久化 |
| 重启恢复数据 | `pi-web-state.json` sidecar | rpc-manager 启动预热 | 同步文件读写 |

`ChatWindow` 以 `session.id` 作为 React `key`，仅会话身份变化时才重挂载；轻量刷新走 `useEffect` 就地重取。

---

## 关键设计决策与陷阱

### 导入规则
- `@/*` → 仓库根（配置在 `tsconfig.json` `paths`）。**app/components/hooks 用 `@/*`，`lib/` 内模块互引用相对路径**——匹配周围文件的风格。
- **禁止在客户端代码导入 `@earendil-works/pi-coding-agent` / `pi-ai`**——它们在 `serverExternalPackages` 中，仅限 `app/api/**` 和 `lib/rpc-manager.ts`。

### AgentSession 生命周期
- `globalThis.__piSessions` 以 id 索引 `AgentSessionWrapper`。`globalThis` 跨热重载存活，普通 module-level Map 不行。
- 空闲超时 10 分钟；并发 `startRpcSession()` 通过 `globalThis.__piStartLocks` 合并。

### Fork 必须立即销毁 wrapper
`AgentSession.fork()` **原地改写** wrapper 内部状态——fork 后 `inner.sessionId` 变成新会话的 id。若 wrapper 仍在注册表中以旧 id 存活，后续请求拿到已被 fork 的状态，再次 fork 会产生错误的 `parentSession` 链。
**正确做法**：`send("fork")` 捕获 `newSessionId` 后立即 `this.destroy()`。下次请求原会话时重新从原始文件加载干净的 AgentSession。

### ToolCall 字段归一化
pi 存储的 toolCall 块为 `{type:"toolCall", id, name, arguments}`，但 `ToolCallContent` 使用 `{toolCallId, toolName, input}`。`lib/normalize.ts` 的 `normalizeToolCalls()` 在文件加载（`session-reader.ts`）和流式处理（`ChatWindow.handleAgentEvent()`）两条路径中均调用。

### 新建会话的工具预设
创建会话时通过 `POST /api/agent/new` → `toolNames[]` 传工具名列表。已有会话在挂载时通过 `get_tools` → `getPresetFromTools()` 推断活跃预设。工具完全禁用（`toolNames=[]`）时，`rpc-manager.ts` 传入空工具白名单，并在启动/重载/资源发现后强制 `agent.state.systemPrompt = ""`。

### SSE 重连与对账
- `ChatWindow` 挂载时调用 `GET /api/agent/[id]`。若 `state.isStreaming === true`，自动重连 SSE。
- `useAgentSession` 以 SSE 为主通道，运行期间每 15s 调用 `GET /api/agent/[id]` 对账，并在 `visibilitychange`/`online` 时触发。修复因后台标签或半断连接丢失 `agent_end` 的问题。
- **runId 守卫**：prompt 运行使用单调递增 runId，旧运行的延迟 SSE 或对账响应必须忽略，防止复活已结束的流式气泡。

### Compaction 事件兼容
新版 pi 发送 `compaction_start`/`compaction_end`，旧版发送 `auto_compaction_start`/`auto_compaction_end`。`handleAgentEvent` 同时接受两套事件以保持 `isCompacting` 同步。手动压缩是阻塞 POST——按钮保持禁用直到响应返回。

### 会话文件可完全重写
`parentSession` header 字段**仅用于显示元数据**——对聊天内容无影响。可以安全地用 `writeFileSync` 重写整个文件（pi 自身在迁移时也会这样做）。删除时用于级联重定父。

### Worktree 与项目分组
- `lib/worktree.ts` 将关联 worktree 顶层解析回主仓库 `projectRoot`；`listAllSessions()` 将此附加到每个 `SessionInfo`，使同一仓库的所有 worktree 在侧栏中分组。
- 新建 worktree 放在 `<repoRoot>-worktrees/<sanitized-branch>`，已有分支复用，否则 `git worktree add -b`。
- 删除脏 worktree 返回 `409 { dirty: true }`，UI 可询问后加 `force` 重试。
- 指向已删除 worktree 的会话会被推断回主项目，不会变成孤立项目行。

### 文件访问白名单
- `/api/files` 非通用文件浏览器。允许的根路径来自：会话 cwd、解析后的项目根、`~/pi-cwd-*`、通过 `allowFileRoot()` 显式添加的根。
- 文件预览大小限制和扩展名→MIME 映射在 `lib/file-types.ts` 中定义。

### Auth 与模型配置
- `ModelsConfig` 将 `~/.pi/agent/models.json` 中的模型与 pi 的 `AuthStorage`/`ModelRegistry` 的提供商认证状态合并。
- OAuth/设备码流程由 `GET /api/auth/login/[provider]` 流式推送；手动码通过 `POST` 返回，短期 token 存储在 `globalThis.__piLoginCallbacks`。
- API Key 状态端点**绝对不能返回原始 key**。

### 国际化（i18n）
- `lib/i18n/index.ts`：核心——`getSnapshot` 读取 `<html data-lang>`（由 layout preload 脚本在首帧前设置），`getServerSnapshot` 始终返回 `"en"`（SSR 安全，避免 hydration 不匹配）。
- `lib/i18n/en.ts` + `zh.ts`：扁平点号键（`"namespace.subkey"`）+ `{var}` 插值。**新增翻译键必须同时写入两个文件。**
- 语言持久化在 localStorage (`"pi-language"`)，切换按钮在 AppShell 顶部栏。
- `app/layout.tsx` 的 preload `<script>` 在首帧前读取 `pi-language` 并设置 `<html>` 的 `data-lang` + `lang` 属性——消除 FOUC。

### 完成提示音
- `hooks/useAudio.ts` 将开关存储在 localStorage（`pi-sound-enabled`），复用单个 `AudioContext`。
- 浏览器自动播放策略要求从用户手势解锁：`ChatInput` 从交互控件调用解锁 hook，`ChatWindow` 在 `onAgentEnd` 中播放提示音。

---

## Pi 会话文件格式

存储位置：`~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` 在 `SessionContext` 中是 `messages[]` 的平行数组——将每条显示消息映射回 `.jsonl` 条目 id，用于 fork 和 navigate_tree 调用。

---

## CSS 变量（`app/globals.css`）

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```
