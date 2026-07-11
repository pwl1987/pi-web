# 架构解耦方案 — Pi SDK 防腐层与能力可插拔框架

> 范围：**全量重构 + 纯结构重构（行为不变）**。本次重构只移动/重定向导入关系与分层边界，**未改动任何运行时行为**：所有 SDK 调用路径、参数、返回处理与重构前逐字节一致，仅类型与依赖来源被重新编排。

---

## 1. 目标与约束

| #   | 目标                                                                    | 满足方式                                                                      |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | 任何底层组件（插件/扩展/子代理/技能）的增删或替换**不影响**现有业务运行 | 统一能力框架（registry + provider + discovery），业务侧只认 `Capability` 抽象 |
| 2   | 对 Pi 及其 SDK 抽象，版本升级/底层替换对业务层**完全透明**              | Pi SDK 防腐层（ACL）：业务代码只通过 `getPiAdapter()` 触达 SDK                |
| 3   | 核心业务逻辑与底层实现**完全隔离**                                      | `lib/services/*` 业务门面 + `app/api/**` 退化为薄 HTTP 适配器                 |

**不可破坏的约束**（来自项目约定与 Next.js 构建）：

- `@earendil-works/pi-coding-agent` / `pi-ai` 在 `next.config.ts` 的 `serverExternalPackages` 中，**仅限** `app/api/**` 与 `lib/rpc-manager.ts` 运行期导入。
- 开发期**严禁** `next build`（污染 `.next/`）。
- 跨热重载存活的单例挂 `globalThis`（ACL、registry、session 注册表均如此）。

---

## 2. 三大支柱

### 支柱 A — Pi SDK 防腐层（Anti-Corruption Layer）

**唯一运行期导入站点：`lib/pi/sdk-adapter.ts`**。整个代码库只有这一个文件执行 `import * as codingAgent/ai/aiCompat from "@earendil-works/pi-*"`。其余 28 个原耦合文件全部改为经 `getPiAdapter()` 取值，或仅保留 `import type`（编译期擦除，不进 bundle）。

```
业务/路由代码
   │  仅通过门面或 getPiAdapter() 访问
   ▼
getPiAdapter()  ── 服务定位器（globalThis 单例，跨热重载存活）
   │
   ▼
SdkAdapter implements PiSdkPort   ← 唯一 runtime import 站点
   │  委托 codingAgent / ai / aiCompat 三个命名空间
   ▼
@earendil-works/pi-coding-agent / pi-ai
```

#### 关键文件

- **`lib/pi/ports.ts`** — 行为契约（`SessionManagerStaticPort`、`SessionManagerInstancePort`、`PiSdkPort`）。只含 `import type`，并对外再导出 SDK 类型词汇（`SdkSessionManager`、`SdkSettingsManager`、`SlashCommandInfo`、`PiSessionEntry`、`PiSessionInfo`、`ThemeColor`、`AgentSessionEvent`、`AssistantMessage`）。业务模块**无需任何直接（哪怕是 type-only）的 SDK 导入**即可拿到 SDK 类型。
- **`lib/pi/sdk-adapter.ts`** — 默认适配器，实现 `PiSdkPort`。高层操作（`open`/`create`/`listAll`、`createAgentSessionServices`/`FromServices`、`buildSessionContext`）走类型安全 seam；长尾一次性调用走 `codingAgent` / `ai` / `aiCompat` 原始命名空间网关。所有委托用 `as unknown as PiSdkPort[...]` 显式投射，保证端口契约稳定不被 SDK 内部签名漂移破坏。
- **`lib/pi/index.ts`** — 服务定位器 + 依赖注入接缝：`getPiAdapter()`（惰性构造 `SdkAdapter`）、`registerPiAdapter(adapter)`（测试 mock 或未来非 Pi 后端可注入，**调用方零改动**）。同时 barrel 再导出所有端口与 SDK 词汇类型。

#### 替换成本

升级 Pi SDK 版本或整体换底层：只改 `lib/pi/sdk-adapter.ts` 一处（必要时调整 `ports.ts` 契约），业务层、路由层、能力框架**全部无需变动**。

---

### 支柱 B — 能力可插拔框架（Capability Framework）

将原本分散在四处的「插件 / 技能 / 子代理 / 浏览器扩展」发现-注册-加载机制，统一为一套词汇与生命周期。

