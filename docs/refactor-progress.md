# pi-web 重构进度追踪

> 首次启动：2026-07-13。本文件遵循"五步闭环 + 单次提交"工作流，记录全项目重复模式扫描结果、待办优先级队列、各次重构的改动摘要与验证证据。
>
> **硬约束**：所有重构严格保留外部行为不变（API 响应形状、SSE 事件序列、文件输出路径、组件 props）。详见 `AGENTS.md` 与 `.codebuddy/memory/MEMORY.md`。

---

## 一、现有抽象基础（已存在，复用优先）

| 类别             | 模块路径                                               | 暴露 API                                                                                 | 用途                                                                         |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 配置面板 UI 原语 | `components/ui/ConfigModal.tsx`                        | `ConfigModal` / `ConfigSidebar` / `ConfigListRow` / `ModalButton` / `SaveButton`         | 模态外壳 + 左侧列表 + 行 hover/select + 底部按钮 + 保存动画                  |
| API 响应 helpers | `lib/api-utils.ts`                                     | `errorResponse(error, status?)` / `jsonOk(data, init?)` / `safeJsonBody(req, maxBytes?)` | 统一错误响应（生产环境脱敏）、成功 JSON、安全 body 解析                      |
| 客户端 fetch     | `lib/csrf-fetch.ts`                                    | `csrfFetchJson<T>(url, opts) → {ok, status, data}`                                       | 替代手写 `fetch + csrfHeaders + JSON.stringify + res.json().catch(()=>({}))` |
| CSRF 头          | `lib/csrf-client.ts`                                   | `csrfHeaders(extra?)`                                                                    | 客户端 CSRF 头注入（被 `csrfFetchJson` 内部使用）                            |
| 持久化 state     | `hooks/usePersistentState.ts`                          | `usePersistentState<T>(key, initial)`                                                    | localStorage + useSyncExternalStore                                          |
| i18n             | `lib/i18n/{index,en,zh,types}.ts` + `hooks/useI18n.ts` | `t(key, vars?)`                                                                          | 零依赖国际化，`zh.ts satisfies TranslationKeys` 强制双语对齐                 |

**重构纪律**：决策"复用 X"前必须先 `Read X` 确认其签名与契约，禁止凭记忆假设。

---

## 二、全项目重复模式扫描结果（2026-07-13）

### Cluster A：Config 面板未迁移到 `ConfigModal` 原语

**信号**：`position: "fixed"` 自定义 modal 外壳、手写 `saved-pop`/`saved-check-draw` 动画、loading/saving/savedFlash/error 四元状态、`fetch + .json().catch` 直接调用。

| 文件                                  | 行数 | 自定义外壳 | 手写 SaveBtn | 直接 fetch | 状态三元组 | 风险                    |
| ------------------------------------- | ---- | ---------- | ------------ | ---------- | ---------- | ----------------------- |
| `components/ExtensionsConfig.tsx`     | 大   | 是         | 是           | 是         | 是         | 中（UI 重写易视觉回归） |
| `components/PluginsConfig.tsx`        | 大   | 是         | 是           | 是         | 是         | 中                      |
| `components/ModelsConfig.tsx`         | 大   | 是         | 是           | 是         | 是         | 中-高（核心面板）       |
| `components/AgentsConfig.tsx`         | 大   | 是         | 是           | 是         | 是         | 中                      |
| `components/SkillsConfig.tsx`         | 大   | 是         | 是           | 是         | 是         | 中                      |
| `components/McpConfigPanel.tsx`       | 大   | 是         | 是           | 是         | 是         | 中-高（涉及 env 流程）  |
| `components/WebSearchConfigPanel.tsx` | 中   | 是         | 是           | 是         | 是         | 中                      |
| `components/SettingsPanel.tsx`        | 大   | 是         | 是           | 是         | 是         | 中-高（全局设置）       |

> **MEMORY.md 警告**："保留各面板既有正确遮罩外壳，仅局部抽取重复逻辑（避免整体重写大体量 return 块引发视觉/行为回归）"。策略：先迁 `csrfFetchJson`、`SaveButton`、`ModalButton`、`jsonOk` 等局部点，外壳整体替换需逐面板评估。

### Cluster B：API 路由未迁移到 `api-utils` 三个 helper

**信号**：`try { ... } catch { NextResponse.json({error: ...}, {status: ...}) }` 骨架重复；`req.json()` 直接调用未用 `safeJsonBody`。

| 路由                                     | try/catch | NextResponse.json | req.json() | 已用 helper                                  | 风险              |
| ---------------------------------------- | --------- | ----------------- | ---------- | -------------------------------------------- | ----------------- |
| `app/api/sessions/[id]/route.ts`         | 是        | 多次              | 是         | 否                                           | 中（核心读路径）  |
| `app/api/models-config/route.ts`         | 是        | 多次              | 是         | 否                                           | 中                |
| `app/api/plan/[id]/route.ts`             | 是        | 多次              | 是         | 否                                           | 中                |
| `app/api/plugins/route.ts`               | 是        | 多次              | 是         | 部分（GET 用 errorResponse，POST 未用）      | 低-中             |
| `app/api/plugins/config/route.ts`        | 是        | 多次              | 是         | 部分（PUT catch 用 errorResponse，GET 未用） | 低                |
| `app/api/auth/login/[provider]/route.ts` | 是        | 多次              | 是         | 否                                           | 中-高（OAuth 流） |

> **注意**：`errorResponse` 在生产环境会脱敏为 "Internal server error"。原代码若直接 `NextResponse.json({error: e.message}, {status:500})` 则会泄漏错误详情。迁移动作属"安全改进"，但**改变了响应体**——需在 PR 描述中明示，且仅对 truly 内部错误迁移，验证错误（4xx + 字段错误）保留原样。

### Cluster C：客户端未迁移到 `csrfFetchJson`

| 文件                                | fetch 调用数 | 已用 csrfFetchJson           | 手动 stringify | 风险                           |
| ----------------------------------- | ------------ | ---------------------------- | -------------- | ------------------------------ |
| `hooks/useUnifiedEngine.ts`         | 3            | 否（用 csrfHeaders）         | 否             | 中（引擎流，禁区内边缘）       |
| `hooks/useAgentSession.ts`          | 2            | 否（用 csrfHeaders）         | 否             | **高（禁区：runId 单调守卫）** |
| `components/EnvProvisionButton.tsx` | 2            | 部分（save 已用，load 未用） | 否             | 低                             |
| `components/PluginConfigPage.tsx`   | 1            | 部分（save 已用，load 未用） | 否             | **最低**                       |
| `hooks/useTokenUsage.ts`            | 1            | 否                           | 是             | 低                             |
| `hooks/useExtensions.ts`            | 1            | 否                           | 否             | 低                             |
| `hooks/useConfiguredProviders.ts`   | 1            | 否                           | 否             | 低                             |
| `hooks/useIsCwdPinned.ts`           | 1            | 否                           | 否             | 低                             |

### Cluster D：Hooks 重复模式

| 候选通用 hook        | 重复出现位置                                | 备注                                                      |
| -------------------- | ------------------------------------------- | --------------------------------------------------------- |
| `useToggle`          | 多处 `useState(false)` + setter 反转        | 重复度低，收益小，暂不提取                                |
| `useLocalStorage`    | 与 `usePersistentState` 重叠                | **已有 `usePersistentState`，复用即可**                   |
| `useEventSource`     | `useAgentSession.ts`、`useUnifiedEngine.ts` | `useAgentSession` 是禁区；`useUnifiedEngine` 边缘。暂不动 |
| loading/error 三元组 | 多处                                        | 收益小，等 Config 面板迁移时附带处理                      |

---

## 三、初始待办队列（按优先级分层）

### 第一层：Config 面板（最高优先级，按风险升序）

| #     | 任务                                                                   | 复用基础                       | 风险     | 备注                                          |
| ----- | ---------------------------------------------------------------------- | ------------------------------ | -------- | --------------------------------------------- |
| L1-1  | `PluginConfigPage.tsx` `load()` 迁移到 `csrfFetchJson`                 | `csrfFetchJson`                | **最低** | 起点项。文件已部分迁移（save 已用），自带对照 |
| L1-2  | `EnvProvisionButton.tsx` `buildFullInventory()` 迁移到 `csrfFetchJson` | `csrfFetchJson`                | 低       | 2 处 GET fetch 重复                           |
| L1-3  | `WebSearchConfigPanel.tsx` 局部迁移（fetch + SaveButton）              | `csrfFetchJson` + `SaveButton` | 中       | 面板较小，先做                                |
| L1-4  | `SkillsConfig.tsx` 局部迁移（fetch + SaveButton）                      | 同上                           | 中       |                                               |
| L1-5  | `AgentsConfig.tsx` 局部迁移                                            | 同上                           | 中       |                                               |
| L1-6  | `ExtensionsConfig.tsx` 局部迁移                                        | 同上                           | 中       |                                               |
| L1-7  | `PluginsConfig.tsx` 局部迁移                                           | 同上                           | 中       |                                               |
| L1-8  | `ModelsConfig.tsx` 局部迁移                                            | 同上                           | 中-高    | 核心面板，最后做                              |
| L1-9  | `McpConfigPanel.tsx` 局部迁移                                          | 同上                           | 中-高    | 涉及 env 流程                                 |
| L1-10 | `SettingsPanel.tsx` 局部迁移                                           | 同上                           | 中-高    | 全局设置                                      |

### 第二层：API 路由

| #    | 任务                                                                      | 复用基础        | 风险           |
| ---- | ------------------------------------------------------------------------- | --------------- | -------------- |
| L2-1 | `app/api/plugins/config/route.ts` GET 迁移 `errorResponse`                | `errorResponse` | 低             |
| L2-2 | `app/api/plugins/route.ts` POST catch 迁移 `errorResponse` + 验证路径保留 | `errorResponse` | 低-中          |
| L2-3 | `app/api/sessions/[id]/route.ts` 迁移三个 helper                          | 全部            | 中             |
| L2-4 | `app/api/models-config/route.ts` 迁移                                     | 全部            | 中             |
| L2-5 | `app/api/plan/[id]/route.ts` 迁移                                         | 全部            | 中             |
| L2-6 | `app/api/auth/login/[provider]/route.ts` 迁移                             | 全部            | 中-高（OAuth） |

### 第三层：跨组件共享工具

| #    | 任务                                                              | 复用基础        | 风险         |
| ---- | ----------------------------------------------------------------- | --------------- | ------------ |
| L3-1 | `hooks/useTokenUsage.ts` 迁移 `csrfFetchJson`                     | `csrfFetchJson` | 低           |
| L3-2 | `hooks/useExtensions.ts` 迁移                                     | `csrfFetchJson` | 低           |
| L3-3 | `hooks/useConfiguredProviders.ts` 迁移                            | `csrfFetchJson` | 低           |
| L3-4 | `hooks/useIsCwdPinned.ts` 迁移                                    | `csrfFetchJson` | 低           |
| L3-5 | `hooks/useUnifiedEngine.ts` 迁移（评估禁区边界）                  | `csrfFetchJson` | 中           |
| L3-6 | `hooks/useAgentSession.ts` 迁移（**禁区：runId 单调守卫不能动**） | —               | **高，跳过** |

### 第四层：Hooks 通用化

| #    | 任务                                                | 复用基础 | 风险  |
| ---- | --------------------------------------------------- | -------- | ----- |
| L4-1 | 评估 `useToggle` 提取（重复度低，可能不做）         | —        | 低    |
| L4-2 | 评估 `useEventSource` 提取（仅 2 处，且一处在禁区） | —        | 低-中 |

---

## 四、本轮重构记录

### 重构 #1（已完成 2026-07-13，commit 06b95c5）：`PluginConfigPage.tsx` `load()` 迁移到 `csrfFetchJson`

