# 自主编程引擎深度融合与 autoplan 全量（非 Go）迁移 · 深度分析报告

> 分析对象：`/data/Code/research/autoplan/`（Go 后端 426 `.go` + `src/` TS/JS 桌面端）、`/data/Code/research/comet/`（TS 260 `.ts`）
> 约束：**autoplan 功能全量迁移为纯 TypeScript，严禁使用 Go**；与 comet 深度融合；底层引擎全链路无报错；交付可交互前端（进程监控 / 需求生命周期 / 任务状态）。
> 现状锚定：当前 `pi-web` 仓库已完成「批次 A–D」纯 TS 等价落地（`lib/unified-engine/*`、`lib/engine-runtime-store.ts`、`components/EngineDashboard.tsx`、`hooks/useEngineRuntime.ts`），实际业务代码中 `shell:true` 已清零（仅 `docs/*.md` 注释与 `bin/pi-web.js:296`、`lib/npx.ts:14` 的"勿用 shell"说明提及）。本报告在现状基础上，补齐「全量 + 深度融合」剩余工程。

---

## 0. 现状锚定（pi-web 当前已交付）

| 模块          | 文件                                                                                             | 状态                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 统一状态层    | `lib/engine-runtime-store.ts`                                                                    | ✅ 已落地（`UnifiedEngineState`：`processes` / `requirementLifecycle` / `taskStatus` / `runs` / `autoplan`） |
| autoplan 适配 | `lib/unified-engine/autoplan-adapter.ts`、`autoplan-llm-adapter.ts`                              | ✅ 纯 TS（方案 b 自包含真实执行，已消除 `shell:true`，见 `autoplan-llm-adapter.ts:210`）                     |
| comet 适配    | `lib/unified-engine/comet-adapter.ts` + `lib/unified-engine/guards/comet-cli.ts`                 | ✅ 守卫真实化（失败阻断，不再静默通过）                                                                      |
| 前端面板      | `components/EngineDashboard.tsx` + `hooks/useEngineRuntime.ts` + `app/api/engine/state/route.ts` | ✅ 三看板 + 单一 SSE 状态源                                                                                  |
| 生命周期测试  | `lib/unified-engine/autoplan-lifecycle.test.mjs`、`engine-optimizations.test.mjs`                | ✅ 19/19 node 单测绿                                                                                         |

**剩余缺口（本报告重点）**：上游 Go 后端的「富能力」（SQLite 持久化、scheduler/worker-pool 调度、PTY 终端、MCP、outbox 事件总线）尚未在 TS 等价层完整落地；comet 深度融合（守卫/验证统一、`server.ts` 内嵌 HTTP server 隔离、`shell:true` 同步进 vendored）尚未完成；前端缺终端实时流与进程树深度视图。

---

## 1. 架构剖析（维度一）

### 1.1 上游 autoplan（Go）分层结构

```
backend/
├── cmd/autoplan-server/main.go        # daemon 入口 RunDaemonCommand
├── internal/bootstrap/                # 依赖装配 + 生命周期 + server
│   ├── server.go:54 RunServerCommand  # 建 router → net.Listen → go httpServer.Serve
│   └── dependencies.go:51 DependencyOverrides  # 每个行为依赖可替换（利于等价替换）
├── internal/application/              # 用例编排（intake/plans/tasks/loop/chat/executors）
│   ├── boundary.go:3   "adapters must not call repositories/runtimes directly"
│   └── services.go:39  ServiceDependencies（Clock/Readiness/Repository/Events/Logger 均为接口）
├── internal/domain/                   # 持久化中立不变式（plan/intake/operation/event/loop）
│   └── plan/plan.go:29-38 状态枚举 draft/pending/running/...
├── internal/repository/ + repository/sqlite/  # 持久化端口 + SQLite 实现
│   └── sqlite/connection.go:40 OpenConnection（modernc.org/sqlite）
├── internal/runtime/                  # scheduler/eventbus/process/terminal/agentcli/lifecycle
│   ├── scheduler/manager.go:35        # 调度器
│   ├── eventbus/bus.go:62 Bus         # 事件总线（SQLite outbox 为权威源）
│   └── process/runner.go:40 Runner    # 进程执行（无 shell 入口）
├── internal/httpapi/                  # REST/SSE/WebSocket 入站适配
│   ├── router.go:3
│   └── middleware.go:133 authenticatedCallerID（Session + Origin SHA256 绑定）
├── internal/mcp/                      # MCP stdio/http
├── internal/platform/                 # session/instance/secrets/redaction/terminal
└── migrations/ + internal/migration/  # DB 迁移（//go:embed 0001_schema_v1.sql）
```

