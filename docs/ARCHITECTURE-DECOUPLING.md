# 架构解耦方案 — Pi SDK 防腐层

> 范围：**纯结构重构（行为不变）**。本次重构只重定向导入关系与分层边界，**未改动任何运行时行为**：所有 SDK 调用路径、参数、返回处理与重构前逐字节一致，仅类型与依赖来源被重新编排。

---

## 1. 目标与约束

| #   | 目标                                                       | 满足方式                                                                                                                      |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | 对 Pi 及其 SDK 抽象，版本升级/底层替换对业务层**完全透明** | Pi SDK 防腐层（ACL）：业务代码只通过 `getPiAdapter()` 触达 SDK                                                                |
| 2   | 核心业务逻辑与底层实现**完全隔离**                         | 既有的读/写分离：`lib/session-reader.ts`（只读 `.jsonl`）+ `lib/rpc-manager.ts`（运行态 `AgentSessionWrapper`），二者均经 ACL |

**不可破坏的约束**（来自项目约定与 Next.js 构建）：

- `@earendil-works/pi-coding-agent` / `pi-ai` 在 `next.config.ts` 的 `serverExternalPackages` 中，**仅限** `lib/pi-sdk-adapter.ts` 运行期导入。
- 开发期**严禁** `next build`（污染 `.next/`）。
- 跨热重载存活的单例挂 `globalThis`（ACL、session 注册表均如此）。

---

## 2. 支柱 — Pi SDK 防腐层（Anti-Corruption Layer）

**唯一运行期导入站点：`lib/pi-sdk-adapter.ts`**。整个代码库只有这一个文件执行 `import * as ... from "@earendil-works/pi-*"`。其余文件全部改为经 `getPiAdapter()` 取值，或仅保留 `import type`（编译期擦除，不进 bundle）。

```
业务/路由代码
   │  仅通过 getPiAdapter() 访问
   ▼
getPiAdapter()  ── 服务定位器（globalThis 单例，跨热重载存活）
   │
   ▼
SdkAdapter implements PiSdkPort   ← 唯一 runtime import 站点
   │  每个属性直接赋值 SDK 符号（零 cast）
   ▼
@earendil-works/pi-coding-agent / pi-ai
```

### 关键设计：透传 SDK 真实类型

防腐层**不降级 SDK 类型**。`PiSdkPort` 把 SDK 的类（`SessionManager`、`AuthStorage`、`ModelRegistry`、`SettingsManager`、`DefaultPackageManager`、`DefaultResourceLoader`、`Theme`）作为 `readonly` 类型引用暴露，把独立函数（`createAgentSessionServices`、`completeSimple`、`buildSessionContext` 等）用 `typeof SDK函数` 借用 SDK 自己的函数签名。业务侧拿到的类型与直连 SDK **完全一致**，零强转。

#### 关键文件（`lib/`）

- **`pi-ports.ts`** — 行为契约 `PiSdkPort`。只含 `import type`，并对外再导出 SDK 类型词汇（`SdkSessionManager`、`SdkSettingsManager`、`PiSessionEntry`、`PiSessionInfo`、`ThemeColor`、`AgentSessionEvent`、`AssistantMessage`、`SimpleStreamOptions` 等）。业务模块**无需任何直接（哪怕是 type-only）的 SDK 导入**即可拿到 SDK 类型。
- **`pi-sdk-adapter.ts`** — 默认适配器 `SdkAdapter implements PiSdkPort`。每个属性直接赋值 SDK 符号（`readonly SessionManager = codingAgent.SessionManager`），**无任何 `as unknown as`**——类型天然匹配。
- **`pi.ts`** — 服务定位器 + 依赖注入接缝：`getPiAdapter()`（惰性构造 `SdkAdapter`）、`registerPiAdapter(adapter)`（测试 mock 或未来非 Pi 后端可注入，**调用方零改动**）。同时 barrel 再导出所有端口与 SDK 词汇类型。

#### 裸命名空间已彻底消除

旧设计暴露整个 `codingAgent`/`ai`/`aiCompat` 命名空间作为"逃生口"，导致 22 处路由直接 `.codingAgent.X` 解构——换后端时仍要改每个路由。新设计**不暴露裸命名空间**：每个 SDK 符号必须在 `PiSdkPort` 上具名声明，耦合面显式且有界。

```bash
# 验证：裸命名空间访问为 0
grep -rn "\.codingAgent\|\.aiCompat\.\|getPiAdapter()\.ai\b" --include="*.ts" lib app
# (无命中)
```

#### 替换成本

升级 Pi SDK 版本或整体换底层：只改 `lib/pi-sdk-adapter.ts` 一处（必要时调整 `pi-ports.ts` 契约），业务层、路由层**全部无需变动**。

---

## 3. 读 / 写分离（既有架构，已迁到 ACL）