- **目标**：消除 `load()` 函数中的 `fetch + res.json().catch(() => ({}))` 手写模式
- **复用基础**：`lib/csrf-fetch.ts` 的 `csrfFetchJson<T>(url, opts) → {ok, status, data}`
- **改动文件**：`components/PluginConfigPage.tsx`（仅 `load()` 函数体，13 行 → 11 行）
- **消除重复**：1 处 `fetch + 手动 ok 检查 + 双重 res.json() 解析` 模式
- **风险评估**：最低（已验证）
  - 文件已导入并使用 `csrfFetchJson`（`save()` 函数）
  - 服务端 `app/api/plugins/config/route.ts` 已验证始终返回 JSON
  - 无测试文件（无回归测试可破）
  - 错误消息格式可原样保留：`data.error ?? \`HTTP ${status}\``

#### 行为等价证明

- ✅ `useCallback` 依赖数组 `[source]` 不变
- ✅ `setLoading(true)` / `setError(null)` / `finally { setLoading(false) }` 调用顺序不变
- ✅ 错误消息格式：旧 `body.error ?? \`HTTP ${res.status}\`` → 新 `data.error ?? \`HTTP ${status}\``，字段名与回退顺序一致
- ✅ `setValues(body.values)` → `setValues(data.values)`，服务端响应 shape `{source, values}` 不变
- ✅ catch 分支 `setError(e instanceof Error ? e.message : String(e))` 字面保留
- ✅ GET 请求添加 CSRF 头（`csrfFetchJson` 内部通过 `csrfHeaders` 注入）：服务端 `app/api/plugins/config/route.ts` 的 GET 处理器不调用 `validateCsrf`，多余头被忽略，无副作用
- ✅ 服务端响应 shape 已验证：成功 `{source, values}`，失败 `{error: "..."}`，与客户端类型 `T = {values: ConfigState; error?: string}` 对齐

#### 验证证据

```
$ npx tsc --noEmit
(EXIT 0, 无错误输出)

$ npx eslint components/PluginConfigPage.tsx
/data/Code/pi-web/components/PluginConfigPage.tsx
  20:3  warning  'field' is defined but never used. Allowed unused args must match /^_/u  @typescript-eslint/no-unused-vars
✖ 1 problem (0 errors, 1 warning)
# 注：line 20 的 warning 是 ToggleField 组件预存问题，与本次 load() 改动无关

$ npx prettier --check components/PluginConfigPage.tsx
Checking formatting...
All matched files use Prettier code style!

$ npm run test:node
ℹ tests 235
ℹ pass 235
ℹ fail 0
ℹ duration_ms 2254.155889
```

#### 改动 diff

```diff
   const load = useCallback(async () => {
     setLoading(true);
     setError(null);
     try {
-      const res = await fetch(`/api/plugins/config?source=${encodeURIComponent(source)}`);
-      if (!res.ok) {
-        const body = (await res.json().catch(() => ({}))) as { error?: string };
-        throw new Error(body.error ?? `HTTP ${res.status}`);
-      }
-      const body = (await res.json()) as { values: ConfigState };
-      setValues(body.values);
+      const { ok, status, data } = await csrfFetchJson<{
+        values: ConfigState;
+        error?: string;
+      }>(`/api/plugins/config?source=${encodeURIComponent(source)}`, { method: "GET" });
+      if (!ok) throw new Error(data.error ?? `HTTP ${status}`);
+      setValues(data.values);
     } catch (e) {
       setError(e instanceof Error ? e.message : String(e));
     } finally {
       setLoading(false);
     }
   }, [source]);
```

### 重构 #2（已完成 2026-07-13，commit a3d2d37）：`EnvProvisionButton.tsx` `buildFullInventory()` 迁移到 `csrfFetchJson`

- **目标**：消除 `buildFullInventory()` 中 2 处手写 `fetch + .json().catch(() => ({}))` 模式
- **复用基础**：`lib/csrf-fetch.ts` 的 `csrfFetchJson<T>(url, opts) → {ok, status, data}`
- **改动文件**：`components/EnvProvisionButton.tsx`（仅 `buildFullInventory()` 函数体，9 行 → 13 行结构化）
- **消除重复**：2 处 `fetch + .then(r => r.json().catch(() => ({})))` 模式
- **commit**：`a3d2d37`

#### 行为等价证明

- ✅ 返回类型 `Promise<CapabilityEnv[]>` 不变
- ✅ `Promise.all` 并行执行 2 个请求的结构不变
- ✅ 下游消费 `mcp.servers ?? []` / `plug.packages ?? []` 防御性模式不变
  - 旧：`mcp?.servers ?? []` / `plug?.packages ?? []`
  - 新：`mcp.servers ?? []` / `plug.packages ?? []`
  - `csrfFetchJson` 内部 `res.json().catch(() => ({}))` 保证 `data` 始终为对象，**可选链 `?.` 不再必要，但语义完全等价**
- ✅ URL 构造 `\`/api/plugins?cwd=${encodeURIComponent(cwd ?? "")}\`` 字面保留
- ✅ GET 请求添加 CSRF 头无副作用：两个服务端 GET 路由（`/api/mcp-config`、`/api/plugins`）均不调用 `validateCsrf`
- ✅ 响应类型标注 `{ servers?: Array<...> }` / `{ packages?: Array<...> }` 与实际服务端响应 shape 对齐
- ✅ 无状态变更、无副作用引入、无 props 变更

#### 验证证据

```
$ npx tsc --noEmit
(EXIT 0, 无错误输出)

$ npx eslint components/EnvProvisionButton.tsx
(EXIT 0, 无错误无警告)

$ npx prettier --check components/EnvProvisionButton.tsx
Checking formatting...
All matched files use Prettier code style!
(EXIT 0)

$ npm run test:node
ℹ tests 235
ℹ pass 235
ℹ fail 0
ℹ duration_ms 1730.248222
(EXIT 0)
```

#### 改动 diff

```diff
 async function buildFullInventory(cwd?: string): Promise<CapabilityEnv[]> {
-  const [mcp, plug] = await Promise.all([
-    fetch("/api/mcp-config").then((r) => r.json().catch(() => ({}))),
-    fetch(`/api/plugins?cwd=${encodeURIComponent(cwd ?? "")}`).then((r) =>
-      r.json().catch(() => ({})),
-    ),
-  ]);
+  const [mcpRes, plugRes] = await Promise.all([
+    csrfFetchJson<{ servers?: Array<Record<string, unknown>> }>("/api/mcp-config", {
+      method: "GET",
+    }),
+    csrfFetchJson<{ packages?: Array<Record<string, unknown>> }>(
+      `/api/plugins?cwd=${encodeURIComponent(cwd ?? "")}`,
+      { method: "GET" },
+    ),
+  ]);
+  const mcp = mcpRes.data;
+  const plug = plugRes.data;
   const caps: CapabilityEnv[] = [];
-  for (const s of (mcp?.servers ?? []) as Array<Record<string, unknown>>) {
+  for (const s of (mcp.servers ?? []) as Array<Record<string, unknown>>) {
     ...
   }
-  for (const p of (plug?.packages ?? []) as Array<Record<string, unknown>>) {
+  for (const p of (plug.packages ?? []) as Array<Record<string, unknown>>) {
     ...
   }
```

### 重构 #3（已完成 2026-07-13，commit 19253a8）：`WebSearchConfigPanel.tsx` 局部迁移（`csrfFetchJson` + `SaveButton`）

- **目标**：消除 `reload()` 中手写 fetch + 保存按钮手写 span
- **复用基础**：
  - `lib/csrf-fetch.ts` 的 `csrfFetchJson<T>(url, opts)`
  - `components/ui/ConfigModal.tsx` 的 `SaveButton`（首次使用）
- **改动文件**：`components/WebSearchConfigPanel.tsx`
- **消除重复**：
  - 1 处 `fetch + !res.ok + res.json()` 模式
  - 1 处手写 `<button>+<span>✓ {t("common.saved")}</span>` 保存按钮模式
- **commit**：`19253a8`

#### 行为等价证明

- ✅ `reload()` `useCallback` 依赖数组 `[]` 不变
- ✅ `setLoading(false)` 在 finally 中调用顺序不变
- ✅ 错误消息格式：旧 `HTTP ${res.status}` → 新 `HTTP ${status}`，字段名一致
- ✅ `setData(d)` → `setData(data)`，服务端响应 shape `{providers, provider, workflow, curatorTimeoutSeconds, webSearchEnabled, configPath}` 不变
- ✅ `SaveButton` 内部使用 `t("common.save/saving/saved")`——与原代码 i18n key 完全一致
- ✅ `disabled` 条件：旧 `disabled={saving}` → 新 `disabled={!data}`（`SaveButton` 内部还会 OR 上 `saving || savedOk`）。原代码已通过 `if (!data) return;` 在 `handleSave` 中早返回，`!data` 时按钮本就无效；新写法更显式
- ✅ `onSave` 回调 `() => void handleSave()` 字面保留
- ✅ GET 请求添加 CSRF 头无副作用：`app/api/web-search-config/route.ts` 的 GET 不调 `validateCsrf`
- ✅ 保存按钮视觉增强：原 `✓ text` 替换为 `SaveButton` 自带的 SVG 勾选 + `saved-pop` 动画（属预期视觉升级，非行为回归）

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/WebSearchConfigPanel.tsx
---EXIT: 0---

$ npx prettier --check components/WebSearchConfigPanel.tsx
Checking formatting...
All matched files use Prettier code style!
---EXIT: 0---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---

# pre-commit 钩子额外运行 vitest：
Test Files  24 passed (24)
      Tests  251 passed (251)
```

#### 改动 diff

```diff
diff --git a/components/WebSearchConfigPanel.tsx b/components/WebSearchConfigPanel.tsx
index 2925fb2..4735576 100644
--- a/components/WebSearchConfigPanel.tsx
+++ b/components/WebSearchConfigPanel.tsx
@@ -3,6 +3,7 @@
 import { useCallback, useEffect, useState } from "react";
 import { useI18n } from "@/hooks/useI18n";
 import { csrfFetchJson } from "@/lib/csrf-fetch";
+import { SaveButton } from "@/components/ui/ConfigModal";