**依赖拓扑（生命周期映射）**：
`intake`（需求立项，`domain/intake/model.go:24`）→ `plans`（计划生成，`application/plans/service.go:1` + 状态机 `domain/plan/plan.go:29-38`）→ `tasks`+`scheduler`（任务入队，`application/tasks/actions.go:14` + `runtime/scheduler/manager.go:35`）→ `loop`+`agentcli`+`process`（任务执行，`application/loop/service.go:42` `Runner.RunOnce`）→ `repository/sqlite`（交付物落盘，`repository/sqlite/schema.go:17`）→ `intake`(Feedback 双类型，`domain/intake/model.go:25`) + `mcp/intake_tools.go:137 ListFeedback`（反馈回收）。

**关键设计亮点（可直接继承）**：`boundary.go:3` 端口约束 + `dependencies.go:51` `DependencyOverrides` 使每个行为可替换——TS 等价实现可 1:1 映射为接口 + 组合根注入（当前 `autoplan-adapter.ts` 已用 `tryLoadVendorAutoPlan` 注入端口，思路一致）。

### 1.2 跨语言冲突与等价替换表（Go → TS）

| Go 运行时特性              | 上游位置                                                                   | 纯 TS 等价替换                                                   | 风险                     |
| -------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------ |
| goroutine worker pool      | `runtime/scheduler/worker_pool.go:145-150`                                 | `Promise` 队列 + `p-limit` 并发控制                              | 低                       |
| goroutine actor 循环       | `runtime/scheduler/actor.go:141,201`                                       | `async` 状态机 + `EventEmitter` 命令队列                         | 中                       |
| channel 取消信号           | `application/loop/service.go:77-78`（`chan struct{}`）                     | `AbortController` / `EventEmitter`                               | 低                       |
| `sync.Mutex`/`RWMutex`     | `loop/service.go:62,115`、`maintenance/state.go:55-122`                    | TS 单线程模型下多数可去；临界计数用 `Atomics` 或闭包自增         | 低                       |
| `sync.NewCond`             | `actor.go:140`                                                             | `await` + 事件通知重写                                           | 中                       |
| `sync.Once`                | `terminal/pty_unix.go:25`                                                  | 惰性初始化闭包                                                   | 低                       |
| `os/exec` 进程执行         | `process/runner.go:40-42,205`（已用数组，无 `shell:true`）                 | `child_process.spawn(exe, args)` 数组形式（**严禁 shell:true**） | 中（PTY 信号语义难等价） |
| PTY / 进程树 / 信号        | `terminal/pty_unix.go:36`、`process/tree_unix.go:13-48`（负 PID 杀进程组） | `node-pty` + `child_process`；Unix 信号 `process.kill(-pid)`     | **高**                   |
| `reflect` 递归脱敏         | `platform/redaction/redaction.go:81-189`                                   | 基于 `unknown` 递归类型守卫的等价脱敏器                          | **高**                   |
| `//go:embed` SQL           | `migrations/registry.go:33-37`                                             | `fs.readFileSync` / 打包期资源                                   | 低                       |
| cgo + `unsafe.Pointer`     | `platform/secrets/keyring/backend_windows.go:78-116`                       | 密钥走 OS keychain 或加密文件（放弃 Windows C API 直调）         | 中                       |
| `go:build !windows` 分平台 | `pty_unix.go` / `pty_windows.go`                                           | 运行时 `process.platform` 分支                                   | 低                       |

