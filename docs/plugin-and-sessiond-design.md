# 技术方案：扩展系统（Extensions）+ sessiond 拆分架构

> 基于 jmfederico/pi-web 的深度调研，结合本项目（agegr/pi-web，Next.js 16 + React 19 单体）的技术栈设计的可行性分析。
>
> **本文档是决策依据，不是实施计划。** 读完后决定要不要做、先做哪个。

---

## 术语约定（重要）

本项目有两个容易混淆的概念，现明确命名：

| 功能 | 中文名 | 英文 | 扩展什么 | 跑在哪 | 现状 |
|---|---|---|---|---|---|
| pi SDK 包管理 | **插件** | Plugins | Agent 能力（工具/技能/提示词/主题） | Agent 运行时（服务端） | ✅ 已有 |
| 浏览器侧 UI 扩展 | **扩展** | Extensions | pi-web 界面（面板/命令/标签） | 浏览器（客户端） | ❌ 新功能 |

jmfederico/pi-web 把后者也叫 "plugin"，我们在本项目统一改称 **"扩展（Extension）"**，避免与现有的 pi 包管理（插件）混淆。下文所有"扩展"均指浏览器侧 UI 扩展。

---

## 一、扩展 contribution 点系统

### 1.1 jmfederico 的 API 概览（我们借鉴的蓝本）

扩展是**受信任的浏览器侧 ES Module**，通过 `package.json` 声明，默认导出一个 `activate()` 函数返回三种 contribution：

| Contribution | 用途 | 渲染方式 |
|---|---|---|
| **actions** | 命令面板项（带快捷键/enabled/disabledReason） | 无 UI，执行 `run(context)` |
| **workspacePanels** | 工作区侧栏面板（Files/Git 旁） | `render(context)` 返回 UI |
| **workspaceLabels** | 紧凑内联元数据（列表/标题栏/状态栏） | `items()` 返回 text/link/render 数组 |

核心设计点：
- **`apiVersion: 1`** 字面量锁版本，registry 严格校验，破坏性改动留待 v2
- **ID 体系**：`ExtensionId` + `LocalContributionId` → 拼接成全局唯一的 `QualifiedContributionId = "${extension}:${local}"`，正则 `^[a-z][a-z0-9.-]*$`
- **无 deactivate**：禁用仅下次页面加载生效，不做热卸载
- **`host.requestRender()`**：通知宿主重算 badge/visible/items 回调
- **扩展发现四来源**：bundled / `~/.pi-web/extensions/`（symlink 开发流）/ dev / Pi 包内扩展
- **`machineSpecific`**：联邦场景下控制扩展是 gateway 复用还是仅特定机器可见

### 1.2 React 移植的关键决策

jmfederico 用 **Lit**（注入 `html`/`svg` 模板标签），我们必须改成 React。这是**最大的改动点**：

| 方案 | 做法 | 优缺点 |
|---|---|---|
| **A. 注入 createElement** | 宿主注入 `jsx(type, props, ...children)`，扩展用函数式调用而非 JSX | ✅ 强制同一 React 实例；❌ 扩展作者不能写 JSX，体验差 |
| **B. 共享 React（推荐）** | 扩展把 `react`/`react-dom` 设为 external/peerDep，运行时用宿主的 React，直接写 JSX | ✅ 最自然；⚠️ 要求扩展作者懂 externals 配置 |
| **C. 返回组件描述** | `render` 返回 `{ Component, props }` 而非已渲染节点，宿主负责 mount | ✅ 彻底避免跨实例；❌ API 啰嗦 |

**推荐方案 B**：动态 `import()` 的扩展把 React 作为 peerDependency，构建时 external，运行时通过 `window.React` 或模块系统的单例性共享同一份 React 实例。label 的 `render` item 内部可用方案 C 的 `{ Component, props }` 形态。

### 1.3 我们项目需要的改动

| 文件 | 改动 |
|---|---|
| **新增** `lib/extensions/types.ts` | React 版扩展类型声明（`PiWebExtension`、三种 contribution、context 接口） |
| **新增** `lib/extensions/registry.ts` | 扩展注册表（activate → qualify → 存储；getActions/getPanels/getLabels 查询） |
| **新增** `lib/extensions/discovery.ts` | 服务端发现（扫描根 → 产 manifest） |
| **新增** `app/api/extensions/manifest/route.ts` | `GET` 返回扩展清单 JSON |
| **新增** `app/api/extensions/[...path]/route.ts` | 服务扩展静态资产 |
| **新增** `hooks/useExtensions.ts` | 浏览器侧：fetch manifest → import() → register → 暴露 actions/panels/labels |
| **改** `components/AppShell.tsx` | 集成 panel contribution 到侧栏 |
| **改** `components/ChatInput.tsx` | 集成 action contribution 到命令面板 |
| **改** `components/SessionSidebar.tsx` | 集成 label contribution 到会话列表 |
| **新增** 扩展配置 UI | 在现有插件/技能配置旁加一个"扩展"tab |

**工作量估算**：1.5-2 天（核心 API + 发现机制 + 三种 contribution 的集成点 + 一个示例扩展）

### 1.4 建议的实施范围

**第一阶段（MVP）**：
- 只做 **actions** + **workspacePanels**（最常用的两种）
- 单机版（不做 machineSpecific / 联邦）
- 扩展发现只支持 `~/.pi-web/extensions/`（symlink 开发流）+ bundled
- 一个内置示例扩展（类似 jmfederico 的 `info` 扩展）

