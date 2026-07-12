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

### 重构 #1（已完成 2026-07-13）：`PluginConfigPage.tsx` `load()` 迁移到 `csrfFetchJson`

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

---

## 五、下一会话起点

完成本轮 `PluginConfigPage.tsx` 重构后，下一会话应从 **L1-2：`EnvProvisionButton.tsx` `buildFullInventory()` 迁移** 开始——同一 Cluster、同样低风险、复用同一基础。