`app/api/**` 路由是薄 HTTP 适配器，所有 Pi 耦合收敛到两个既有模块：

- **`lib/rpc-manager.ts`** — 运行态智能体会话中枢。`AgentSessionWrapper` 包裹 SDK 的 `AgentSession`，暴露统一 `send(command)` 接口。空闲超时 10 分钟自动 `destroy`。经 ACL 创建 `AgentSession`（`createAgentSessionServices` → `createAgentSessionFromServices`）与会话文件（`SessionManager.open/create`）。
- **`lib/session-reader.ts`** — 只读会话读取。`listAllSessions()` 遍历 `SessionManager.listAll()`，`buildSessionContext()` 从叶子回溯构建 UI 消息列表。经 ACL 读取。

---

## 4. 迁移地图（业务文件 → ACL 具名访问器）

所有业务文件经 `getPiAdapter()` 取值；类型需要时用 `@/lib/pi`（再导出 SDK 词汇），**不再有任何直接 SDK 值导入或裸命名空间访问**：

| 文件                                       | 访问器                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `lib/rpc-manager.ts`                       | `.SessionManager` / `.agentDir` / `.createAgentSessionServices` / `.createAgentSessionFromServices` |
| `lib/session-reader.ts`                    | `.SessionManager.listAll/open` / `.buildSessionContext` / `.agentDir`                               |
| `lib/extension-theme.ts`                   | `.Theme`                                                                                            |
| `lib/plugin-auto-install.ts`               | `.DefaultPackageManager` / `.SettingsManager` / `.getAgentDir`                                      |
| `lib/plugin-package-manager.ts`            | `.DefaultPackageManager.prototype`（monkey-patch）                                                  |
| `app/api/agent/[id]/route.ts`              | `.SessionManager`（内联 cwd 读取）                                                                  |
| `app/api/agent/[id]/events/route.ts`       | `.SessionManager`                                                                                   |
| `app/api/agent/new/route.ts`               | `.createAgentSessionServices`（经 rpc-manager）                                                     |
| `app/api/agent/enhance/route.ts`           | `.AuthStorage` / `.ModelRegistry` / `.SettingsManager` / `.getAgentDir` / `.completeSimple`         |
| `app/api/models/route.ts`                  | `.agentDir` / `.createAgentSessionServices` / `.getSupportedThinkingLevels`                         |
| `app/api/models-config/route.ts`           | `.getAgentDir`                                                                                      |
| `app/api/models-config/test/route.ts`      | `.AuthStorage` / `.ModelRegistry` / `.completeSimple`                                               |
| `app/api/settings/route.ts`                | `.SettingsManager` / `.getAgentDir`                                                                 |
| `app/api/sessions/[id]/route.ts`           | `.SessionManager`                                                                                   |
| `app/api/sessions/[id]/context/route.ts`   | 经 `session-reader` 的 `getSessionEntries` / `buildSessionContext`                                  |
| `app/api/sessions/[id]/export/route.ts`    | `.getPackageDir`                                                                                    |
| `app/api/plugins/route.ts`                 | `.DefaultPackageManager` / `.getAgentDir` / `.SettingsManager`                                      |
| `app/api/skills/route.ts`                  | `.DefaultResourceLoader` / `.getAgentDir` / `.parseFrontmatter`                                     |
| `app/api/auth/login/[provider]/route.ts`   | `.AuthStorage`                                                                                      |
| `app/api/auth/logout/[provider]/route.ts`  | `.AuthStorage`                                                                                      |
| `app/api/auth/providers/route.ts`          | `.AuthStorage`                                                                                      |
| `app/api/auth/api-key/[provider]/route.ts` | `.AuthStorage` / `.ModelRegistry`                                                                   |
| `app/api/auth/all-providers/route.ts`      | `.AuthStorage` / `.ModelRegistry`                                                                   |
| `app/api/token-usage/[provider]/route.ts`  | `.AuthStorage`                                                                                      |
| `app/api/agents-md/route.ts`               | `.getAgentDir`                                                                                      |
| `app/api/agents-md/optimize/route.ts`      | `.AuthStorage` / `.ModelRegistry` / `.SettingsManager` / `.getAgentDir` / `.completeSimple`         |

> 验证：`grep` 全仓 `@earendil-works/pi-*` 的运行期（非 `import type`）导入，**仅** `lib/pi-sdk-adapter.ts` 一处命中。业务层裸命名空间（`.codingAgent`/`.ai`/`.aiCompat`）访问为 **0**。

---

## 5. 验证与回归

纯度由以下零失败闸门保证：

```bash
node_modules/.bin/tsc --noEmit        # 0 errors（类型层闭合，无 any 泄漏到业务契约）
npm run lint                          # 0 errors（仅有历史既有 warning）
node --test                           # 全部通过（行为零变更）
```