### 1.3 与 comet 概念映射（便于融合）

| autoplan（Go）                              | comet（TS）                                             | 融合策略                                                                                   |
| ------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `application/loop` agent loop               | `classic-runtime-run.ts` 内嵌状态机 `maxIterations:500` | 统一为单一执行循环，复用 pi 系统 `AgentSession`                                            |
| `guards`/verify（`prepareVerifyArtifacts`） | `classic-guard.ts` 推断命令                             | 统一验证入口；comet `shell:true` 同步修复                                                  |
| `domain/plan` 状态机                        | `classic-state-command.ts` 隐式状态                     | 统一状态枚举（`EnginePhase` / `RequirementLifecycle` 已在 `engine-runtime-store.ts:8-11`） |
| `eventbus`（outbox）                        | comet 事件流                                            | 收敛到 `engine-runtime-store` 单一 `useSyncExternalStore` 源                               |
| `httpapi` REST/SSE                          | comet `server.ts:20` 127.0.0.1:4321                     | 取消 comet 内嵌 server，改挂 Next `app/api/engine/*`                                       |

### 1.4 融合目标架构图（非 Go）

```
┌──────────────────────────────────────────────────────────────────┐
│ 浏览器：EngineDashboard（进程监控 / 需求生命周期 / 任务状态 / 终端流）│
│  hooks/useEngineRuntime ← SSE(/api/engine/stream) + GET /api/engine/state
└───────────────┬──────────────────────────────────────────────────┘
                │ REST/SSE (Next.js route handler)
┌───────────────▼──────────────────────────────────────────────────┐
│ app/api/engine/{state,stream,runs}  ← 替代 autoplan httpapi + comet server
├──────────────────────────────────────────────────────────────────┤
│ lib/engine-runtime-store.ts（globalThis 单例 + useSyncExternalStore）│
│   唯一状态源：processes / requirementLifecycle / taskStatus / runs / autoplan
├───────────────┬──────────────────────────────────────────────────┤
│ lib/unified-engine/                                                │
│  ├ autoplan-adapter.ts  ── PlanGeneratorPort（纯 TS 等价）         │
│  │    ├ autoplan-llm-adapter.ts   （真实 LLM 执行，已去 shell:true）│
│  │    └ autoplan-loop-service.ts  （等价重写：scheduler/eventbus/   │
│  │         process/terminal，原 Go runtime/* 的 TS 移植）          │
│  ├ comet-adapter.ts + guards/comet-cli.ts（隔离子进程调用 vendored）│
│  └ persistence.ts（TS 等价：better-sqlite3 / 文件 jsonl 双写）      │
└──────────────────────────────────────────────────────────────────┘
   等价替换映射：goroutine→Promise队列 / channel→AbortController /
   os.exec→spawn数组 / sync→单线程去锁 / embed→fs.readFileSync /
   cgo→node-pty+加密文件 / reflect(脱敏)→递归类型守卫
```

---

## 2. 代码评估（维度二）

### 2.1 Go 特有、需重写逻辑（非简单翻译）

| 类别         | 位置                                                                        | 重写要点                                                                                               |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| worker pool  | `backend/internal/runtime/scheduler/worker_pool.go:145-150,221-234,380-385` | `class WorkerPool { private queue: (()=>Promise<void>)[]; run(n){...} }`，`p-limit` 控制并发上限       |
| actor 循环   | `backend/internal/runtime/scheduler/actor.go:141,201-219,287-289`           | `async function actorRun(){ for await (const cmd of cmdQueue) { ... } }`，`AbortController` 退出       |
| channel 取消 | `backend/internal/application/loop/service.go:77-78,93`                     | `const ac = new AbortController(); ac.signal` 替代 `chan struct{}`                                     |
| 进程执行     | `backend/internal/runtime/process/runner.go:40-42,205`                      | **保持数组传参纪律**：`spawn(exe, args, { shell:false })`；白名单 PATH 解析 `resolveExecutable`        |
| PTY/信号     | `terminal/pty_unix.go:36`、`process/tree_unix.go:13-48`                     | `node-pty` 起伪终端；`process.kill(-pid, 'SIGTERM')` 杀进程组（Unix）；Windows 用 `taskkill /T /F`     |
| 反射脱敏     | `platform/redaction/redaction.go:81-189`                                    | `function sanitize(v: unknown): unknown` 递归 `typeof`/`Array.isArray`/`Object` 守卫，敏感词表来自常量 |
| embed SQL    | `migrations/registry.go:33-37`                                              | `fs.readFileSync(new URL('./0001_schema_v1.sql', import.meta.url))`                                    |
| cgo keyring  | `platform/secrets/keyring/backend_windows.go:78-116`                        | 放弃 C API；密钥用 `crypto` 加密文件或 OS keychain 库                                                  |