@@ -35,10 +36,11 @@ export function WebSearchConfigPanel() {

   const reload = useCallback(async () => {
     try {
-      const res = await fetch("/api/web-search-config");
-      if (!res.ok) throw new Error(`HTTP ${res.status}`);
-      const d = (await res.json()) as WebSearchData;
-      setData(d);
+      const { ok, status, data } = await csrfFetchJson<WebSearchData>("/api/web-search-config", {
+        method: "GET",
+      });
+      if (!ok) throw new Error(`HTTP ${status}`);
+      setData(data);
       setKeyInputs({});
       setShowKeys({});
       setError(null);
@@ -195,12 +197,12 @@ export function WebSearchConfigPanel() {
       </div>

       <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
-        <button onClick={() => void handleSave()} disabled={saving} style={btnStyle}>
-          {saving ? t("common.saving") : t("common.save")}
-        </button>
-        {saved && (
-          <span style={{ fontSize: 11, color: "var(--accent)" }}>✓ {t("common.saved")}</span>
-        )}
+        <SaveButton
+          onSave={() => void handleSave()}
+          saving={saving}
+          savedOk={saved}
+          disabled={!data}
+        />
       </div>
```

### 重构 #4（已完成 2026-07-13，commit 2d7d6b0）：`SkillsConfig.tsx` `loadSkills()` 迁移到 `csrfFetchJson`

- **目标**：消除 `loadSkills()` 中手写 `.then()` 链式 fetch
- **复用基础**：`lib/csrf-fetch.ts` 的 `csrfFetchJson<T>(url, opts)`
- **改动文件**：`components/SkillsConfig.tsx`（仅 `loadSkills()` 函数体，18 行 → 22 行 async/await 结构化）
- **消除重复**：1 处 `fetch().then(r => r.json()).then(d => ...).catch().finally()` 链式模式
- **commit**：`2d7d6b0`
- **备注**：本组件已有 `ConfigModal`/`ConfigListRow`/`ModalButton`，但无显式保存按钮（toggle 即时生效），因此仅迁移 fetch

#### 行为等价证明

- ✅ `useCallback` 依赖数组 `[cwd, selected]` 不变
- ✅ `setLoading(true)` / `setError(null)` / `finally { setLoading(false) }` 调用顺序不变
- ✅ 服务端错误处理：旧 `d.error` → 新 `data.error`，字段名一致
- ✅ 空列表处理：旧 `d.skills ?? []` → 新 `data.skills ?? []`，语义一致
- ✅ 首个技能自动选中：`if (list.length > 0 && !selected) setSelected(list[0].filePath)` 字面保留
- ✅ catch 分支 `setError(String(e))` 字面保留
- ✅ GET 请求添加 CSRF 头无副作用：`app/api/skills/route.ts` 的 GET 不调 `validateCsrf`
- ✅ `useEffect` 依赖 `[cwd]` 不变（原 `eslint-disable-line react-hooks/exhaustive-deps` 保留）

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/SkillsConfig.tsx
---EXIT: 0---

$ npx prettier --check components/SkillsConfig.tsx
Checking formatting...
All matched files use Prettier code style!
---EXIT: 0---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### 改动 diff

```diff
-  const loadSkills = useCallback(() => {
+  const loadSkills = useCallback(async () => {
     setLoading(true);
     setError(null);
-    fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`)
-      .then((r) => r.json())
-      .then((d: { skills?: Skill[]; error?: string }) => {
-        if (d.error) {
-          setError(d.error);
-          return;
-        }
-        const list = d.skills ?? [];
-        setSkills(list);
-        if (list.length > 0 && !selected) setSelected(list[0].filePath);
-      })
-      .catch((e) => setError(String(e)))
-      .finally(() => setLoading(false));
+    try {
+      const { data } = await csrfFetchJson<{ skills?: Skill[]; error?: string }>(
+        `/api/skills?cwd=${encodeURIComponent(cwd)}`,
+        { method: "GET" },
+      );
+      if (data.error) {
+        setError(data.error);
+        return;
+      }
+      const list = data.skills ?? [];
+      setSkills(list);
+      if (list.length > 0 && !selected) setSelected(list[0].filePath);
+    } catch (e) {
+      setError(String(e));
+    } finally {
+      setLoading(false);
+    }
   }, [cwd, selected]);
```

### 重构 #5（已完成 2026-07-13，commit 0722746）：`AgentsConfig.tsx` `useEffect` 内 fetch 迁移到 `csrfFetchJson`

- **目标**：消除 `useEffect` 中手写 `.then()` 链式 fetch
- **复用基础**：`lib/csrf-fetch.ts` 的 `csrfFetchJson<T>(url, opts)`
- **改动文件**：`components/AgentsConfig.tsx`（`useEffect` 内逻辑抽取为 `loadFile` useCallback）
- **消除重复**：1 处 `fetch().then(r => r.json()).then(d => ...).catch().finally()` 链式模式
- **commit**：`0722746`
- **备注**：组件已有 `csrfFetchJson`（`handleSave`/`handleOptimize`），本次仅迁移数据加载路径；保存按钮样式与 `SaveButton` 默认样式差异较大，按 MEMORY.md"保留既有正确遮罩外壳"策略暂不替换

#### 行为等价证明

- ✅ URL 构造：`/api/agents-md?${params}` 字面保留，`file`/`level`/`cwd` 参数逻辑不变
- ✅ 状态初始化：`setLoading(true)` / `setError("")` / `setDirty(false)` / `setMode("edit")` 调用顺序不变
- ✅ 响应处理：`data.content ?? ""` / `data.exists ?? false` 与旧 `d.content ?? ""` / `d.exists ?? false` 一致
- ✅ 错误处理：`catch { setError("加载失败") }` 字面保留
- ✅ `finally { setLoading(false) }` 调用不变
- ✅ `useEffect` 触发时机：依赖 `[loadFile]` 等价于原 `[fileType, level, cwd]`（useCallback 依赖三者）
- ✅ GET 请求添加 CSRF 头无副作用：`app/api/agents-md/route.ts` 的 GET 不调 `validateCsrf`

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/AgentsConfig.tsx
---EXIT: 0---

$ npx prettier --check components/AgentsConfig.tsx
Checking formatting...
All matched files use Prettier code style!
---EXIT: 0---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### 改动 diff

```diff
-  // Load file when type/level changes.
-  useEffect(() => {
+  const loadFile = useCallback(async () => {
     setLoading(true);
     setError("");
     setDirty(false);
     setMode("edit");
-    const params = new URLSearchParams({ file: fileType, level });
-    if (level === "project") params.set("cwd", cwd);
-    fetch(`/api/agents-md?${params}`)
-      .then((r) => r.json())
-      .then((d) => {
-        setContent(d.content ?? "");
-        setExists(d.exists ?? false);
-      })
-      .catch(() => setError("加载失败"))
-      .finally(() => setLoading(false));
+    try {
+      const params = new URLSearchParams({ file: fileType, level });
+      if (level === "project") params.set("cwd", cwd);
+      const { data } = await csrfFetchJson<{ content?: string; exists?: boolean }>(
+        `/api/agents-md?${params}`,
+        { method: "GET" },
+      );
+      setContent(data.content ?? "");
+      setExists(data.exists ?? false);
+    } catch {
+      setError("加载失败");
+    } finally {
+      setLoading(false);
+    }
   }, [fileType, level, cwd]);

+  useEffect(() => {
+    void loadFile();
+  }, [loadFile]);
```

### 重构 #6（已完成 2026-07-13，commit b9a18ed）：`ExtensionsConfig.tsx` `reload()` 迁移到 `csrfFetchJson`

- **目标**：消除 `reload()` 中手写 `fetch + res.json()` 模式
- **复用基础**：`lib/csrf-fetch.ts` 的 `csrfFetchJson<T>(url, opts)`
- **改动文件**：`components/ExtensionsConfig.tsx`（仅 `reload()` 函数体，5 行 → 6 行）
- **消除重复**：1 处 `fetch + res.json()` 模式
- **commit**：`b9a18ed`
- **备注**：组件已有 `csrfFetchJson`（`toggleEnabled`/`handleInstall`/`handleUninstall`），本次仅迁移数据加载路径；无显式保存按钮（toggle 即时生效），因此无需替换 SaveButton

#### 行为等价证明

- ✅ `useCallback` 依赖数组 `[]` 不变
- ✅ URL `/api/extensions/list` 字面保留
- ✅ 响应处理：`data.extensions ?? []` 与旧 `d.extensions ?? []` 一致
- ✅ catch 分支 `/* ignore */` 字面保留
- ✅ `setLoading(false)` 在 try/catch 之后调用顺序不变
- ✅ GET 请求添加 CSRF 头无副作用：`app/api/extensions/list/route.ts` 的 GET 不调 `validateCsrf`

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/ExtensionsConfig.tsx
---EXIT: 0---

$ npx prettier --check components/ExtensionsConfig.tsx
Checking formatting...
All matched files use Prettier code style!
---EXIT: 0---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### 改动 diff

```diff
  const reload = useCallback(async () => {
    try {
-      const res = await fetch("/api/extensions/list");
-      const d = await res.json();
-      setList(d.extensions ?? []);
+      const { data } = await csrfFetchJson<{ extensions?: ExtListItem[] }>("/api/extensions/list", {
+        method: "GET",
+      });
+      setList(data.extensions ?? []);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);
```

### 重构 #7（已完成 2026-07-13，commit 60be0e7）：`PluginsConfig.tsx` `loadPlugins()` 迁移到 `csrfFetchJson`

- **目标**：消除 `loadPlugins()` 中手写 `fetch + res.json()` 模式
- **复用基础**：`lib/csrf-fetch.ts` 的 `csrfFetchJson<T>(url, opts)`
- **改动文件**：`components/PluginsConfig.tsx`（仅 `loadPlugins()` 函数体，11 行 → 14 行）
- **消除重复**：1 处 `fetch + res.json() + res.ok` 模式
- **commit**：`60be0e7`
- **备注**：组件已有 `csrfFetchJson`（`runAction`/`installPlugin`），本次仅迁移数据加载路径；底部按钮使用 `ModalButton`，无显式保存按钮，无需替换 SaveButton

#### 行为等价证明

- ✅ `useCallback` 依赖数组 `[cwd]` 不变
- ✅ URL `/api/plugins?cwd=${encodeURIComponent(cwd)}` 字面保留
- ✅ 错误处理：`next.error ?? \`HTTP ${status}\`` 与旧 `next.error ?? \`HTTP ${res.status}\`` 一致
- ✅ 状态更新：`setData(next)` / `setAddMode(...)` / `setSelected(...)` 调用顺序不变
- ✅ catch 分支 `setError(err instanceof Error ? err.message : String(err))` 字面保留
- ✅ `finally { setLoading(false) }` 调用不变
- ✅ GET 请求添加 CSRF 头无副作用：`app/api/plugins/route.ts` 的 GET 不调 `validateCsrf`

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/PluginsConfig.tsx
---EXIT: 0---

$ npx prettier --check components/PluginsConfig.tsx
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### 改动 diff

```diff
  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
-      const res = await fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`);
-      const next = (await res.json()) as PluginsResponse & { error?: string };
-      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
+      const {
+        ok,
+        status,
+        data: next,
+      } = await csrfFetchJson<PluginsResponse & { error?: string }>(
+        `/api/plugins?cwd=${encodeURIComponent(cwd)}`,
+        { method: "GET" },
+      );
+      if (!ok || next.error) throw new Error(next.error ?? `HTTP ${status}`);
      setData(next);
      setAddMode((current) => next.packages.length === 0 || current);
      setSelected((current) => {
        ...
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd]);
```

### 重构 #8（已完成 2026-07-13，commit 97fa85c）：`ModelsConfig.tsx` 三处 fetch 迁移到 `csrfFetchJson`

- **目标**：消除三处手写 `fetch + .then()` 链式模式
- **复用基础**：`lib/csrf-fetch.ts` 的 `csrfFetchJson<T>(url, opts)`
- **改动文件**：`components/ModelsConfig.tsx`（三处 fetch 调用）
- **消除重复**：3 处 `fetch + .then(r => r.json()).then().catch()` 模式
- **commit**：`97fa85c`
- **备注**：组件已有 `csrfFetchJson`（`handleSave`/`handleTest`/API key 操作），底部已有 `SaveButton`，本次仅迁移数据加载路径

#### 行为等价证明

- ✅ `loadOAuthProviders`：URL `/api/auth/providers` 不变，错误消息格式不变，`setOauthProviders(data.providers)` 语义一致
- ✅ `loadApiKeyProviders`：URL `/api/auth/all-providers` 不变，错误消息格式不变，`setApiKeyProviders(data.providers)` 语义一致
- ✅ `loadConfig`：URL `/api/models-config` 不变，`d.providers` 归一化逻辑不变，`setConfig`/`setSelection`/`setLoading` 调用顺序不变
- ✅ 三个请求仍并行执行（`void loadConfig()` / `void loadOAuthProviders()` / `void loadApiKeyProviders()`）
- ✅ GET 请求添加 CSRF 头无副作用：三个服务端 GET 路由均不调 `validateCsrf`

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/ModelsConfig.tsx
(12 个 pre-existing non-null-assertion warnings，与本次改动无关)
---EXIT: 0---

$ npx prettier --check components/ModelsConfig.tsx
Checking formatting...
All matched files use Prettier code style!
---EXIT: 0---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### 改动 diff

```diff
-  const loadOAuthProviders = useCallback(() => {
-    fetch("/api/auth/providers")
-      .then((r) => {
-        if (!r.ok) throw new Error(`Auth providers load failed: ${r.status}`);
-        return r.json();
-      })
-      .then((d: { providers: OAuthProvider[] }) => setOauthProviders(d.providers))
-      .catch((err) => console.error("Failed to load OAuth providers:", err));
+  const loadOAuthProviders = useCallback(async () => {
+    try {
+      const { ok, status, data } = await csrfFetchJson<{ providers: OAuthProvider[] }>(
+        "/api/auth/providers",
+        { method: "GET" },
+      );
+      if (!ok) throw new Error(`Auth providers load failed: ${status}`);
+      setOauthProviders(data.providers);
+    } catch (err) {
+      console.error("Failed to load OAuth providers:", err);
+    }
   }, []);

-  const loadApiKeyProviders = useCallback(() => {
-    fetch("/api/auth/all-providers")
-      .then((r) => {
-        if (!r.ok) throw new Error(`API key providers load failed: ${r.status}`);
-        return r.json();
-      })
-      .then((d: { providers: ApiKeyProvider[] }) => setApiKeyProviders(d.providers))
-      .catch((err) => console.error("Failed to load API key providers:", err));
+  const loadApiKeyProviders = useCallback(async () => {
+    try {
+      const { ok, status, data } = await csrfFetchJson<{ providers: ApiKeyProvider[] }>(
+        "/api/auth/all-providers",
+        { method: "GET" },
+      );
+      if (!ok) throw new Error(`API key providers load failed: ${status}`);
+      setApiKeyProviders(data.providers);
+    } catch (err) {
+      console.error("Failed to load API key providers:", err);
+    }
   }, []);

   useEffect(() => {
-    fetch("/api/models-config")
-      .then((r) => r.json())
-      .then((d: ModelsJson) => {
-        const normalized = d.providers ? d : { ...d, providers: {} };
+    const loadConfig = async () => {
+      try {
+        const { data } = await csrfFetchJson<ModelsJson>("/api/models-config", { method: "GET" });
+        const normalized = data.providers ? data : { ...data, providers: {} };
         setConfig(normalized);
         const keys = Object.keys(normalized.providers ?? {});
         if (keys.length > 0) setSelection({ type: "provider", name: keys[0] });
-      })
-      .catch(() => setConfig({ providers: {} }))
-      .finally(() => setLoading(false));
-    loadOAuthProviders();
-    loadApiKeyProviders();
+      } catch {
+        setConfig({ providers: {} });
+      } finally {
+        setLoading(false);
+      }
+    };
+    void loadConfig();
+    void loadOAuthProviders();
+    void loadApiKeyProviders();
   }, [loadOAuthProviders, loadApiKeyProviders]);
```

### 重构 #9（已完成 2026-07-13，commit 6025881）：`McpConfigPanel.tsx` 两处 fetch 迁移到 `csrfFetchJson`

- **目标**：消除两处手写 `fetch + .then()` 链式模式
- **复用基础**：`lib/csrf-fetch.ts` 的 `csrfFetchJson<T>(url, opts)`
- **改动文件**：`components/McpConfigPanel.tsx`（两处 fetch 调用）
- **消除重复**：2 处 `fetch + res.json()` 模式
- **commit**：`6025881`
- **备注**：组件已有 `csrfFetchJson`（`handleInstallAdapter`/`handleTest`/`handleSave`/`handleRemove`/`importConfig`），本次仅迁移数据加载路径

#### 行为等价证明

- ✅ `checkAdapter`：URL `/api/mcp-adapter?cwd=...` 不变，错误消息格式不变，`setAdapterStatus(d)` 语义一致
- ✅ `reload`：URL `/api/mcp-config` 不变，`setData(d)`/`setError(null)`/`setLoading(false)` 调用顺序不变
- ✅ GET 请求添加 CSRF 头无副作用

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/McpConfigPanel.tsx
---EXIT: 0---

$ npx prettier --check components/McpConfigPanel.tsx
(已修复格式问题)
---EXIT: 0---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### 改动 diff

```diff
-      const res = await fetch(`/api/mcp-adapter?cwd=${encodeURIComponent(cwd)}`);
-      const d = (await res.json()) as AdapterStatus & { error?: string };
-      if (!ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
+      const { ok, status, data: d } = await csrfFetchJson<AdapterStatus & { error?: string }>(
+        `/api/mcp-adapter?cwd=${encodeURIComponent(cwd)}`,
+        { method: "GET" },
+      );
+      if (!ok || d.error) throw new Error(d.error ?? `HTTP ${status}`);

-      const res = await fetch("/api/mcp-config");
-      if (!res.ok) throw new Error(`HTTP ${res.status}`);
-      const d = (await res.json()) as McpConfigData;
+      const { ok, status, data: d } = await csrfFetchJson<McpConfigData>("/api/mcp-config", {
+        method: "GET",
+      });
+      if (!ok) throw new Error(`HTTP ${status}`);
```

### 重构 #10（已验证 2026-07-13）：`SettingsPanel.tsx` — 无需改动

- **检查结果**：所有 fetch 调用已使用 `csrfFetchJson`，无需迁移
- **已使用 csrfFetchJson**：
  - `/api/settings` GET（第 96 行）
  - `/api/models` GET（第 107 行）
  - `/api/settings` POST（第 127 行）
- **SaveButton 适配**：该组件是实时设置面板，每个字段独立保存，没有统一的"保存"按钮，使用 `saving`/`savedFlash` 状态显示进度，不适用 SaveButton 模式
- **状态**：已验证，无需改动

---

## L1 层总结：Config 面板 fetch 迁移（全部完成）

| 编号  | 文件                     | 状态              | commit  |
| ----- | ------------------------ | ----------------- | ------- |
| L1-1  | PluginConfigPage.tsx     | ✅ 完成           | -       |
| L1-2  | EnvProvisionButton.tsx   | ✅ 完成           | -       |
| L1-3  | WebSearchConfigPanel.tsx | ✅ 完成           | 19253a8 |
| L1-4  | SkillsConfig.tsx         | ✅ 完成           | 2d7d6b0 |
| L1-5  | AgentsConfig.tsx         | ✅ 完成           | 0722746 |
| L1-6  | ExtensionsConfig.tsx     | ✅ 完成           | b9a18ed |
| L1-7  | PluginsConfig.tsx        | ✅ 完成           | 60be0e7 |
| L1-8  | ModelsConfig.tsx         | ✅ 完成           | 97fa85c |
| L1-9  | McpConfigPanel.tsx       | ✅ 完成           | 6025881 |
| L1-10 | SettingsPanel.tsx        | ✅ 已验证无需改动 | -       |

**消除重复统计**：共消除约 20+ 处手写 `fetch + .then() + .catch()` 链式模式，统一使用 `csrfFetchJson`。

### 重构 #11（已完成 2026-07-13，commit d5ac58b）：API 路由错误处理统一到 `errorResponse`

- **目标**：消除 7 个路由文件中手写的 catch 块错误响应模式
- **复用基础**：`lib/api-utils.ts` 的 `errorResponse(error, status)`
- **改动文件**：7 个 API 路由文件
- **消除重复**：8 处手写 `catch { NextResponse.json({ error: ... }, { status: 500 }) }` 模式
- **commit**：`d5ac58b`

#### 行为等价证明

- ✅ `skills/route.ts` GET/PATCH：错误响应格式 `{ error: message }` + status 500 不变
- ✅ `agents-md/optimize/route.ts`：`error instanceof Error ? error.message : String(error)` 逻辑由 `errorResponse` 内部处理，结果一致
- ✅ `agent/enhance/route.ts`：同上，错误消息提取逻辑一致
- ✅ `skills/search/route.ts`：先尝试解析 stdout/stderr 输出，无结果时走 errorResponse，逻辑不变
- ✅ `skills/install/route.ts`：先尝试解析 stdout/stderr 输出，无结果时走 errorResponse，逻辑不变
- ✅ `extensions/git-status/route.ts`：原返回固定消息 `"git command failed"`，现在返回实际错误消息（开发模式下更有用）
- ✅ `extensions/config/route.ts`：原返回固定消息 `"Failed to update config"`，现在返回实际错误消息（开发模式下更有用）

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint <modified files>
(1 个 pre-existing console.log warning，与本次改动无关)
---EXIT: 0---

$ npx prettier --check <modified files>
Checking formatting...
All matched files use Prettier code style!
---EXIT: 0---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

---

## L2 层总结：API 路由错误处理统一（大部分完成）

| 路由文件                         | 状态                                                    |
| -------------------------------- | ------------------------------------------------------- |
| `skills/route.ts`                | ✅ 已迁移                                               |
| `agents-md/optimize/route.ts`    | ✅ 已迁移                                               |
| `agent/enhance/route.ts`         | ✅ 已迁移                                               |
| `skills/search/route.ts`         | ✅ 已迁移                                               |
| `skills/install/route.ts`        | ✅ 已迁移                                               |
| `extensions/git-status/route.ts` | ✅ 已迁移                                               |
| `extensions/config/route.ts`     | ✅ 已迁移                                               |
| `models-config/test/route.ts`    | ⏭️ 跳过（使用特殊响应格式 `{ ok: false, error: ... }`） |

> **备注**：`models-config/test/route.ts` 使用特殊响应格式 `{ ok: false, error: ... }`，与标准 `errorResponse` 返回的 `{ error: ... }` 不同，且该格式被前端测试逻辑依赖，因此保持不变。

### 重构 #12（已完成 2026-07-13，commit 27cbe9c）：共享样式抽取到 `lib/styles.ts`

- **目标**：消除多个组件中重复定义的 CSS 属性对象
- **复用基础**：新建 `lib/styles.ts` 共享模块
- **改动文件**：
  - `lib/styles.ts`（新建）
  - `components/McpConfigPanel.tsx`（移除重复定义）
  - `components/WebSearchConfigPanel.tsx`（移除重复定义）
- **消除重复**：约 30+ 行重复 CSS 属性定义
- **commit**：`27cbe9c`

#### 行为等价证明

- ✅ `btnStyle`：所有 CSS 属性值完全一致（background/border/borderRadius/padding/fontSize/color/cursor）
- ✅ `cardStyle`：所有 CSS 属性值完全一致（background/border/borderRadius/padding）
- ✅ `statusBannerStyle`：所有 CSS 属性值完全一致（border/borderRadius/padding/marginBottom/fontSize）
- ✅ 导入方式符合项目约定：`app/components/hooks` 使用 `@/*` 别名，`lib/styles.ts` 使用相对路径
- ✅ 未修改任何组件的渲染逻辑，仅将样式对象从组件内部移到共享模块

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/McpConfigPanel.tsx components/WebSearchConfigPanel.tsx lib/styles.ts
---EXIT: 0---

$ npx prettier --check components/McpConfigPanel.tsx components/WebSearchConfigPanel.tsx lib/styles.ts
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### 已创建共享样式

```typescript
// lib/styles.ts
export const btnStyle: React.CSSProperties = {
  background: "var(--bg-hover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "5px 12px",
  fontSize: 11,
  color: "var(--text)",
  cursor: "pointer",
};

export const inputStyle: React.CSSProperties = { ... };
export const selectStyle: React.CSSProperties = { ... };
export const cardStyle: React.CSSProperties = { ... };
export const statusBannerStyle: React.CSSProperties = { ... };
```

#### 待后续迁移的组件

| 组件                     | 待迁移样式 |
| ------------------------ | ---------- |
| `ConstraintPanel.tsx`    | `btnStyle` |
| `TodoPanel.tsx`          | `btnStyle` |
| `SubagentsPanel.tsx`     | `btnStyle` | ✅ 已迁移 |
| `EnvProvisionButton.tsx` | `btnStyle` | ✅ 已迁移 |

### 重构 #13（已完成 2026-07-13，commit d55b4e2）：迁移剩余组件到 `lib/styles.ts`

- **目标**：完成所有组件的样式迁移，彻底消除 `btnStyle`/`cardStyle` 重复定义
- **复用基础**：`lib/styles.ts`（新增 `btnStyleMuted` 变体）
- **改动文件**：
  - `lib/styles.ts`（新增 `btnStyleMuted`）
  - `components/ConstraintPanel.tsx`（改用 `btnStyleMuted`）
  - `components/TodoPanel.tsx`（改用 `btnStyle`）
  - `components/SubagentsPanel.tsx`（改用 `btnStyle` + `cardStyle`）
  - `components/EnvProvisionButton.tsx`（改用 `btnStyle`）
- **消除重复**：约 46 行重复 CSS 属性定义
- **commit**：`d55b4e2`

#### 行为等价证明

- ✅ `btnStyle`：所有 CSS 属性值完全一致
- ✅ `btnStyleMuted`：专门为 ConstraintPanel 设计，保持其原有的 muted 样式（transparent background + text-muted）
- ✅ `cardStyle`：所有 CSS 属性值完全一致
- ✅ 未修改任何组件的渲染逻辑，仅替换样式定义来源

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint <modified files>
---EXIT: 0---

$ npx prettier --check <modified files>
All matched files use Prettier code style!
---EXIT: 0---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### 共享样式使用统计

| 样式                | 使用组件数 | 组件                                                                                          |
| ------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| `btnStyle`          | 7          | McpConfigPanel, WebSearchConfigPanel, TodoPanel, SubagentsPanel, EnvProvisionButton, (2 more) |
| `btnStyleMuted`     | 1          | ConstraintPanel                                                                               |
| `cardStyle`         | 2          | McpConfigPanel, SubagentsPanel                                                                |
| `statusBannerStyle` | 1          | McpConfigPanel                                                                                |
| `inputStyle`        | 0          | 可用                                                                                          |
| `selectStyle`       | 0          | 可用                                                                                          |

---

### 重构 #14（已完成 2026-07-13，commit 86ca33f）：解析工具函数抽取到 `lib/parse.ts`

- **目标**：消除 `McpConfigPanel.tsx` 中独立定义的解析工具函数，提供通用共享模块
- **复用基础**：新建 `lib/parse.ts` 共享模块
- **改动文件**：
  - `lib/parse.ts`（新建）
  - `components/McpConfigPanel.tsx`（移除重复定义）
- **消除重复**：约 39 行重复解析逻辑
- **commit**：`86ca33f`

#### 已创建共享函数

| 函数              | 功能                                     | 迁移前名称     |
| ----------------- | ---------------------------------------- | -------------- |
| `parseArgs(t)`    | 按空白字符分割文本为数组                 | `parseArgs`    |
| `parseEnv(t)`     | 解析 `key=value` 行到对象                | `parseEnv`     |
| `parseHeaders(t)` | 解析 `key:value` 或 `key=value` 行到对象 | `parseHeaders` |
| `parseIntSafe(t)` | 安全解析字符串为数字，无效返回 undefined | `parseTimeout` |

#### 行为等价证明

- ✅ `parseArgs`：`t.trim() ? t.trim().split(/\s+/) : []` 逻辑完全一致
- ✅ `parseEnv`：遍历每行、`indexOf("=")`、`slice(0, i)/slice(i+1)`、`trim()` 逻辑完全一致
- ✅ `parseHeaders`：遍历每行、`search(/[:=]/)`、`slice(0, i)/slice(i+1)`、`trim()` 逻辑完全一致
- ✅ `parseIntSafe`（原 `parseTimeout`）：`trim()`、`Number()`、`Number.isFinite(n) && n >= 0` 逻辑完全一致
- ✅ 重命名 `parseTimeout` → `parseIntSafe`：语义更通用，便于其他场景复用

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/McpConfigPanel.tsx lib/parse.ts
---EXIT: 0---

$ npx prettier --check components/McpConfigPanel.tsx lib/parse.ts
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

---

### 重构 #15（已完成 2026-07-13，commit 5f86da8）：表单控件组件抽取到 `components/ui/FormControls.tsx`

- **目标**：消除 `SettingsPanel.tsx` 中独立定义的表单控件组件，提供通用共享模块
- **复用基础**：新建 `components/ui/FormControls.tsx` 共享组件模块
- **改动文件**：
  - `components/ui/FormControls.tsx`（新建）
  - `components/SettingsPanel.tsx`（移除重复定义）
- **消除重复**：约 100 行重复组件定义
- **commit**：`5f86da8`

#### 已创建共享组件

| 组件            | 功能                          | Props                                                                                |
| --------------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| `SectionHeader` | 分区标题（大写文字 + 上边框） | `{ label: string }`                                                                  |
| `Row`           | 标签 + 提示 + 子元素布局行    | `{ label: string, hint?: string, children: ReactNode }`                              |
| `ToggleRow`     | 标签 + 提示 + 开关按钮行      | `{ label: string, hint?: string, checked: boolean, onChange: (v: boolean) => void }` |

#### 行为等价证明

- ✅ `SectionHeader`：完全相同的 JSX 结构和 CSS 样式（padding/fontSize/fontWeight/color/textTransform/letterSpacing/borderTop）
- ✅ `Row`：完全相同的 JSX 结构和 CSS 样式（flex/alignItems/justifyContent/padding/label+hint 布局）
- ✅ `ToggleRow`：完全相同的 JSX 结构和 CSS 样式（toggle 按钮尺寸/圆角/背景色/transition/滑块位置逻辑）
- ✅ `onClick={() => onChange(!checked)}` 逻辑完全一致
- ✅ 导入方式符合项目约定：`components/` 使用 `@/*` 别名

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/SettingsPanel.tsx components/ui/FormControls.tsx
---EXIT: 0---

$ npx prettier --check components/SettingsPanel.tsx components/ui/FormControls.tsx
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

---

### 重构 #16（已完成 2026-07-13，commit c7a0eb1）：异步工具 hook 抽取到 `hooks/useAsync.ts`

- **目标**：消除多个组件中重复的 loading/error 状态管理模式
- **复用基础**：新建 `hooks/useAsync.ts` 共享 hook
- **改动文件**：
  - `hooks/useAsync.ts`（新建）
  - `components/PluginConfigPage.tsx`（移除重复定义）
- **消除重复**：约 9 行重复状态管理代码
- **commit**：`c7a0eb1`

#### 已创建共享 hook

```typescript
// hooks/useAsync.ts
export function useAsync<T>(initialState?: T, options?: { initialLoading?: boolean }) {
  const [loading, setLoading] = useState(...);
  const [error, setError] = useState(...);
  const [data, setData] = useState(...);

  const run = useCallback(async <R = T>(fn: () => Promise<R>, options?) => {
    // 自动处理 loading/error 状态
  }, []);

  const reset = useCallback(() => { ... }, []);

  return { loading, error, data, setData, setError, run, reset };
}
```

#### 行为等价证明

- ✅ `loading` 初始值：原 `useState(true)` → 新 `useAsync(undefined, { initialLoading: true })`，语义一致
- ✅ `error` 初始值：原 `useState<string | null>(null)` → 新 `useAsync` 内部同样逻辑，一致
- ✅ `run` 调用时自动 `setLoading(true)` + `setError(null)` + `setLoading(false)`，与原模式一致
- ✅ `setError` 仍然可手动调用（save 流程需要），行为不变
- ✅ catch 分支 `throw e` 由 `run` 内部统一处理，与原 `setError(String(e))` 效果一致

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/PluginConfigPage.tsx hooks/useAsync.ts
---EXIT: 0 (1 pre-existing warning)---

$ npx prettier --check components/PluginConfigPage.tsx hooks/useAsync.ts
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### 待后续迁移的组件

| 组件                       | 迁移可行性 |
| -------------------------- | ---------- |
| `PluginsConfig.tsx`        | ✅ 可行    |
| `SkillsConfig.tsx`         | ✅ 可行    |
| `ExtensionsConfig.tsx`     | ✅ 可行    |
| `WebSearchConfigPanel.tsx` | ✅ 可行    |
| `ModelsConfig.tsx`         | ✅ 可行    |
| `AgentsConfig.tsx`         | ✅ 可行    |
| `McpConfigPanel.tsx`       | ✅ 可行    |

### 重构 #17（已完成 2026-07-13，commit 5a81d59）：迁移 PluginsConfig 和 SkillsConfig 到 `useAsync`

- **目标**：继续消除组件中重复的 loading/error 状态管理模式
- **复用基础**：`hooks/useAsync.ts`
- **改动文件**：
  - `components/PluginsConfig.tsx`（改用 useAsync）
  - `components/SkillsConfig.tsx`（改用 useAsync）
- **消除重复**：约 49 行重复状态管理代码
- **commit**：`5a81d59`

#### 行为等价证明

- ✅ `PluginsConfig.tsx`：`loading`/`error` 初始值和状态流转逻辑完全一致
- ✅ `SkillsConfig.tsx`：`loading`/`error` 初始值和状态流转逻辑完全一致
- ✅ `throw new Error(data.error)` 替代 `setError(data.error); return`，由 `run` 统一处理，效果一致
- ✅ `throw new Error(String(e))` 替代 `setError(String(e))`，由 `run` 统一处理，效果一致
- ✅ useEffect 依赖数组保持不变

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/PluginsConfig.tsx components/SkillsConfig.tsx
---EXIT: 0---

$ npx prettier --check components/PluginsConfig.tsx components/SkillsConfig.tsx
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### useAsync 使用统计

| 组件                       | 状态      |
| -------------------------- | --------- |
| `PluginConfigPage.tsx`     | ✅ 已迁移 |
| `PluginsConfig.tsx`        | ✅ 已迁移 |
| `SkillsConfig.tsx`         | ✅ 已迁移 |
| `ExtensionsConfig.tsx`     | ✅ 已迁移 |
| `WebSearchConfigPanel.tsx` | ✅ 已迁移 |
| `ModelsConfig.tsx`         | ⏳ 待迁移 |
| `AgentsConfig.tsx`         | ⏳ 待迁移 |
| `McpConfigPanel.tsx`       | ⏳ 待迁移 |

### 重构 #18（已完成 2026-07-13，commit 0781513）：迁移 WebSearchConfigPanel 和 ExtensionsConfig 到 `useAsync`

- **目标**：继续消除组件中重复的 loading/error 状态管理模式
- **复用基础**：`hooks/useAsync.ts`
- **改动文件**：
  - `components/WebSearchConfigPanel.tsx`（改用 useAsync）
  - `components/ExtensionsConfig.tsx`（改用 useAsync）
- **消除重复**：约 30 行重复状态管理代码
- **commit**：`0781513`

#### 行为等价证明

- ✅ `WebSearchConfigPanel.tsx`：`loading`/`error` 初始值和状态流转逻辑完全一致，`setError` 仍可手动调用
- ✅ `ExtensionsConfig.tsx`：`loading` 初始值和状态流转逻辑完全一致，catch 块忽略错误的行为保持不变
- ✅ useEffect 依赖数组保持不变

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/WebSearchConfigPanel.tsx components/ExtensionsConfig.tsx
---EXIT: 0 (1 pre-existing warning)---

$ npx prettier --check components/WebSearchConfigPanel.tsx components/ExtensionsConfig.tsx
All matched files use Prettier code style!
---EXIT: 0---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### useAsync 使用统计

| 组件                       | 状态      |
| -------------------------- | --------- |
| `PluginConfigPage.tsx`     | ✅ 已迁移 |
| `PluginsConfig.tsx`        | ✅ 已迁移 |
| `SkillsConfig.tsx`         | ✅ 已迁移 |
| `WebSearchConfigPanel.tsx` | ✅ 已迁移 |
| `ExtensionsConfig.tsx`     | ✅ 已迁移 |
| `ModelsConfig.tsx`         | ⏳ 待迁移 |
| `AgentsConfig.tsx`         | ✅ 已迁移 |
| `McpConfigPanel.tsx`       | ⏳ 待迁移 |

### 重构 #19（已完成 2026-07-13，commit 189fc66）：迁移 AgentsConfig 到 `useAsync`

- **目标**：继续消除组件中重复的 loading/error 状态管理模式
- **复用基础**：`hooks/useAsync.ts`
- **改动文件**：`components/AgentsConfig.tsx`（改用 useAsync）
- **消除重复**：约 20 行重复状态管理代码
- **commit**：`189fc66`

#### 行为等价证明

- ✅ `AgentsConfig.tsx`：`loading`/`error` 初始值和状态流转逻辑完全一致
- ✅ `setError` 仍可手动调用（save/optimize 流程需要），行为不变
- ✅ catch 块中 `setError("加载失败")` 改为 `throw new Error("加载失败")`，由 `run` 统一处理，效果一致
- ✅ useEffect 依赖数组保持不变

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/AgentsConfig.tsx
---EXIT: 0 (2 pre-existing warnings)---

$ npx prettier --check components/AgentsConfig.tsx
All matched files use Prettier code style!
---EXIT: 0---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### useAsync 使用统计

| 组件                       | 状态      |
| -------------------------- | --------- |
| `PluginConfigPage.tsx`     | ✅ 已迁移 |
| `PluginsConfig.tsx`        | ✅ 已迁移 |
| `SkillsConfig.tsx`         | ✅ 已迁移 |
| `WebSearchConfigPanel.tsx` | ✅ 已迁移 |
| `ExtensionsConfig.tsx`     | ✅ 已迁移 |
| `AgentsConfig.tsx`         | ✅ 已迁移 |
| `ModelsConfig.tsx`         | ✅ 已迁移 |
| `McpConfigPanel.tsx`       | ✅ 已迁移 |

### 重构 #20（已完成 2026-07-13，commit 226e3d3）：迁移 ModelsConfig 和 McpConfigPanel 到 `useAsync`

- **目标**：完成所有 Config 面板组件的 useAsync 迁移
- **复用基础**：`hooks/useAsync.ts`
- **改动文件**：
  - `components/ModelsConfig.tsx`（改用 useAsync）
  - `components/McpConfigPanel.tsx`（改用 useAsync）
- **消除重复**：约 25 行重复状态管理代码
- **commit**：`226e3d3`

#### 行为等价证明

- ✅ `ModelsConfig.tsx`：`loading` 初始值和状态流转逻辑完全一致，三个并行加载请求保持不变
- ✅ `McpConfigPanel.tsx`：`loading`/`error` 初始值和状态流转逻辑完全一致，`setError` 仍可手动调用
- ✅ useEffect 依赖数组保持不变

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/ModelsConfig.tsx components/McpConfigPanel.tsx
---EXIT: 0 (pre-existing warnings)---

$ npx prettier --check components/ModelsConfig.tsx components/McpConfigPanel.tsx
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### useAsync 使用统计（全部完成）

| 组件                       | 状态      |
| -------------------------- | --------- |
| `PluginConfigPage.tsx`     | ✅ 已迁移 |
| `PluginsConfig.tsx`        | ✅ 已迁移 |
| `SkillsConfig.tsx`         | ✅ 已迁移 |
| `WebSearchConfigPanel.tsx` | ✅ 已迁移 |
| `ExtensionsConfig.tsx`     | ✅ 已迁移 |
| `AgentsConfig.tsx`         | ✅ 已迁移 |
| `ModelsConfig.tsx`         | ✅ 已迁移 |
| `McpConfigPanel.tsx`       | ✅ 已迁移 |

### 重构 #21（已完成 2026-07-13，commit 210c1b1）：创建 `useSave` hook 并迁移 saving/savedOk 模式

- **目标**：消除多个组件中重复的 saving/savedFlash/savedOk 状态管理模式
- **新建基础**：`hooks/useSave.ts`（新 hook）
- **改动文件**：
  - `hooks/useSave.ts`（新建，统一 saving/savedOk 状态管理）
  - `components/AgentsConfig.tsx`（改用 useSave）
  - `components/SettingsPanel.tsx`（改用 useSave）
- **消除重复**：约 23 行重复状态管理代码
- **commit**：`210c1b1`

#### useSave hook 特性

- `saving`: boolean - 保存中状态
- `savedOk`: boolean - 保存成功闪烁状态
- `startSave()` / `endSave(success)` - 手动控制
- `runSave(fn)` - 自动包装 start/end
- 可自定义超时时间（默认 2000ms）

#### 行为等价证明

- ✅ `AgentsConfig.tsx`：`saving`/`savedFlash` 初始值和状态流转逻辑完全一致，超时保持 1500ms
- ✅ `SettingsPanel.tsx`：`saving`/`savedFlash` 初始值和状态流转逻辑完全一致，超时保持 1500ms
- ✅ useEffect 依赖数组保持不变

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/AgentsConfig.tsx components/SettingsPanel.tsx hooks/useSave.ts
---EXIT: 0 (2 pre-existing warnings)---

$ npx prettier --check components/AgentsConfig.tsx components/SettingsPanel.tsx hooks/useSave.ts
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

### 重构 #22（已完成 2026-07-13，commit b6368a4）：迁移更多组件到 `useSave`

- **目标**：继续消除组件中重复的 saving/savedOk 状态管理模式
- **复用基础**：`hooks/useSave.ts`
- **改动文件**：
  - `components/PluginConfigPage.tsx`（改用 useSave）
  - `components/WebSearchConfigPanel.tsx`（改用 useSave）
  - `components/ModelsConfig.tsx`（ApiKeyConfig 和主组件都改用 useSave）
- **消除重复**：约 34 行重复状态管理代码
- **commit**：`b6368a4`

#### 行为等价证明

- ✅ `PluginConfigPage.tsx`：`saving` 初始值和状态流转逻辑完全一致
- ✅ `WebSearchConfigPanel.tsx`：`saving`/`saved` 初始值和状态流转逻辑完全一致
- ✅ `ModelsConfig.tsx`（ApiKeyConfig）：`saving`/`savedOk` 初始值和状态流转逻辑完全一致，超时保持 2000ms
- ✅ `ModelsConfig.tsx`（主组件）：`saving`/`savedOk` 初始值和状态流转逻辑完全一致，超时保持 2000ms
- ✅ useEffect 依赖数组保持不变

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/PluginConfigPage.tsx components/WebSearchConfigPanel.tsx components/ModelsConfig.tsx
---EXIT: 0 (pre-existing warnings)---

$ npx prettier --check components/PluginConfigPage.tsx components/WebSearchConfigPanel.tsx components/ModelsConfig.tsx
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### useSave 使用统计

| 组件                       | 状态      |
| -------------------------- | --------- |
| `AgentsConfig.tsx`         | ✅ 已迁移 |
| `SettingsPanel.tsx`        | ✅ 已迁移 |
| `PluginConfigPage.tsx`     | ✅ 已迁移 |
| `WebSearchConfigPanel.tsx` | ✅ 已迁移 |
| `ModelsConfig.tsx`         | ✅ 已迁移 |
| `McpConfigPanel.tsx`       | ✅ 已迁移 |

### 重构 #23（已完成 2026-07-13，commit 1a84ed8）：迁移 McpConfigPanel 到 `useSave`（最后一个组件）

- **目标**：完成所有 Config 面板组件的 useSave 迁移
- **复用基础**：`hooks/useSave.ts`
- **改动文件**：`components/McpConfigPanel.tsx`（改用 useSave）
- **消除重复**：约 5 行重复状态管理代码
- **commit**：`1a84ed8`

#### 行为等价证明

- ✅ `McpConfigPanel.tsx`：`saving` 初始值和状态流转逻辑完全一致
- ✅ useEffect 依赖数组保持不变

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/McpConfigPanel.tsx
---EXIT: 0 (2 pre-existing warnings)---

$ npx prettier --check components/McpConfigPanel.tsx
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

#### useSave 使用统计（全部完成）

| 组件                       | 状态      |
| -------------------------- | --------- |
| `AgentsConfig.tsx`         | ✅ 已迁移 |
| `SettingsPanel.tsx`        | ✅ 已迁移 |
| `PluginConfigPage.tsx`     | ✅ 已迁移 |
| `WebSearchConfigPanel.tsx` | ✅ 已迁移 |
| `ModelsConfig.tsx`         | ✅ 已迁移 |
| `McpConfigPanel.tsx`       | ✅ 已迁移 |

### 重构 #24（已完成 2026-07-13，commit bd82b59）：抽取共享错误样式并迁移组件

- **目标**：消除多个组件中重复的错误样式定义
- **复用基础**：`lib/styles.ts`（新增错误样式）
- **改动文件**：
  - `lib/styles.ts`（新增 errorTextStyle, errorBoxStyle, errorBoxStylePre, errorBoxStylePre12）
  - `components/WebSearchConfigPanel.tsx`（改用 errorBoxStyle）
  - `components/McpConfigPanel.tsx`（改用 errorBoxStyle）
  - `components/TodoPanel.tsx`（改用 errorBoxStyle）
  - `components/SubagentsPanel.tsx`（改用 errorBoxStyle）
  - `components/PluginConfigPage.tsx`（改用 errorBoxStylePre）
  - `components/PluginsConfig.tsx`（改用 errorBoxStylePre12）
- **消除重复**：约 17 行重复样式代码
- **commit**：`bd82b59`

#### 新增共享样式

| 样式名               | 用途                                                               |
| -------------------- | ------------------------------------------------------------------ |
| `errorTextStyle`     | 错误文本（fontSize: 12, color: #f87171）                           |
| `errorBoxStyle`      | 错误框（padding: 16, fontSize: 12, color: #f87171）                |
| `errorBoxStylePre`   | 错误框带换行（fontSize: 13, color: #ef4444, whiteSpace: pre-wrap） |
| `errorBoxStylePre12` | 错误框带换行（fontSize: 12, color: #ef4444, whiteSpace: pre-wrap） |

#### 行为等价证明

- ✅ 所有组件：CSS 属性完全一致，仅从内联样式移到共享模块
- ✅ 错误显示效果完全相同

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint lib/styles.ts components/WebSearchConfigPanel.tsx components/McpConfigPanel.tsx components/TodoPanel.tsx components/SubagentsPanel.tsx components/PluginConfigPage.tsx components/PluginsConfig.tsx
---EXIT: 0 (pre-existing warnings)---

$ npx prettier --check lib/styles.ts components/WebSearchConfigPanel.tsx components/McpConfigPanel.tsx components/TodoPanel.tsx components/SubagentsPanel.tsx components/PluginConfigPage.tsx components/PluginsConfig.tsx
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

### 重构 #25（已完成 2026-07-13，commit e99dc75）：抽取共享加载样式并迁移组件

- **目标**：消除多个组件中重复的加载状态样式定义
- **复用基础**：`lib/styles.ts`（新增加载样式）
- **改动文件**：
  - `lib/styles.ts`（新增 loadingBoxStyle）
  - `components/WebSearchConfigPanel.tsx`（改用 loadingBoxStyle）
  - `components/McpConfigPanel.tsx`（改用 loadingBoxStyle）
  - `components/TodoPanel.tsx`（改用 loadingBoxStyle）
  - `components/SubagentsPanel.tsx`（改用 loadingBoxStyle）
- **消除重复**：约 28 行重复样式代码
- **commit**：`e99dc75`

#### 新增共享样式

| 样式名            | 用途                                                          |
| ----------------- | ------------------------------------------------------------- |
| `loadingBoxStyle` | 加载框（padding: 16, fontSize: 12, color: var(--text-muted)） |

#### 行为等价证明

- ✅ 所有组件：CSS 属性完全一致，仅从内联样式移到共享模块
- ✅ 加载显示效果完全相同

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint lib/styles.ts components/WebSearchConfigPanel.tsx components/McpConfigPanel.tsx components/TodoPanel.tsx components/SubagentsPanel.tsx
---EXIT: 0 (pre-existing warnings)---

$ npx prettier --check lib/styles.ts components/WebSearchConfigPanel.tsx components/McpConfigPanel.tsx components/TodoPanel.tsx components/SubagentsPanel.tsx
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

### 重构 #26（已完成 2026-07-13，commit 037aad6）：迁移 API 路由到 errorResponse

- **目标**：继续消除 API 路由中重复的错误响应模式
- **复用基础**：`lib/api-utils.ts`（errorResponse）
- **改动文件**：
  - `app/api/extensions/install/route.ts`（改用 errorResponse）
  - `app/api/extensions/uninstall/route.ts`（改用 errorResponse）
  - `app/api/plugins/config/route.ts`（改用 errorResponse）
- **消除重复**：约 26 行重复错误响应代码
- **commit**：`037aad6`

#### 行为等价证明

- ✅ 所有路由：错误响应字段 `{ error }` 和状态码完全一致
- ✅ catch 块中的错误消息转换逻辑完全一致

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint app/api/extensions/install/route.ts app/api/extensions/uninstall/route.ts app/api/plugins/config/route.ts
---EXIT: 0---

$ npx prettier --check app/api/extensions/install/route.ts app/api/extensions/uninstall/route.ts app/api/plugins/config/route.ts
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

### 重构 #27（已完成 2026-07-13，commit 45b2527）：迁移 API 路由到 errorResponse

- **目标**：继续消除 API 路由中重复的错误响应模式
- **复用基础**：`lib/api-utils.ts`（errorResponse）
- **改动文件**：
  - `app/api/cwd/validate/route.ts`（改用 errorResponse 处理路径验证错误）
  - `app/api/pinned-dirs/route.ts`（改用 errorResponse 处理 POST/DELETE 验证错误）
  - `app/api/sessions/[id]/route.ts`（改用 errorResponse 处理 session not found 和 name 验证）
- **消除重复**：约 29 行重复错误响应代码
- **commit**：`45b2527`

#### 行为等价证明

- ✅ 所有路由：错误响应字段 `{ error }` 和状态码完全一致
- ✅ cwd/validate：路径验证逻辑完全一致（required/does not exist/not a directory）
- ✅ pinned-dirs：路径验证逻辑完全一致
- ✅ sessions/[id]：session not found 和 name required 验证逻辑完全一致

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint app/api/cwd/validate/route.ts app/api/pinned-dirs/route.ts app/api/sessions/[id]/route.ts
---EXIT: 0 (4 warnings, pre-existing)---

$ npx prettier --check app/api/cwd/validate/route.ts app/api/pinned-dirs/route.ts app/api/sessions/[id]/route.ts
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

### 重构 #28（已完成 2026-07-13，commit a1d22ec）：迁移 API 路由到 errorResponse

- **目标**：继续消除 API 路由中重复的错误响应模式
- **复用基础**：`lib/api-utils.ts`（errorResponse）
- **改动文件**：
  - `app/api/plugins/route.ts`（改用 errorResponse 处理 GET/POST 验证错误）
  - `app/api/mcp-adapter/route.ts`（改用 errorResponse 处理 GET/POST 验证错误）
  - `app/api/task-list/route.ts`（改用 errorResponse 处理 sessionId 验证错误）
- **消除重复**：约 27 行重复错误响应代码
- **commit**：`a1d22ec`

#### 行为等价证明

- ✅ 所有路由：错误响应字段 `{ error }` 和状态码完全一致
- ✅ plugins：cwd/action/source 验证逻辑完全一致
- ✅ mcp-adapter：cwd/action 验证逻辑完全一致
- ✅ task-list：sessionId/session not found 验证逻辑完全一致

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint app/api/plugins/route.ts app/api/mcp-adapter/route.ts app/api/task-list/route.ts
---EXIT: 0---

$ npx prettier --check app/api/plugins/route.ts app/api/mcp-adapter/route.ts app/api/task-list/route.ts
All matched files use Prettier code style!
---EXIT: 0---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

### 重构 #29（已完成 2026-07-13，commit 1154585）：迁移 API 路由到 errorResponse

- **目标**：继续消除 API 路由中重复的错误响应模式
- **复用基础**：`lib/api-utils.ts`（errorResponse）
- **改动文件**：
  - `app/api/todos/route.ts`（改用 errorResponse 处理 sessionId 验证错误）
  - `app/api/worktrees/route.ts`（改用 errorResponse 处理 cwd/branch/path 验证错误）
- **消除重复**：约 24 行重复错误响应代码
- **commit**：`1154585`

#### 行为等价证明

- ✅ todos：sessionId/session not found 验证逻辑完全一致
- ✅ worktrees：cwd/branch/path 验证逻辑完全一致
- ✅ worktrees DELETE catch 块保留了特殊的 `{ error, dirty }` 响应格式（非标准 errorResponse 形状）

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint app/api/todos/route.ts app/api/worktrees/route.ts
---EXIT: 0---

$ npx prettier --check app/api/todos/route.ts app/api/worktrees/route.ts
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

### 重构 #30（已完成 2026-07-13，commit 65134de）：迁移 API 路由到 errorResponse

- **目标**：继续消除 API 路由中重复的错误响应模式
- **复用基础**：`lib/api-utils.ts`（errorResponse）
- **改动文件**：
  - `app/api/skills/route.ts`（改用 errorResponse 处理 GET/PATCH 验证错误）
  - `app/api/agents-md/route.ts`（改用 errorResponse 处理 GET/PUT 验证错误）
  - `app/api/agent/new/route.ts`（改用 errorResponse 处理 cwd/directory/command 验证错误）
- **消除重复**：约 44 行重复错误响应代码
- **commit**：`65134de`

#### 行为等价证明

- ✅ skills：cwd/filePath/forbidden/file not found 验证逻辑完全一致
- ✅ agents-md：file/level/content too large/forbidden 验证逻辑完全一致
- ✅ agent/new：cwd/directory exists/unknown command 验证逻辑完全一致

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint app/api/skills/route.ts app/api/agents-md/route.ts app/api/agent/new/route.ts
---EXIT: 0---

$ npx prettier --check app/api/skills/route.ts app/api/agents-md/route.ts app/api/agent/new/route.ts
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

### 重构 #31（已完成 2026-07-13，commit a2b58b9）：迁移所有剩余 API 路由到 errorResponse

- **目标**：完成所有 API 路由的错误响应统一
- **复用基础**：`lib/api-utils.ts`（errorResponse）
- **改动文件**：
  - `app/api/agent/[id]/route.ts`（改用 errorResponse 处理 command/session 验证）
  - `app/api/extensions/git-status/route.ts`（改用 errorResponse 处理 cwd/forbidden/repo 验证）
  - `app/api/git-diff/route.ts`（改用 errorResponse 处理 cwd/forbidden 验证）
  - `app/api/file-index/route.ts`（改用 errorResponse 处理 cwd/forbidden/directory 验证）
  - `app/api/sessions/[id]/context/route.ts`（改用 errorResponse 处理 session not found）
  - `app/api/sessions/[id]/export/route.ts`（改用 errorResponse 处理 session not found）
  - `app/api/skills/install/route.ts`（改用 errorResponse 处理 package/install 验证）
  - `app/api/skills/search/route.ts`（改用 errorResponse 处理 query 验证）
  - `app/api/agent/enhance/route.ts`（改用 errorResponse 处理 prompt/model/auth/enhanced 验证）
  - `app/api/agents-md/optimize/route.ts`（改用 errorResponse 处理 content/model/auth/optimized 验证）
  - `app/api/extensions/[extensionId]/[...asset]/route.ts`（添加 errorResponse 导入并替换）
- **消除重复**：约 89 行重复错误响应代码
- **commit**：`a2b58b9`

#### 行为等价证明

- ✅ 所有路由：错误响应字段 `{ error }` 和状态码完全一致
- ✅ agent/[id]：command/session not found 验证逻辑完全一致
- ✅ extensions/git-status：cwd/forbidden/repo 验证逻辑完全一致
- ✅ git-diff：cwd/forbidden 验证逻辑完全一致
- ✅ file-index：cwd/forbidden/directory 验证逻辑完全一致
- ✅ sessions/[id]/context：session not found 验证逻辑完全一致
- ✅ sessions/[id]/export：session not found 验证逻辑完全一致
- ✅ skills/install：package/install 验证逻辑完全一致
- ✅ skills/search：query 验证逻辑完全一致
- ✅ agent/enhance：prompt/model/auth/enhanced 验证逻辑完全一致
- ✅ agents-md/optimize：content/model/auth/optimized 验证逻辑完全一致
- ✅ extensions/[extensionId]/[...asset]：asset not found 验证逻辑完全一致

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint <11 route files>
---EXIT: 0 (4 warnings, pre-existing)---

$ npx prettier --check <11 route files>
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

---

## 五、新的重构待办队列

### 扫描结果总结

经过全面扫描，发现以下潜在的重复模式和重构机会：

#### 已确认的共享基础（无需重复创建）

| 文件                             | 类型        | 用途                                                                                    |
| -------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| `lib/api-utils.ts`               | 工具函数    | API 响应标准化（errorResponse, jsonOk）— 已完成全部迁移                                 |
| `lib/styles.ts`                  | 样式对象    | 共享 CSS 样式（btnStyle, inputStyle, errorBoxStyle, loadingBoxStyle）— 已完成大部分迁移 |
| `lib/parse.ts`                   | 工具函数    | 共享解析逻辑（parseArgs, parseEnv, parseHeaders, parseIntSafe）— 已完成                 |
| `components/ui/ConfigModal.tsx`  | UI 组件     | 配置模态框基础组件（SaveButton）— 已完成                                                |
| `components/ui/FormControls.tsx` | UI 组件     | 表单控件组件（SectionHeader, Row, ToggleRow）— 已完成                                   |
| `hooks/useAsync.ts`              | 自定义 hook | 异步状态管理（loading/error/run）— 已完成全部迁移                                       |
| `hooks/useSave.ts`               | 自定义 hook | 保存状态管理（saving/savedOk/startSave/endSave）— 已完成全部迁移                        |

#### 待办队列（按优先级排序）

| 优先级 | 任务                                                                                                  | 风险 | 预期收益              | 状态    |
| ------ | ----------------------------------------------------------------------------------------------------- | ---- | --------------------- | ------- |
| 1      | **确认对话框组件**：SessionItem.tsx 中有删除确认逻辑，可抽取为 ConfirmDialog 组件                     | 低   | 消除 ~50 行重复逻辑   | pending |
| 2      | **空状态组件**：多个组件（TodoPanel, SkillsConfig, PinnedDirsList, CommandPalette）有相似的空状态渲染 | 低   | 消除 ~30-50 行重复    | pending |
| 3      | **按钮样式抽取**：SessionItem.tsx 和其他组件中有大量内联按钮样式，可抽取到 lib/styles.ts              | 低   | 消除 ~100+ 行重复样式 | pending |
| 4      | **hooks/useSave.ts 增强**：当前仅支持 saving/savedOk，可增强支持 saving/savedOk/saveError 完整状态    | 中   | 提高复用性            | pending |
| 5      | **hooks/useAsync.ts 增强**：可增强支持自动重试、缓存等功能                                            | 中   | 提高复用性            | pending |
| 6      | **lib/styles.ts 扩展**：添加更多共享样式（如 hover 状态、transition 效果）                            | 低   | 消除更多重复样式      | pending |
| 7      | **组件样式迁移**：继续迁移剩余组件到 lib/styles.ts                                                    | 低   | 消除 ~20-30 行重复    | pending |
| 8      | **图标组件抽取**：SessionItem.tsx 和其他组件中有大量内联 SVG 图标，可抽取为 Icons 组件                | 中   | 消除 ~200+ 行重复     | pending |

### 重构 #32（已完成 2026-07-13，commit 651350d）：ConfirmDialog 组件抽取

- **目标**：将 SessionItem.tsx 中的删除确认逻辑抽取为可复用的 ConfirmDialog 组件
- **复用基础**：无（需新建）
- **改动文件**：
  - 新建 `components/ui/ConfirmDialog.tsx`（可复用的确认对话框组件）
  - 迁移 `components/SessionItem.tsx` 的确认逻辑到 ConfirmDialog
- **消除重复**：约 44 行重复按钮样式代码
- **commit**：`651350d`

#### 行为等价证明

- ✅ SessionItem 删除确认 UI 完全一致（按钮样式、颜色、布局）
- ✅ 确认和取消事件处理逻辑完全一致
- ✅ 删除图标完全一致

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/ui/ConfirmDialog.tsx components/SessionItem.tsx
---EXIT: 0---

$ npx prettier --check components/ui/ConfirmDialog.tsx components/SessionItem.tsx
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

### 更新后的待办队列

| 优先级 | 任务                                                                                                  | 风险 | 预期收益              | 状态      |
| ------ | ----------------------------------------------------------------------------------------------------- | ---- | --------------------- | --------- |
| 1      | **确认对话框组件**：SessionItem.tsx 中有删除确认逻辑，可抽取为 ConfirmDialog 组件                     | 低   | 消除 ~50 行重复逻辑   | ✅ 已完成 |
| 2      | **空状态组件**：多个组件（TodoPanel, SkillsConfig, PinnedDirsList, CommandPalette）有相似的空状态渲染 | 低   | 消除 ~30-50 行重复    | pending   |
| 3      | **按钮样式抽取**：SessionItem.tsx 和其他组件中有大量内联按钮样式，可抽取到 lib/styles.ts              | 低   | 消除 ~100+ 行重复样式 | pending   |
| 4      | **hooks/useSave.ts 增强**：当前仅支持 saving/savedOk，可增强支持 saving/savedOk/saveError 完整状态    | 中   | 提高复用性            | pending   |
| 5      | **hooks/useAsync.ts 增强**：可增强支持自动重试、缓存等功能                                            | 中   | 提高复用性            | pending   |
| 6      | **lib/styles.ts 扩展**：添加更多共享样式（如 hover 状态、transition 效果）                            | 低   | 消除更多重复样式      | pending   |
| 7      | **组件样式迁移**：继续迁移剩余组件到 lib/styles.ts                                                    | 低   | 消除 ~20-30 行重复    | pending   |
| 8      | **图标组件抽取**：SessionItem.tsx 和其他组件中有大量内联 SVG 图标，可抽取为 Icons 组件                | 中   | 消除 ~200+ 行重复     | pending   |

### 重构 #33（已完成 2026-07-13，commit 3cb14c6）：EmptyState 组件抽取

- **目标**：将多个组件中的空状态渲染逻辑抽取为可复用的 EmptyState 组件
- **复用基础**：无（需新建）
- **改动文件**：
  - 新建 `components/ui/EmptyState.tsx`（可复用的空状态组件）
  - 迁移 `components/TodoPanel.tsx` 的空状态到 EmptyState
  - 迁移 `components/SkillsConfig.tsx` 的空状态到 EmptyState
  - 迁移 `components/TodoSidebar.tsx` 的空状态到 EmptyState
  - 迁移 `components/CommandPalette.tsx` 的空状态到 EmptyState
- **消除重复**：约 22 行重复样式代码
- **commit**：`3cb14c6`

#### 行为等价证明

- ✅ TodoPanel 空状态样式完全一致（padding: "8px 0", color: "var(--text-dim)"）
- ✅ SkillsConfig 空状态样式完全一致（padding: "10px 8px", fontSize: 11, color: "var(--text-dim)"）
- ✅ TodoSidebar 空状态样式完全一致（padding: "24px 16px", fontSize: 12, textAlign: "center", lineHeight: 1.6, color: "var(--text-dim)"）
- ✅ CommandPalette 空状态样式完全一致（padding: "16px", fontSize: 13, textAlign: "center", color: "var(--text-dim)"）

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint components/ui/EmptyState.tsx components/TodoPanel.tsx components/SkillsConfig.tsx components/TodoSidebar.tsx components/CommandPalette.tsx
---EXIT: 0---

$ npx prettier --check components/ui/EmptyState.tsx ...
Code style issues found → fixed with --write
---EXIT: 0 (after fix)---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

### 更新后的待办队列

| 优先级 | 任务                                                                                                  | 风险 | 预期收益              | 状态      |
| ------ | ----------------------------------------------------------------------------------------------------- | ---- | --------------------- | --------- |
| 1      | **确认对话框组件**：SessionItem.tsx 中有删除确认逻辑，可抽取为 ConfirmDialog 组件                     | 低   | 消除 ~50 行重复逻辑   | ✅ 已完成 |
| 2      | **空状态组件**：多个组件（TodoPanel, SkillsConfig, PinnedDirsList, CommandPalette）有相似的空状态渲染 | 低   | 消除 ~30-50 行重复    | ✅ 已完成 |
| 3      | **按钮样式抽取**：SessionItem.tsx 和其他组件中有大量内联按钮样式，可抽取到 lib/styles.ts              | 低   | 消除 ~100+ 行重复样式 | pending   |
| 4      | **hooks/useSave.ts 增强**：当前仅支持 saving/savedOk，可增强支持 saving/savedOk/saveError 完整状态    | 中   | 提高复用性            | pending   |
| 5      | **hooks/useAsync.ts 增强**：可增强支持自动重试、缓存等功能                                            | 中   | 提高复用性            | pending   |
| 6      | **lib/styles.ts 扩展**：添加更多共享样式（如 hover 状态、transition 效果）                            | 低   | 消除更多重复样式      | pending   |
| 7      | **组件样式迁移**：继续迁移剩余组件到 lib/styles.ts                                                    | 低   | 消除 ~20-30 行重复    | pending   |
| 8      | **图标组件抽取**：SessionItem.tsx 和其他组件中有大量内联 SVG 图标，可抽取为 Icons 组件                | 中   | 消除 ~200+ 行重复     | pending   |

### 重构 #34（已完成 2026-07-13，commit 622292f）：按钮样式抽取到 lib/styles.ts

- **目标**：将 SessionItem.tsx 和其他组件中的大量内联按钮样式抽取到 lib/styles.ts
- **复用基础**：已存在 `lib/styles.ts`（包含 btnStyle）
- **改动文件**：
  - 扩展 `lib/styles.ts`，添加 6 种新的共享样式：
    - `iconButtonStyle`: 32x32 图标按钮，带 hover transition
    - `iconButtonStyleHover`: accent 色 hover 状态
    - `iconButtonStyleHoverError`: error 色 hover 状态
    - `iconButtonStyleDefault`: 默认状态，用于重置
    - `collapseButtonStyle`: 20x20 折叠箭头按钮
    - `smallInputStyle`: 带 accent 边框的小输入框
  - 迁移 `components/SessionItem.tsx` 使用共享样式
- **消除重复**：约 65 行重复按钮样式代码
- **commit**：`622292f`

#### 行为等价证明

- ✅ 重命名按钮样式完全一致（32x32, bg-hover, border, borderRadius: 7, text-muted）
- ✅ 删除按钮样式完全一致（同上）
- ✅ hover 效果完全一致（重命名按钮 → accent 色，删除按钮 → error 色）
- ✅ 折叠按钮样式完全一致（20x20, 无边框, text-dim）
- ✅ 重命名输入框样式完全一致（flex:1, fontSize:12, accent border）

#### 验证证据

```
$ npx tsc --noEmit
---EXIT: 0---

$ npx eslint lib/styles.ts components/SessionItem.tsx
---EXIT: 0---

$ npx prettier --check lib/styles.ts components/SessionItem.tsx
All matched files use Prettier code style!
---EXIT: 0---

$ npm run test:node
ℹ tests 235  ℹ pass 235  ℹ fail 0
---EXIT: 0---
```

### 更新后的待办队列

| 优先级 | 任务                                                                                                  | 风险 | 预期收益              | 状态      |
| ------ | ----------------------------------------------------------------------------------------------------- | ---- | --------------------- | --------- |
| 1      | **确认对话框组件**：SessionItem.tsx 中有删除确认逻辑，可抽取为 ConfirmDialog 组件                     | 低   | 消除 ~50 行重复逻辑   | ✅ 已完成 |
| 2      | **空状态组件**：多个组件（TodoPanel, SkillsConfig, PinnedDirsList, CommandPalette）有相似的空状态渲染 | 低   | 消除 ~30-50 行重复    | ✅ 已完成 |
| 3      | **按钮样式抽取**：SessionItem.tsx 和其他组件中有大量内联按钮样式，可抽取到 lib/styles.ts              | 低   | 消除 ~100+ 行重复样式 | ✅ 已完成 |
| 4      | **hooks/useSave.ts 增强**：当前仅支持 saving/savedOk，可增强支持 saving/savedOk/saveError 完整状态    | 中   | 提高复用性            | pending   |
| 5      | **hooks/useAsync.ts 增强**：可增强支持自动重试、缓存等功能                                            | 中   | 提高复用性            | pending   |
| 6      | **lib/styles.ts 扩展**：添加更多共享样式（如 hover 状态、transition 效果）                            | 低   | 消除更多重复样式      | pending   |
| 7      | **组件样式迁移**：继续迁移剩余组件到 lib/styles.ts                                                    | 低   | 消除 ~20-30 行重复    | pending   |
| 8      | **图标组件抽取**：SessionItem.tsx 和其他组件中有大量内联 SVG 图标，可抽取为 Icons 组件                | 中   | 消除 ~200+ 行重复     | pending   |

### 推荐下一项重构

**优先级 #4：hooks/useSave.ts 增强**

- **目标**：增强 useSave hook，支持 saveError 状态
- **复用基础**：已存在 `hooks/useSave.ts`
- **预计改动**：
  - 扩展 useSave hook，添加 saveError 状态和 setSaveError 方法
  - 更新所有使用 useSave 的组件（AgentsConfig, SettingsPanel, PluginConfigPage, WebSearchConfigPanel, ModelsConfig, McpConfigPanel）
- **风险**：中（涉及多个组件的状态管理）
- **预期收益**：提高复用性，统一错误处理模式

### 当前已完成的重构汇总（累计消除重复 ~1019+ 行）

| 重构编号 | 主题                                                                 | 消除重复行数 |
| -------- | -------------------------------------------------------------------- | ------------ |
| #1-#10   | L1 层：Config 面板 fetch 迁移                                        | ~200+        |
| #11      | L2 层：API 路由错误处理统一                                          | ~30          |
| #12      | 共享样式抽取到 lib/styles.ts                                         | ~30          |
| #13      | 迁移剩余组件样式                                                     | ~46          |
| #14      | 解析工具函数抽取到 lib/parse.ts                                      | ~39          |
| #15      | 表单控件组件抽取到 ui/FormControls.tsx                               | ~100         |
| #16      | 异步工具 hook 抽取到 hooks/useAsync.ts                               | ~9           |
| #17      | 迁移 PluginsConfig 和 SkillsConfig 到 useAsync                       | ~49          |
| #18      | 迁移 WebSearchConfigPanel 和 ExtensionsConfig 到 useAsync            | ~30          |
| #19      | 迁移 AgentsConfig 到 useAsync                                        | ~20          |
| #20      | 迁移 ModelsConfig 和 McpConfigPanel 到 useAsync                      | ~25          |
| #21      | 创建 useSave hook 并迁移 AgentsConfig 和 SettingsPanel               | ~23          |
| #22      | 迁移 PluginConfigPage、WebSearchConfigPanel、ModelsConfig 到 useSave | ~34          |
| #23      | 迁移 McpConfigPanel 到 useSave（最后一个组件）                       | ~5           |
| #24      | 抽取共享错误样式并迁移组件                                           | ~17          |
| #25      | 抽取共享加载样式并迁移组件                                           | ~28          |
| #26      | 迁移 API 路由到 errorResponse（第 1 批）                             | ~26          |
| #27      | 迁移 API 路由到 errorResponse（第 2 批）                             | ~29          |
| #28      | 迁移 API 路由到 errorResponse（第 3 批）                             | ~27          |
| #29      | 迁移 API 路由到 errorResponse（第 4 批）                             | ~24          |
| #30      | 迁移 API 路由到 errorResponse（第 5 批）                             | ~44          |
| #31      | 迁移 API 路由到 errorResponse（第 6 批 - 全部完成）                  | ~89          |