**第二阶段（按需）**：
- workspaceLabels
- Pi 包内扩展发现
- 扩展 settings UI
- 主题 contribution

---

## 二、sessiond 拆分架构

### 2.1 jmfederico 的进程模型

```
CLI（一次性）          Web 进程（Fastify+Vite）      sessiond 进程（Fastify on UDS）
  install/uninstall  →  纯代理层                   ←→  真正持有 agent session
                       服务静态 UI                      会话生命周期编排
                       文件类请求自处理                 事件转换 + 派生 + 心跳
                       WS 字节桥接                      terminal / auth / activity
```

**通信协议**：Unix domain socket + HTTP/1.1 + JSON（无自研 RPC 框架）。WebSocket 走 `ws+unix` 协议。

### 2.2 关键对比：他们的 PiSessionService vs 我们的 AgentSessionWrapper

这是决策核心——两者根本不是同一抽象层级：

| 维度 | 我们的 `AgentSessionWrapper` | 他们的 `PiSessionService` |
|---|---|---|
| **抽象层级** | 单 session 的传输适配器 | 整个进程的会话编排器 |
| **存活模型** | 10 分钟 idle 自动销毁 | **永不主动销毁**，常驻到显式停止 |
| **事件处理** | 透传 SDK 事件 | 转换 + 派生（activity/status） |
| **状态推送** | 被动（agent 事件来才推） | **主动心跳**（每 2s 重算所有 session 状态） |
| **额外能力** | 无 | 归档/清理/子会话/spawn/认证集中持有 |

**一句话**：我们解决的是"怎么把 SDK session 接到 HTTP/SSE"，是传输适配；他们解决的是"常驻进程如何长期持有编排所有 session"，是会话编排。

### 2.3 拆分的真正收益和代价

**收益**：
- ✅ Web 进程崩溃/重启**完全不影响**正在运行的 agent prompt（核心卖点）
- ✅ Agent 会话不被 Next.js 热重载/空闲超时杀死
- ✅ 未来可扩展为多机联邦（一台浏览器管多台机器的 agent）

**代价**：
- 🔴 **核心障碍 A**：Next.js Route Handler 没有原生 WebSocket。sessiond 用 WS 双向桥接（`bridgeSockets`），我们用 SSE。拆分后链路变成 `浏览器 SSE ← Web WS-client ← sessiond WS`，中间多一跳。
- 🔴 **核心障碍 B**：需要**重写 `rpc-manager.ts` 的核心**（`AgentSessionWrapper` + registry 整体搬走或改成客户端）
- 🟡 需要改 `bin/pi-web.js` 从装 1 个服务扩成装 2 个 + `After/Wants` 依赖
- 🟡 `PiSessionService` 的编排能力（归档/子会话/心跳）拆分本身不带来，逻辑仍要写

### 2.4 我们项目的特殊性

jmfederico 是 **Fastify + Lit + Vite**（前后端分离），天然适合拆进程。我们是 **Next.js 单体**，拆进程意味着：

1. sessiond 用独立 Node 进程（Fastify 或裸 `http`），**不用 Next.js**
2. Next.js 的 API routes 变成纯代理层
3. 需要维护一个 WS 客户端池在 Next.js 进程内

### 2.5 最小可行路径（如果决定做）

jmfederico 的脚手架很轻量（sessiond 入口 92 行、代理层 76 行、客户端 68 行、事件 hub 48 行 ≈ 300 行），可直接参考：

1. **先搬 `AgentSessionWrapper` + registry 到独立进程**（不引入 `PiSessionService` 的高级能力）
2. Web 侧加 `SessionDaemonClient` + 代理路由 + WS→SSE 桥
3. 验证"Web 重启不影响 agent"这一核心收益
4. 再逐步补齐编排能力（归档/心跳/子会话等，这些独立于拆分）

**工作量估算**：
- 最小拆分（搬 wrapper + 代理 + WS→SSE）：2-3 天
- 补齐 PiSessionService 级别的编排能力：额外 3-5 天

---

## 三、决策矩阵

| 方案 | 解决的痛点 | 工作量 | 风险 | 推荐度 |
|---|---|---|---|---|
| **扩展系统 MVP** | 可扩展性（用户/团队定制 pi-web 界面） | 1.5-2 天 | 🟢 低（纯新增，不改现有逻辑） | ⭐⭐⭐⭐ |
| **sessiond 最小拆分** | Web 重启不影响 agent 运行 | 2-3 天 | 🔴 高（重写核心 + WS 障碍） | ⭐⭐ |
| **sessiond 完整版** | 上面的 + 归档/心跳/子会话 | 5-8 天 | 🔴 高 | ⭐ |

### 建议

**先做扩展系统**——它是纯新增功能，不触碰现有核心逻辑，风险低，且能立即带来可扩展性价值。

**sessiond 拆分谨慎对待**——它的核心收益（Web 重启不影响 agent）我们已经用 sidecar 恢复 + systemd 守护覆盖了 80%（崩溃 3 秒自动重启 + 重启后预热会话）。剩下的 20%（正在运行的 prompt 不中断）是否值得 2-3 天的重写和持续的架构复杂度，需要权衡。如果 agent 长时间任务被打断确实是高频痛点，再做；否则当前的 sidecar + systemd 方案已经够用。