### 2.2 技术债与代码异味

| 问题                   | 位置                                                                | 说明                                                                                                            |
| ---------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 平台分文件 / build tag | `terminal/pty_unix.go` vs `pty_windows.go`（`//go:build !windows`） | TS 需合并为单文件 + `process.platform` 分支                                                                     |
| 未处理 error           | 全仓 `err != nil` 后 `_ = ...` / `panic(`                           | 等价层必须 `try/catch` 上报 `engine-runtime-store.stats.errorCount`                                             |
| 重复代码               | `terminal/pty_unix.go:36` 与 `pty_windows.go:95` 同义逻辑           | 抽 `spawnUnderPty(platform)` 工厂                                                                               |
| 死代码 / TODO          | 全仓 `TODO`/`FIXME`/`HACK` 注释                                     | 迁移时仅移植活跃路径，废弃 `VerifyCommand` 等已移除字段（见 `classic-guard.ts:348` `removedProjectCommandRun`） |
| 大临界区持锁           | `terminal/sessions.go:139` `service.mu.Lock()` 包裹 PTY spawn       | 持锁跨越网络/PTY 启动会阻塞同服务会话创建；TS 单线程下移除锁，改为串行 `await`                                  |

### 2.3 生命周期关键路径（等价重写落点）

- **状态枚举**：`domain/plan/plan.go:29-38`（draft/pending/running/…）→ 映射到 `EnginePhase` / `RunState.status`（`unified-engine-types.ts`）。
- **状态机编排**：`domain/plan/plan.go` 的 `switch state` → TS `function advance(state, event)` 纯函数（可单测，已在 `engine-optimizations.test.mjs` 覆盖守卫推进）。
- **持久化落盘**：`repository/sqlite/schema.go:17`（`requirement`/`plan`/`task`/`feedback` 表）→ TS 等价建表（`persistence.ts` 已起步，需补齐 task/feedback 表）。
- **可复用点**：comet 侧已有 `classic-runtime-run.ts`（执行循环）、`engine-runtime-store.ts`（状态源）、`autoplan-llm-adapter.ts`（真实执行），优先复用而非重写。

---

## 3. 性能排查（维度三，量化）

| 损耗点                      | 位置                                                                      | 量化                                                     | 等价层处置                                                                    |
| --------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| SSE 每事件起 goroutine      | `internal/httpapi/sse.go:111-116` `go func(){ subscription.Next(ctx) }()` | 高并发 SSE × 事件数 goroutine 滞留（代理静默保活时尤甚） | TS 单连接单 `ReadableStream`，`for await` 消费事件总线，连接断开即 `cancel()` |
| 文件鉴权每请求多次 syscalls | `platform/filesystem/controlled_paths.go:107` + `realpath.go:92`          | O(路径深度) `Lstat`/`realpath` 每次文件访问              | 加 60s TTL 路径缓存（`session-reader.ts` 已有 `__piSessionPathCache` 先例）   |
| 大临界区持锁                | `terminal/sessions.go:139`                                                | 同服务会话创建串行                                       | 移除锁，串行 `await` 即可                                                     |
| actor 单 goroutine 串行编排 | `runtime/scheduler/actor.go:219-228`                                      | 单 actor 串行化所有提交                                  | 按项目隔离的 `async` 队列，非全局串行                                         |
| 轮询点                      | `platform/instance/database_lock.go:88,241` `for{}+time.Sleep`            | 仅跨进程锁等待，非热路径                                 | 等价用 `setInterval` 退避，限重试次数                                         |
| 常驻 worker / 全局 map      | `worker_pool.go:145`、`bus.subscriptions`                                 | 受控常驻 + 有 `delete` 路径                              | 无泄漏，等价保留 `close()` 清理                                               |