- 本次为**纯结构重构**：无任何 `if`/参数/返回处理的行为改动，仅导入重定向与分层。
- 业务层 SDK 耦合强转（`as unknown as`）已消除；剩余强转仅限：SDK/local 类型桥接（`session-reader.ts`）、monkey-patch（`plugin-package-manager.ts`）、测试 mock。
- `tsc` 全部通过证明类型边界正确闭合。

---

## 6. 后续演进指引

| 场景                  | 操作                                                                          |
| --------------------- | ----------------------------------------------------------------------------- |
| 升级 Pi SDK 到 v0.81+ | 仅改 `lib/pi-sdk-adapter.ts`（必要时微调 `pi-ports.ts` 契约）                 |
| 接入非 Pi 后端        | `registerPiAdapter(myAdapter)` 注入实现 `PiSdkPort` 的适配器，调用方零改动    |
| 路由层新增接口        | 直接调用 `lib/rpc-manager` / `lib/session-reader`，禁止再直接 `import` SDK 值 |
| 需要新的 SDK 符号     | 在 `PiSdkPort` 加一个具名属性（类引用或 `typeof` 函数），`SdkAdapter` 赋值    |

**重要**：新增业务/路由代码严禁再次 `import` `@earendil-works/pi-*` 的**值**或访问裸命名空间；一律经 `getPiAdapter()` 的具名访问器。类型需要时用 `@/lib/pi` 再导出的 SDK 词汇（`SdkSettingsManager` 等），避免散落的直接 type 导入。

---

## 7. 配置元信息 SSoT — `lib/config-schema.ts`（方案 A 引入）

为统一插件/扩展配置项的 UI 渲染、持久化、i18n 派生，新增 `lib/config-schema.ts` 作为唯一事实源。配套抽象层与 UI 子目录：

| 模块                                                                                  | 职责                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/config-schema.ts`                                                                | 类型壳（`FieldDescriptor` discriminated union + `PluginSchema` + `SCHEMA_VERSION` + `getSchema` / `resolveGroup` / `isFieldValid` 守卫 + `allSchemas` re-export）                                                  |
| `lib/all-schemas.ts`                                                                  | 33 个插件 / 81 字段的具体 schema 数据；从历史 `lib/plugin-config-descriptors.ts` 机械迁移（type 映射 `toggle→boolean / select→select / multiselect→string-list / text→string / number→number / list→string-list`） |
| `lib/settings-storage-adapter.ts`                                                     | `SettingsStorageAdapter` 三接口契约 + `LocalStorageAdapter` 实现（localStorage 主存 + `storage` 事件 + `BroadcastChannel` 双通道）                                                                                 |
| `hooks/useSettings.ts`                                                                | `useSyncExternalStore` 订阅 hook；已知字段写 `values`、未知字段写 `__unknown`；暴露 `getUnrecognizedFields()` D1 出口                                                                                              |
| `components/Settings/{index,P1General,P1BuiltinPlugins,P2Advanced,controls/,fields/}` | UI 拆分子目录，P1.1/P1.2/P1.3 三档折叠（`group: 'common'/'advanced'/'experimental'`）                                                                                                                              |
| `scripts/check-i18n-completeness.mjs`                                                 | 静态校验 schema 字段的 i18nKey 在 `lib/i18n/{en,zh}.ts` 中是否齐全；缺 `.label` 报错，缺 `.description/.placeholder/.errorMessage` 仅 warn                                                                         |
| `app/api/settings/[pluginId]/route.ts`                                                | Route Handler stub（P1 仅返回 501；未来切换 `defaultAdapter = new RouteHandlerSettingsAdapter('/api/settings')` 一行零业务改动）                                                                                   |

**契约要点**：

- `PluginSettings = { enabled?, values, __unknown }` — 已知字段与未知字段严格隔离，UI 仅渲染已知字段；P1 阶段不为未知字段生成控件（吸收 D1 立场，规避复杂度）
- 字段类型 discriminated union 在 `switch (field.type)` 内自动 narrow，无需 `as` 断言
- `__unknown` 命名空间仅通过 hook 出口 `getUnrecognizedFields()` 暴露
- `i18nKey` 命名：`settings.<pluginId>.fields.<field>.{label,description,placeholder,errorMessage,group}`
- 持久化抽象允许未来切换服务端化而不动业务代码（依赖倒置：`hooks/useSettings.ts` 注入 `defaultAdapter`）

**与 Pi SDK 的关系**：本模块完全不依赖 `@earendil-works/pi-*`，是纯前端设置面板的实现细节。`lib/plugin-config-descriptors.ts` 仍作为 per-plugin 配置描述符被 `PluginConfigPage.tsx` 直接消费；本模块与它是**互补**而非取代关系（前者驱动通用 Settings UI，后者驱动每插件独立 ConfigPage）。