```
Capability（统一抽象：kind/source/enabled/meta）
   ▲ 注册/查询
CapabilityRegistry（globalThis 单例，subscribe/getSnapshot，
                    useSyncExternalStore 兼容，UI 可观察）
   ▲ list/install/uninstall/setEnabled
CapabilityProvider（每种 kind 一个，拥有其生命周期）
   ▲ discover
CapabilityDiscovery（给定 context 枚举某 kind 的能力）
```

#### 关键文件（`lib/capabilities/`）

- **`types.ts`** — `CapabilityKind`（`"plugin"|"skill"|"subagent"|"extension"`）、`Capability`、`CapabilityContext`、`CapabilityDiscovery`、`CapabilityProvider`（`list` 必选；`install`/`uninstall`/`setEnabled` 可选）。
- **`registry.ts`** — `CapabilityRegistry` 类（Map + 监听器 + 版本号），`getCapabilityRegistry()` 返回 `globalThis` 单例；带 node:test 单测（4/4 通过）。
- **`providers.ts`** — 内置四类 provider：`ExtensionProvider` 完全复用 `lib/extensions/discovery`；`SkillProvider`/`PluginProvider`/`SubagentProvider` 经 `getPiAdapter()` 委托 SDK，无需业务代码直接导入 SDK。
- **`discovery.ts`** — `registerDiscovery`/`discoverCapabilities`，`ExtensionDiscovery` 适配器复用 `listExtensionsWithState`。
- **`index.ts`** — barrel 再导出。

#### 替换/扩展成本

新增一类能力 = 实现一个 `CapabilityProvider` +（可选）`CapabilityDiscovery` 并 `registerProvider()`，**其余代码零改动**。移除某能力同理，不影响既有业务。

---

### 支柱 C — API / 业务层隔离

`app/api/**` 退化为「薄 HTTP 适配器」：只做请求解析、CSRF 校验、调用业务门面、序列化响应。所有 Pi 耦合被上提到：

- **`lib/services/session-service.ts`** — 会话业务门面（`ensureSession` / `getSession` / `readSessionCwd` / `resolveSessionCwd`），返回 `AgentSessionWrapper`，仅通过 ACL 与 `rpc-manager`/`session-reader` 触达 Pi。
- **`lib/rpc-manager.ts`**、**`lib/session-reader.ts`** — 既有的会话中枢与只读读取层，已迁到 ACL。
- **`lib/extension-theme.ts`**、**`lib/plugin-auto-install.ts`**、**`lib/plugin-package-manager.ts`** — 经 `getPiAdapter().codingAgent` 取得 `Theme`/`DefaultPackageManager`/`SettingsManager`。

> 路由层变更示例（`app/api/agent/[id]/route.ts`、`app/api/agent/new/route.ts`）：删除直接 `SessionManager` 导入，改为 `ensureSession`/`getSession`/`readSessionCwd`。

---

## 3. 迁移地图（28 个源文件 → ACL）

运行期值导入全部改为经 `getPiAdapter()` 取值；类型导入统一改走 `@/lib/pi`（再导出 SDK 词汇）：