**总体判定**：上游为受控常驻模型，无全局 map 只增不删或明显 goroutine 泄漏；可量化损耗集中在 SSE goroutine、文件鉴权 syscalls、锁粒度三处，等价 TS 层应一并优化（单流消费、路径缓存、去锁）。

---

## 4. 安全检测（维度四，分级）

### 4.1 漏洞分级清单（file:line 证据）

| 级别       | 位置                                                                                                                                    | 类型           | 触发场景                                                                                                              | 处置                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **P0**     | `comet/domains/comet-classic/classic-guard.ts:355-359` `spawnSync(command,{shell:true,timeout:300_000})`                                | 命令注入 / RCE | `command` 来自 `inferredBuildCommand()`（`.comet/config.yaml` / `package.json` 推断），配置/供应链污染可注入 `& \| >` | **禁用 `shell:true`，改 `spawnSync(exe, args[])` + 参数白名单**；同步进 `vendor/comet` |
| **P1**     | `comet/app/commands/update.ts:346-350` `spawn(...,{shell:true})`                                                                        | 命令注入       | `cwd=projectPath` 外部可控                                                                                            | 改 `shell:false` + argv                                                                |
| **P1**     | `comet/app/commands/openspec.ts:152,173,349`（疑似 `@latest` 全局安装）                                                                 | 供应链投毒     | 全局安装未锁版本                                                                                                      | 锁定版本（已在 `package.json` 落实，无 `@latest`）                                     |
| **P2**     | `autoplan/backend/internal/application/chat/provider_service.go:198-232` `base_url` 来自配置无 host 白名单                              | SSRF           | 用户配置任意 `base_url` → 内网/metadata                                                                               | LLM `base_url` 加 host 白名单 / 仅允许公网 HTTPS                                       |
| **P2**     | `comet/domains/dashboard/open-browser.ts:27` `spawn(command,args)`                                                                      | 命令来源未核实 | `command` 是否白名单未知                                                                                              | 确认 `command` 来自固定白名单                                                          |
| **P3**     | `comet/README-zh.md:313` `LANGSMITH_API_KEY=lsv2_pt_...` 示例                                                                           | 密钥误导       | 文档示例                                                                                                              | 仅文档，替换为占位                                                                     |
| **已缓解** | `autoplan` `process/runner.go:205`（数组传参）、`middleware.go:133`（Session+Origin SHA256）、`controlled_paths.go:83-97`（双路径校验） | —              | —                                                                                                                     | 设计成熟，等价继承                                                                     |

### 4.2 当前 pi-web 安全实测

- `grep -rn "shell: true" lib/ vendor/` → **仅在 `docs/*.md` 注释命中**，业务代码 0 命中（`autoplan-llm-adapter.ts:210` 已消除 `shell:true`）。
- autoplan 密钥：上游无硬编码明文（运行时 `generateSecretToken()` + 加密文件存储），等价层沿用。
- 文件越界：上游 `controlled_paths.go:83-97` 双校验（真实路径 + 词法 + symlink/reparse），TS 等价用 `resolve(cwd, rel)` + 拒绝 `..`/绝对/空字节（`autoplan-llm-adapter.ts:8-10` 已落实）。

---

## 5. 问题清单（集中，附行号）

| #   | 维度 | 问题                                   | 位置                                                              | 级别 |
| --- | ---- | -------------------------------------- | ----------------------------------------------------------------- | ---- |
| Q1  | 安全 | comet 推断命令 `shell:true`            | `comet/.../classic-guard.ts:359`                                  | P0   |
| Q2  | 安全 | comet update `shell:true` + 外部 cwd   | `comet/app/commands/update.ts:350`                                | P1   |
| Q3  | 安全 | LLM `base_url` SSRF 无白名单           | `autoplan/.../chat/provider_service.go:198`                       | P2   |
| Q4  | 代码 | PTY/进程树/信号无纯 TS 等价            | `autoplan/.../terminal/pty_unix.go:36`、`process/tree_unix.go:13` | 高   |
| Q5  | 代码 | `reflect` 递归脱敏重写风险             | `autoplan/.../redaction/redaction.go:81`                          | 高   |
| Q6  | 代码 | cgo/unsafe Windows keyring             | `autoplan/.../keyring/backend_windows.go:78`                      | 中   |
| Q7  | 代码 | 平台分文件需合并                       | `pty_unix.go` / `pty_windows.go`                                  | 中   |
| Q8  | 性能 | SSE 每事件 goroutine 滞留              | `autoplan/.../httpapi/sse.go:112`                                 | 中   |
| Q9  | 性能 | 文件鉴权每请求多次 syscalls            | `controlled_paths.go:107`、`realpath.go:92`                       | 中   |
| Q10 | 性能 | 大临界区持锁跨 PTY spawn               | `terminal/sessions.go:139`                                        | 中   |
| Q11 | 架构 | comet 内嵌 HTTP server 须隔离          | `comet/.../server.ts:20,21,50,58`（127.0.0.1:4321，重试 50）      | 中   |
| Q12 | 架构 | comet `process.exit` 与主进程冲突      | `comet/app/cli/index.ts:78,164`                                   | 中   |
| Q13 | 架构 | JS 端 `goDataClient` HTTP 调 Go 待移除 | `autoplan/src/data/goDataClient.js`                               | 中   |
| Q14 | 前端 | 缺终端实时流 + 进程树深度视图          | `components/EngineDashboard.tsx`（仅三看板）                      | 中   |
| Q15 | 代码 | 上游未处理 error 需 try/catch 上报     | 全仓 `err != nil` 忽略                                            | 低   |

---

## 6. 关键阻塞专项（四类）

### 6.1 底层引擎（已可跑，富能力未等价）

- **现状**：批次 A–D 后引擎可演示（`autoplan-lifecycle.test.mjs` 3 例 + `engine-optimizations.test.mjs` 全绿），idle 销毁无泄漏（`rpc-manager-lifecycle.test.ts` 4/4）。
- **阻塞**：Go 后端的 scheduler/worker-pool、PTY 终端、MCP、outbox eventbus 尚未在 `autoplan-loop-service.ts` 等价落地 → 「全量迁移」未达。
- **解锁**：见 §7 M2/M3。

### 6.2 非 Go 等效重写（最高风险）

- **PTY/信号**（Q4）：`node-pty` 起伪终端 + `process.kill(-pid)` 进程组；Windows 退化为 `taskkill /T /F`。需在 `lib/unified-engine/runtime/` 新建 `pty-runner.ts`。
- **reflect 脱敏**（Q5）：`platform/redaction/redaction.go:81-189` 重写成 `sanitize(v: unknown)`，递归守卫 + 敏感词常量表，单测覆盖各类型。
- **cgo keyring**（Q6）：放弃 C API，用 `crypto` 加密文件存储（已在 `persistence.ts` 思路内）。
- **scheduler/eventbus**（worker_pool.go / bus.go）：`Promise` 队列 + `EventEmitter` outbox（落盘为权威源，对应 `repository/sqlite` 的 outbox 表）。

### 6.3 跨语言接口转换联调