| 文件                                       | 旧依赖（直接 SDK）                                       | 新来源                                                      |
| ------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------- |
| `lib/pi/sdk-adapter.ts`                    | —                                                        | **唯一运行时导入站点**                                      |
| `lib/pi/ports.ts`                          | `import type`                                            | SDK（type-only，再导出词汇）                                |
| `lib/pi/index.ts`                          | —                                                        | 服务定位器                                                  |
| `lib/services/session-service.ts`          | 新建                                                     | `getPiAdapter()` + `rpc-manager`                            |
| `lib/rpc-manager.ts`                       | `SessionManager`/`createAgentSession*`                   | `getPiAdapter().sessionManager` / `createAgentSession*`     |
| `lib/session-reader.ts`                    | `SessionManager`/`buildSessionContext`/`getAgentDir`     | `getPiAdapter()`                                            |
| `lib/extension-theme.ts`                   | `Theme`/`getAgentDir`                                    | `getPiAdapter().codingAgent`                                |
| `lib/plugin-auto-install.ts`               | `DefaultPackageManager`/`SettingsManager`                | `getPiAdapter().codingAgent`                                |
| `lib/plugin-package-manager.ts`            | `DefaultPackageManager`                                  | `getPiAdapter().codingAgent`                                |
| `app/api/agent/[id]/route.ts`              | `SessionManager`                                         | `session-service` 门面                                      |
| `app/api/agent/new/route.ts`               | `SessionManager`                                         | `session-service` 门面                                      |
| `app/api/agent/[id]/events/route.ts`       | `SessionManager`                                         | `getPiAdapter()`                                            |
| `app/api/agent/enhance/route.ts`           | `completeSimple`                                         | `getPiAdapter().aiCompat`                                   |
| `app/api/models/route.ts`                  | `SettingsManager` 值                                     | `getPiAdapter().codingAgent`（`import type` 保留）          |
| `app/api/models-config/route.ts`           | `ModelRegistry`                                          | `getPiAdapter().codingAgent`                                |
| `app/api/models-config/test/route.ts`      | `ModelRegistry`                                          | `getPiAdapter().codingAgent`                                |
| `app/api/settings/route.ts`                | `SettingsManager`/`getAgentDir`                          | `getPiAdapter().codingAgent` + `SdkSettingsManager`（type） |
| `app/api/sessions/[id]/route.ts`           | `SessionManager`                                         | `getPiAdapter().sessionManager`                             |
| `app/api/sessions/[id]/context/route.ts`   | `SessionManager`                                         | `getPiAdapter().sessionManager`                             |
| `app/api/sessions/[id]/export/route.ts`    | `SessionManager`                                         | `getPiAdapter().sessionManager`                             |
| `app/api/plugins/route.ts`                 | `DefaultPackageManager`/`SettingsManager`/`getAgentDir`  | `getPiAdapter().codingAgent` + `SdkSettingsManager`（type） |
| `app/api/skills/route.ts`                  | `DefaultResourceLoader`/`getAgentDir`/`parseFrontmatter` | `getPiAdapter().codingAgent`                                |
| `app/api/auth/login/[provider]/route.ts`   | `AuthStorage`                                            | `getPiAdapter().codingAgent`                                |
| `app/api/auth/logout/[provider]/route.ts`  | `AuthStorage`                                            | `getPiAdapter().codingAgent`                                |
| `app/api/auth/providers/route.ts`          | `AuthStorage`                                            | `getPiAdapter().codingAgent`                                |
| `app/api/auth/api-key/[provider]/route.ts` | `AuthStorage`                                            | `getPiAdapter().codingAgent`                                |
| `app/api/auth/all-providers/route.ts`      | `AuthStorage`                                            | `getPiAdapter().codingAgent`                                |
| `app/api/token-usage/[provider]/route.ts`  | `ModelRegistry`                                          | `getPiAdapter().codingAgent`                                |
| `app/api/agents-md/route.ts`               | `SettingsManager`                                        | `getPiAdapter().codingAgent`                                |
| `app/api/agents-md/optimize/route.ts`      | `completeSimple`                                         | `getPiAdapter().aiCompat`                                   |

> 验证：`grep` 全仓 `@earendil-works/pi-*` 的运行期（非 `import type`）导入，**仅** `lib/pi/sdk-adapter.ts` 一处命中。

---

## 4. 验证与回归

纯度由以下三个零失败闸门保证：

```bash
node_modules/.bin/tsc --noEmit        # 0 errors（纯类型层清理）
node --test lib/capabilities/registry.test.mjs   # 4/4 pass
npm run lint                          # 0 errors（仅有历史既有 warning）
```

- 本次为**纯结构重构**：无任何 `if`/参数/返回处理的行为改动，仅导入重定向与分层。
- 能力框架单测 (`registry.test.mjs`) 证明新注册表无运行期回归。
- `tsc` 全部通过证明类型边界正确闭合，未引入 `any` 泄漏到业务契约。

---

## 5. 后续演进指引

| 场景                     | 操作                                                                         |
| ------------------------ | ---------------------------------------------------------------------------- |
| 升级 Pi SDK 到 v0.81+    | 仅改 `lib/pi/sdk-adapter.ts`（必要时微调 `ports.ts` 契约）                   |
| 接入非 Pi 后端           | `registerPiAdapter(myAdapter)` 注入实现 `PiSdkPort` 的适配器，调用方零改动   |
| 新增一类能力（如 `mcp`） | 实现 `CapabilityProvider` + 可选 `CapabilityDiscovery`，`registerProvider()` |
| 路由层新增接口           | 直接调用 `lib/services/*` 门面，禁止再直接 `import` SDK 值                   |
| 浏览器扩展新机制         | 在 `lib/extensions/*` 实现，经 `CapabilityRegistry` 暴露给命令面板/侧栏      |

**重要**：新增业务/路由代码严禁再次 `import` `@earendil-works/pi-*` 的**值**；一律经 `getPiAdapter()`。类型需要时用 `@/lib/pi` 再导出的 SDK 词汇（`SdkSettingsManager` 等），避免散落的直接 type 导入。