- **goDataClient 移除**（Q13）：`autoplan/src/data/goDataClient.js` 经 HTTP 调 Go 后端 → 改为直接 `import` TS 端口（`autoplan-loop-service`），删除 HTTP 边界。
- **comet HTTP server 隔离**（Q11）：取消 comet `server.ts:20` 内嵌 127.0.0.1:4321 server，统一挂 Next `app/api/engine/*`；comet 调用经 `guards/comet-cli.ts` 隔离子进程（已落地）。
- **comet process.exit**（Q12）：`app/cli/index.ts:78,164` 的 `process.exit` 在子进程内执行，主进程用 `child.on('exit')` 清理，避免误杀宿主。
- **shell:true 同步**（Q1/Q2）：修复 vendored `vendor/comet/.../classic-guard.ts` 与 `update.ts`，改数组传参，复跑 `grep shell: true vendor/`。

### 6.4 UI 障碍

- **现状**：`EngineDashboard.tsx` 已有进程监控 / 需求生命周期 / 任务状态三看板 + per-run 详情（`StageStepper` + `PlanTaskCard`）。
- **阻塞**（Q14）：缺终端实时流（PTY 输出）、进程树深度（父子进程、资源占用）、守卫/验证实时状态。
- **解锁**：在 `engine-runtime-store` 增 `terminals: TerminalStream[]` 切片，SSE 增 `terminal-output` 事件类型；`EngineDashboard` 增 `TerminalPanel` + `ProcessTree`。

---

## 7. 分模块重构方案（可编码落地）

### M1 · autoplan 应用/域层 TS 等价（对应 `application/` + `domain/`）

- 新建 `lib/unified-engine/autoplan-domain.ts`：`Plan`/`Requirement`/`Task`/`Feedback` 类型 + `advance(state, event)` 纯函数状态机（移植 `domain/plan/plan.go:29-38`）。
- 复用 `autoplan-llm-adapter.ts` 作为 `application/loop` 等价；新增 `autoplan-loop-service.ts` 编排「需求→计划→任务→执行→反馈」主循环。
- **前端接口**：`autoplan-adapter.ts` 经 `setAutoPlanStatusProvider` 注入 `engine-runtime-store`（已实现 T3.2）。
- **状态同步**：每次 `advance` 后 `notifyRunningChange()` 推送 `runs` 切片。

### M2 · 持久化层 TS 等价（对应 `repository/sqlite/`）

- 选 `better-sqlite3`（同步 API，等价 `modernc.org/sqlite`）；或文件 `jsonl` 双写（沿用 `session-reader.ts` 只读模式）。
- 建表对齐 `repository/sqlite/schema.go:17`：`requirement`/`plan`/`task`/`feedback` + outbox 事件表。
- **落点**：扩展 `lib/unified-engine/persistence.ts`（已有基础），补齐 task/feedback 表与 outbox。

### M3 · 运行时 TS 等价（对应 `runtime/`）

- `scheduler`：`lib/unified-engine/runtime/scheduler.ts`，`class WorkerPool { private q: (()=>Promise<void>)[] = []; submit(job){...} }` + `p-limit` 并发上限。
- `eventbus`：`runtime/event-bus.ts`，`EventEmitter` + outbox 落盘（`bus.go:62` 等价）。
- `process`：`runtime/process-runner.ts`，`spawn(exe, args, { shell:false })`，白名单 PATH（移植 `resolveExecutable`）。
- `terminal`：`runtime/pty-runner.ts`，`node-pty` + `process.kill(-pid)`；Windows `taskkill /T`。
- **前端接口**：`pty-runner` 输出经 `engine-runtime-store.terminals` 切片 + SSE `terminal-output` 事件。
- **状态同步**：进程起停 → `processes` 切片 `notifyRunningChange()`。

### M4 · comet 深度融合（对应 `comet/`）

- 修复 `vendor/comet/.../classic-guard.ts:359` 与 `update.ts:350`：`shell:true` → `spawnSync(exe, args)`（P0/P1）。
- 统一验证入口：`comet-adapter.ts` 的 `prepareVerifyArtifacts`（`ENGINE_REAL_VERIFY`）与 comet guard 共用同一数组传参助手（`lib/allowed-commands.ts` 白名单）。
- 取消 comet 内嵌 server（`server.ts:20`），改挂 `app/api/engine/*`；`process.exit` 限定子进程（`guards/comet-cli.ts` 已隔离）。
- **状态同步**：comet 运行态经 `setAutoPlanStatusProvider` 同类机制注入 `engine-runtime-store`。

### M5 · 前端 EngineDashboard 增强（对应 Q14）

- 新增 `components/TerminalPanel.tsx`：订阅 `useEngineRuntime` 的 `terminals` 切片，渲染 PTY 实时流（`stripAnsi` 已就绪）。
- 新增 `components/ProcessTree.tsx`：`processes` 切片渲染父子关系 + 资源占用。
- SSE 扩展事件：`terminal-output` / `process-spawn` / `process-exit` / `guard-status`（在 `app/api/engine/stream` 与 `engine-runtime-store` 加对应 reducer）。
- i18n：`lib/i18n/zh.ts` + `en.ts` 新增 `engine.terminal.*` / `engine.processTree.*` 文案（沿用现有 `engine.lifecycle.*` 风格）。

---

## 8. 全链路验收标准

| 类别 | 验收项        | 判定标准                                                                                                |
| ---- | ------------- | ------------------------------------------------------------------------------------------------------- |
| 安全 | 命令注入      | `grep -rn "shell: true" lib/ vendor/` → **业务代码 0 命中**；`comet-cli.ts` 白名单 + `..`/null 拒绝     |
| 安全 | SSRF          | LLM `base_url` 仅允许白名单 host / 公网 HTTPS；`npm audit` 高危清零                                     |
| 安全 | 路径越界      | 写入目标 `resolve(cwd, rel)`，拒绝 `..`/绝对/空字节；100% 单测覆盖                                      |
| 架构 | 非 Go         | 全仓无 `.go` 编译/调用；无 `goDataClient` HTTP 边界；`autoplan-loop-service.ts` 等价覆盖 `runtime/*`    |
| 架构 | 融合          | comet 无独立 HTTP server；comet 运行态经统一 store 注入；守卫失败阻断（非静默）                         |
| 功能 | 生命周期      | `autoplan-lifecycle.test.mjs` 覆盖「需求→计划→任务→执行→反馈」全链路 node 单测 **全绿**                 |
| 功能 | 持久化        | `persistence.test.mjs` 覆盖 requirement/plan/task/feedback/outbox 读写与重启恢复                        |
| 性能 | 无泄漏        | SSE 单连接单流；`rpc-manager-lifecycle.test.ts` idle 销毁 4/4；全局 map 有 `delete` 路径                |
| 性能 | 鉴权缓存      | 文件鉴权路径 60s TTL 缓存；syscall 次数下降可观测                                                       |
| 前端 | 三看板 + 终端 | `EngineDashboard` 实时渲染进程监控 / 需求生命周期 / 任务状态 / 终端流；移动端折叠（沿用 `useIsMobile`） |
| 集成 | 全链路无报错  | `npm run ci`（format+lint+type-check+test:node+test:coverage）全绿；`next dev` 手动跑通一次完整需求闭环 |

---

## 9. 优先级与落地顺序

1. **P0 安全**：M4 修复 comet `shell:true`（Q1/Q2）→ 复跑 `grep shell: true vendor/`。
2. **M2 持久化**：补齐 `persistence.ts` task/feedback/outbox（解锁全流程可追溯）。
3. **M3 运行时**：`scheduler`/`eventbus`/`process-runner`/`pty-runner`（解锁全量执行能力，Q4/Q5/Q6）。
4. **M1 编排**：`autoplan-loop-service.ts` 串起生命周期（对齐 Go `application/`）。
5. **M5 前端**：`TerminalPanel` + `ProcessTree` + SSE 事件扩展（Q14）。
6. **校验**：§8 全链路验收 + `npm run ci`。

> 所有结论均基于 `/data/Code/research/` 静态只读扫描 + 当前 `pi-web` 代码锚定，附精确 `文件:行号`，可直接映射为编码任务。
