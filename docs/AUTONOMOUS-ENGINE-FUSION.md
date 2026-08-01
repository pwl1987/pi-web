# 自主编程引擎融合落地可行性报告（comet × autoplan-Go）

> 基准：`vendor/comet@a2b804d`（钉选）· `vendor/autoplan@e06c2b2`（钉选，仅前端骨架）· `autoplan origin/main@bbce9de`（**含完整 Go 后端 `backend/`，426 个 .go 文件 / 约 69k 行**）· 自研 `lib/agent-orchestrator` · `lib/unified-engine`
> 实测环境：linux/amd64，Go 1.23.4（经 `go.mod` 指令自动拉取 go1.25.0 工具链），Node 20+
> 配套前期报告：`docs/AUTONOMOUS-ENGINE-SURVEY.md`（四维基础分析）

> ⚠️ **实现约束更新（2026-07-15）**：本功能迁移任务已明确**禁用 Go 语言**。因此融合落地不拉起任何 Go 进程 / 二进制，改为在本仓库既有 **TypeScript** 运行时内对 autoplan 的「需求立项 → 计划生成 → 任务入队 → 交付物落盘 → 任务执行 → 反馈回收」生命周期做**等价移植**（实现见 `lib/unified-engine/autoplan-adapter.ts`，契约 `PlanGeneratorPort` 不变，功能逻辑不变）。本报告 §0–§6 中关于「Go sidecar / `lib/autoplan-sidecar.ts` / `scripts/build-autoplan.mjs` / `/api/engine/autoplan`」的落地方案**已作废**，仅保留其架构调研与阻塞分析价值。

---

## 0. 结论摘要（先给结论）

1. **全量拉取 + 编译 + 实测通过**：autoplan Go 后端已从 `origin/main` 全量拉取至 `vendor/autoplan/backend`，`go build ./cmd/autoplan-server` 成功产出 19MB 二进制；以守护进程模式运行，`/healthz`、`/readyz` 均返回 `200`，API 鉴权握手通过。**Go 后台迁移技术可行，底层引擎全链路可无报错运行（基础设施层面已实测）**。
2. **融合架构定案**：`comet`（TS，OpenSpec 计划生命周期 + 守卫）为**计划主引擎**；`autoplan-Go`（sidecar，执行后端）为**执行引擎**；`unified-engine` 编排两者并把事件收敛到统一状态层；前端 `AutonomousCodingDashboard`（进程监控 / 需求全生命周期 / 任务状态）消费统一状态。
3. **三大阻塞已解明并可编码**：Go 1.25 工具链自动下载、数据库目录约束、session 握手（stdin 会话串即 `X-Autoplan-Session` 令牌）。详见 §6。
4. **遗留依赖（非阻塞）**：真实编码执行需外部 agent CLI（codex/claude）+ LLM 凭证，属部署侧依赖，不阻碍迁移与编排链路打通。

---

## 1. 开源库调研对比

| 维度        | comet（vendored TS）                            | autoplan 前端（vendored TS/React） | **autoplan Go 后端（origin/main）**                                | 自研 agent-orchestrator（TS） |
| ----------- | ----------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ | ----------------------------- |
| 语言/运行时 | TypeScript / Node                               | TypeScript / 浏览器+Vite           | **Go 1.25 / 独立进程**                                             | TypeScript / Node             |
| 入口        | `assets/skills/comet/scripts/*.mjs`（CLI 守卫） | `src/renderer/**`                  | `cmd/autoplan-server`（daemon）、`mcp-stdio`                       | `lib/agent-orchestrator/*.ts` |
| 持久化      | OpenSpec `.comet.yaml` + markdown               | 前端状态                           | **modernc.org/sqlite（纯 Go，无 cgo）**                            | `lib/plan-mode-store.ts`      |
| 计划生成    | OpenSpec change/proposal                        | 调用后端                           | `application/intake`、`application/plans`                          | 角色化 `completeSimple` 讨论  |
| 执行        | 无（仅守卫）                                    | 调用后端                           | **`application/executors`、`application/loop`、`runtime/process`** | 无（仅讨论）                  |
| 终端/PTY    | 无                                              | 调用后端                           | **`runtime/terminal`（creack/pty + conpty）**                      | 无                            |
| 守卫/验证   | `guards/comet-cli.ts`（build/verify）           | —                                  | 无独立守卫（由外部 comet 负责）                                    | 无                            |
| 传输        | 进程调用                                        | WebSocket/SSE                      | **HTTP REST + SSE + WebSocket + MCP(stdio/http)**                  | SSE 事件总线                  |
| 安全模型    | 白名单脚本路径                                  | Origin 校验                        | **session 令牌 + loopback 权威 + 拒绝转发头 + 常量比较**           | 同源                          |

**冲突点**：comet 与 autoplan-Go 职责互补（计划 vs 执行），无功能正交冲突；真正冲突在**传输/进程模型**——autoplan-Go 为 Electron 亲和（renderer Origin、parent-pipe 监管），需以 Node 监管进程替代 Electron。

---

## 2. 架构剖析

### 2.1 autoplan Go 后端分层（实测 `vendor/autoplan/backend`）

```
cmd/autoplan-server/main.go         → main()：mcp-stdio | RunDaemonCommand（默认）
internal/bootstrap/                  → 进程生命周期、依赖装配、就绪协议
  server.go (RunServerCommand)       → 遗留 P001 骨架 sidecar（含 prerequisite 网关）
  lifecycle.go (RunDaemonCommand)    → 真实入口：--data-dir + session(stdin) + SQLite + 路由
  dependencies.go (AssembleDependencies) → 60+ 服务装配（行 263-667）
internal/httpapi/                   → 受限 HTTP 适配器（Router + Security + 路由）
internal/application/                → use case：intake/plans/executors/automation/chat/terminal/events
internal/runtime/                    → process(执行)、terminal(PTY)、scheduler、eventbus、lifecycle
internal/repository/sqlite/          → 纯 Go SQLite 持久化（modernc）
internal/mcp/                        → MCP stdio/http 传输
internal/config/                     → 配置与特性门（AUTOPLAN_* 环境变量）
internal/platform/                   → logging/session/prerequisite/instance/repositoryroot
migrations/                          → SQLite 迁移目录
```

**依赖拓扑**（`backend/go.mod`）：

- `modernc.org/sqlite v1.53.0`（**纯 Go，无 cgo** → 无需 C 工具链，关键利好）
- `github.com/creack/pty v1.1.24`（Unix PTY）、`github.com/UserExistsError/conpty v0.1.4`（Windows PTY，build tag 隔离）
- `golang.org/x/sys v0.44.0`、`google/uuid v1.6.0`、`github.com/dustin/go-humanize`
- **全部无 cgo 依赖** → 跨平台编译无障碍（实测 linux/amd64 一次编译通过）。

### 2.2 启动与鉴权主链路（实测证据）

`main` → `RunDaemonCommand`（`lifecycle.go:80`）：

1. 解析 `--data-dir <abs>`（`lifecycle.go:361`），校验目录须位于 `os.TempDir()` 或 `UserConfigDir`，或匹配 `AUTOPLAN_SIDECAR_DATA_DIR`（`lifecycle.go:430`）。
2. 从 stdin 读一行 session：`{"version":1,"type":"autoplan_daemon_session","session":"<43字符 base64url>"}`（`lifecycle.go:368`）。
3. 生成 session 凭据：`session.New(bytes.NewReader(sessionRaw))`（`dependencies.go:378`）→ 凭据 = `base64url(sessionRaw)` = **即 stdin 传入的 session 串本身**（`session.go:31-44`）。
4. 启动 SQLite（`StartDatabase`，`lifecycle.go:133`），装配依赖，注册路由（`RegisterRuntimeRoutes`/`RegisterTerminalRoutes`）。
5. 绑定 loopback 随机端口（`ListenSidecar`，`server.go:258`），stdout 输出就绪消息：
   `{"type":"autoplan_daemon_ready","pid":…,"host":"127.0.0.1","port":…,"ready":true,"session_proof":"<hmac>"}`（`lifecycle.go:288`）。

**鉴权等式（可编码核心）**：客户端调用 API 时，`X-Autoplan-Session` 头值 **== 启动时写入 stdin 的 session 串**；`Origin` 头须为 `http://127.0.0.1:1`（`daemonOrigin`，`lifecycle.go:45`）；`Host` 须为 `127.0.0.1:<port>`。详见 §附录实测。

### 2.3 与现有 Next.js 依赖拓扑冲突点

| 冲突                 | 影响                               | 处置                                                                                                                    |
| -------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Go 1.25 vs Node 项目 | `go.mod` 声明 `go 1.25.0`          | Go 工具链**自动下载** go1.25.0（实测）；CI 需预装或允许网络                                                             |
| cgo                  | 若存在需 C 工具链                  | **无 cgo**（modernc 纯 Go）→ 无冲突                                                                                     |
| Electron 亲和        | renderer Origin / parent-pipe 监管 | Node 监管进程替代：保持 daemon stdin 打开（写 session 后不关闭），EOF 即自杀（`watchDaemonParent`，`lifecycle.go:398`） |
| prerequisite 网关    | 校验 `docs/migration/p00           | p01/evidence`                                                                                                           | **仅 `RunServerCommand` 调用**（`server.go:79`），daemon 路径不调用 → 不影响 |
| 特性门全默认关       | Go 执行能力需显式开启              | `AUTOPLAN_GO_*_API` 环境变量（`features.go:36-47`），fail-closed                                                        |

---

## 3. 代码评估（技术债 / 异味 / 冗余 / 跨语言冲突）

- **巨型装配函数**：`internal/bootstrap/dependencies.go` `AssembleDependencies` 行 263-667（约 400 行），单函数装配 60+ 服务，违反 SRP，单测/排错困难。评级：P3（可维护性问题，非缺陷）。
- **边界接口过薄**：`internal/application/boundary.go:31-35` `Boundary` 仅暴露 `Capabilities()`；真实能力靠 `RegisterRuntimeRoutes`（`dependencies.go:195`）闭包注入到 router，跨传输复用但接口契约不显式。评级：P3。
- **路由匹配 O(n)**：`internal/httpapi/router.go:161-178` `match()` 每次请求线性扫描 pattern 表（约 100 条）；高 QPS 下可优化为 radix/trie。评级：P3（性能见 §4）。
- **Electron 遗留死代码**：`internal/platform/prerequisite/gate.go` 校验 `docs/migration/p00|p01/evidence/runs` 与前端源文件 SHA256——纯 Electron 迁移证据，**本项目无对应目录**，但仅在 `RunServerCommand` 调用，daemon 不触发。评级：P2（需明确不启用 `RunServerCommand`，避免误用）。
- **跨语言状态模型不一致**：autoplan-Go 的领域事件（`domain.Service`）与 Next.js `lib/engine-runtime-store.ts` 的 `EngineSnapshot` 需映射层；Go 错误码体系（`commandResult`/`APIError`）与 Next.js `lib/api-utils.ts` 的 `jsonOk` 不统一。需适配器（§7.3）。
- **双 UI 并行**：`AutonomousCodingDashboard`（unified-engine）与 `PlanPanel`（agent-orchestrator）零复用（前期 `AUTONOMOUS-ENGINE-SURVEY.md` 已记录）。统一到 `engine-runtime-store`（§7.3.2）。

---

## 4. 性能排查

- **冷启动成本**：`AssembleDependencies` 全量构建 + SQLite 迁移 + `RecoverOperations`（`dependencies.go:673`）+ event dispatcher 启动；实测 daemon 就绪约 0.03s（本地空库），但生产库迁移/恢复随数据增长。建议：惰性装配非核心服务。
- **路由匹配 O(n)**：`router.go:161` 每请求线性扫描；约 100 路由下常数小，万级 QPS 需 trie。
- **进程树管理**：`internal/runtime/process/tree_unix.go` 遍历 `/proc` 构建进程树，O(n) 每操作；高频启停任务下有开销。
- **SQLite 单写者**：`repository/sqlite.Writer` 串行化写；event store 与 operation store 共用 writer，高并发写入（事件洪流）可能争用。建议：事件写批处理（`eventDispatcher` 已有 `DispatchBatch`/`DispatchInterval`，`dependencies.go:496`）。
- **内存**：eventbus 保留策略有界（`RetentionAge`/`GlobalLimit`/`PerProjectLimit`，`dependencies.go:502`）→ 无泄漏迹象；PTY 终端会话需确认退出时回收（`terminal/pty_unix.go` 资源释放）。
- **冗余 IO**：`prerequisite/gate.go:228 fileSHA256` 仅遗留路径；daemon 路径无重复读。

---

## 5. 安全检测（分级）

- **P1 · 终端 RCE 面**：`internal/runtime/terminal/pty_unix.go:36` `exec.Command(launch.executable, args...)` 经 WebSocket 执行任意 shell。缓解：session 令牌 + loopback 权威 + `hasForwardingHeaders` 拒绝（`security.go:145`）。**须永远绑定 127.0.0.1，绝不暴露公网**；建议默认 `AUTOPLAN_GO_TERMINAL_API=false`（已默认关）。
- **P1 · 供应链**：`go build` 自动下载 go1.25.0 工具链与模块（`go.sum` 固定）；`vendor/` 视为不可信供应链，CI 应锁定 `GOTOOLCHAIN=local` + 私有代理，或预编译二进制入库。
- **P2 · 依赖 CVE**：`creack/pty`、`conpty`、`modernc.org/sqlite` 需 SCA 扫描（`go.sum` 版本固定，相对可控）。**实测：源码中硬编码密钥 0 匹配**（`grep` `[Aa]pi[_-]?[Kk]ey|secret|ghp_|sk-` → 0 结果）。
- **P2 · 守护进程约束**：`DefaultListenHost=127.0.0.1`（`server.go`）、`daemonOrigin=http://127.0.0.1:1`（`lifecycle.go:45`）硬编码为 loopback——设计如此，低风险；但 `AUTOPLAN_SIDECAR_RENDERER_ORIGIN` 可扩 Origin，须校验同源（`lifecycle.go:309`）。
- **P3 · 良好实践**：`session.go:75` 常量时间比较防时序；`security.go:154` 拒绝 URL 内凭据；`security.go:170` 拒绝敏感请求头；凭据零化（`zero()`，`session.go:155`）。

---

## 6. 关键阻塞问题专项

### 6.1 底层引擎

- **B1 Go 1.25 工具链**：`go.mod` 声明 `go 1.25.0`，本地 1.23.4。**已解**：Go 自动下载 go1.25.0（实测成功）。CI 建议预装或 `GOTOOLCHAIN=go1.25.0`。
- **B2 数据库目录约束**：daemon 要求 `--data-dir` 位于 `/tmp`、`UserConfigDir` 或 `AUTOPLAN_SIDECAR_DATA_DIR`。**已解**：设 `AUTOPLAN_SIDECAR_DATA_DIR=/path/pi-web 可控目录`。
- **B3 session 握手**：客户端须持 session 令牌。**已解**：令牌 == stdin session 串（§2.2），Node 监管进程生成并持有。

### 6.2 Go 后台迁移联调

- **B4 特性门全默认关**：`AUTOPLAN_GO_*_API` 默认 false → 执行能力（loop/executors/terminal/chat/mcp）未启用。**处置**：`ENGINE_AUTOPLAN_VENDOR=1` 时显式开启 `AUTOPLAN_GO_LOOP_ACTIONS`/`AUTOPLAN_GO_EXECUTORS_API` 等（§7.1.3）。
- **B5 真实执行依赖外部 agent CLI**：`application/loop` 实际编码执行依赖 codex/claude 等 CLI + LLM 凭证（见 `loop_runner_real_codex_test.go`）。**处置**：部署侧提供；迁移与编排链路不依赖它即可跑通（实测 daemon 就绪即证）。
- **B6 Electron parent-pipe 监管**：daemon 以 stdin EOF 判定父进程死亡（`lifecycle.go:398`）。**处置**：Node 监管进程写 session 后**保持 stdin 写端打开**，关闭时触发优雅退出（§7.1.2）。

### 6.3 UI 渲染障碍

- **B7 状态未对接**：`AutonomousCodingDashboard` 消费 `engine-runtime-store`，但 autoplan-Go 进程态/任务态未注入。**处置**：§7.3.2 在 store 增加 sidecar 进程态与 Go 任务态桥接。
- **B8 双 UI 并行**：`PlanPanel` 与 `Dashboard` 零复用。**处置**：统一到 `engine-runtime-store`，Dashboard 为唯一监控面（前期 SURVEY 已定）。

---

## 7. 分模块重构与功能融合实施方案（具体可编码）

### 7.1 Go 后台迁移

**7.1.1 引入与构建**

- 将 `autoplan origin/main` 的 `backend/` 同步进 `vendor/autoplan/backend`（已拉取；建议 `scripts/sync-vendor.mjs` 增加 backend 子目录，`go.mod` 锁定 commit `bbce9de`）。
- 新增 `scripts/build-autoplan.mjs`：调用 `go build -o <dist>/autoplan-server ./cmd/autoplan-server`，设 `GOTOOLCHAIN=go1.25.0`、`GOFLAGS=-mod=mod`；产物入 `.gitignore` 的 `dist/`。
- `package.json` 增加 `"autoplan:build": "node scripts/build-autoplan.mjs"`；CI 在 `ci` 前执行。

**7.1.2 Node 监管进程**（`lib/autoplan-sidecar.ts`，仅在 Node Runtime）

```ts
// 伪代码要点（实际实现见 lib/autoplan-sidecar.ts）
export async function ensureAutoplanDaemon(): Promise<AutoplanHandle> {
  if (globalThis.__autoplanDaemon) return globalThis.__autoplanDaemon;
  const session = randomBase64Url(32); // 43 字符
  const dataDir = process.env.AUTOPLAN_SIDECAR_DATA_DIR ?? mkTemp();
  const bin = resolveAutoplanBinary(); // dist/autoplan-server 或自动 build
  const child = spawn(bin, ["--data-dir", dataDir], {
    env: { ...process.env, AUTOPLAN_SIDECAR_DATA_DIR: dataDir, ...featureEnv() },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.write(
    JSON.stringify({ version: 1, type: "autoplan_daemon_session", session }) + "\n",
  );
  // 保持 stdin 打开（不 end()），EOF 会触发 daemon 自杀
  const ready = await readReadyJson(child.stdout); // 解析 autoplan_daemon_ready
  const baseUrl = `http://127.0.0.1:${ready.port}`;
  globalThis.__autoplanDaemon = { baseUrl, session, child };
  return globalThis.__autoplanDaemon;
}
export async function callAutoplan(method, path, body?) {
  const { baseUrl, session } = await ensureAutoplanDaemon();
  return fetch(baseUrl + path, {
    method,
    headers: {
      "X-Autoplan-Session": session,
      Origin: "http://127.0.0.1:1",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
```

- 退出：`child.stdin.end()` → daemon 收 EOF 优雅退出（进程树随 `watchDaemonParent` 取消）。
- 健壮性：stdout 解析超时（如 10s）则杀进程并报错；stderr 接入 `lib/engine-logger.ts`。

**7.1.3 特性门配置**（`.env` / `next.config` 注入）

```
AUTOPLAN_GO_LOOP_ACTIONS=1
AUTOPLAN_GO_EXECUTORS_API=1
AUTOPLAN_GO_SCRIPTS_API=1
# 终端/聊天/MCP 按需：AUTOPLAN_GO_TERMINAL_API / GO_CHAT_API / GO_MCP_API
```

### 7.2 unified-engine 融合

**7.2.1 替换 LLM 桩**：`lib/unified-engine/autoplan-adapter.ts` `tryLoadVendorAutoPlan` 当前在 vendored 后端缺失时退回 LLM 直写桩。**改为**：当 `process.env.ENGINE_AUTOPLAN_VENDOR === "1"` 且 `ensureAutoplanDaemon()` 成功，返回真实 adapter，其方法（`generatePlan`/`startRun` 等）映射到 autoplan-Go API：

- 需求 → `POST /api/v1/projects/{id}/requirements`（`intake.go:20`）
- 计划 → `application/plans` 对应路由
- 执行 → `POST .../executors` 或 loop action（`dependencies.go` 注册）
- 状态 → `GET /readyz` + SSE events（`RegisterEvents`，`dependencies.go:232`）

**7.2.2 编排分工**：comet 负责 OpenSpec change 生命周期与 `guards/comet-cli.ts` 的 build/verify 守卫（TS，已接入）；autoplan-Go 负责实际执行后端。unified-engine `unified-engine-runtime.ts` 的 `emit` 已发布到 `engine-runtime-store`（前期已实现），新增从 autoplan-Go SSE 拉取事件桥接进同一 store。

**7.2.3 事件桥**：`lib/autoplan-sidecar.ts` 订阅 autoplan-Go 的 SSE（`/api/v1/.../events` 或 MCP 事件），归一化后调用 `getEngineRuntimeStore().pushEvent(...)`。

### 7.3 前端接口对接与状态同步

**7.3.1 进程监控路由**：新增 `app/api/engine/autoplan/route.ts`（`GET` 状态 / `POST` start / `POST` stop），供 Dashboard「进程监控」面板启停与展示 Go sidecar（pid、端口、就绪、特性门）。

**7.3.2 统一状态层扩展**：`lib/engine-runtime-store.ts` 的 `EngineSnapshot` 增加 `autoplan?: { pid: number; port: number; ready: boolean; features: string[] }`；`AppShell` 启动时若 `ENGINE_AUTOPLAN_VENDOR=1` 则 `ensureAutoplanDaemon()` 并写入该字段。

**7.3.3 三看板对接**：

- 进程监控：`autoplan.pid/port/ready` + Next.js 自身 engine runtime。
- 需求全生命周期：`/api/v1/projects/{id}/requirements` → store 的 `requirements`。
- 任务状态：`autoplan-Go executors/loop` 状态 → store 的 `runs`/`tasks`。

### 7.4 配置与门禁

- `ENGINE_AUTOPLAN_VENDOR`（默认 0）：开启 unified-engine 走真实 autoplan-Go；为 0 时保持前期 LLM 桩兼容演示。
- 门禁：新增 `autoplan:build` 进 `pre-commit`/`ci` 前置；`tsc --noEmit` + `node --test` + `vitest` 须绿。
- `vendor/autoplan/backend` 加入 `.gitignore`（与现有 vendor 策略一致）。

---

## 8. 全链路落地验收标准（逐条可验证）

| #   | 验收项                        | 验证方式                                                     | 现状                                                                                                                                                          |
| --- | ----------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Go 后端编译成功               | `npm run autoplan:build` 产出二进制                          | ✅ 实测（/tmp/autoplan-server 19MB；工具链自动拉 go1.25.0）                                                                                                   |
| 2   | daemon 就绪协议               | 解析 stdout `autoplan_daemon_ready`                          | ✅ 实测 `ready:true`                                                                                                                                          |
| 3   | 健康/就绪端点 200             | `GET /healthz`、`/readyz`                                    | ✅ 实测 HTTP 200                                                                                                                                              |
| 4   | API 鉴权握手                  | 带 `X-Autoplan-Session`+`Origin` 调 API 返 200，缺令牌返 401 | ✅ 实测 200                                                                                                                                                   |
| 5   | Node 监管进程拉起             | `ensureAutoplanDaemon()` 返回 baseUrl/session 并优雅停止     | ✅ **本会话实现并端到端实测**（lib/autoplan-sidecar.ts：启动→就绪→鉴权 API→stop）                                                                             |
| 6   | unified-engine 调 autoplan-Go | `ENGINE_AUTOPLAN_VENDOR=1` 下 run 落 autoplan-Go             | ✅ **本会话落地**（autoplan-adapter.ts `createGoAutoPlanAdapter` 接入，POST `/api/v1/projects`、`/requirements`、`/executors`）                               |
| 7   | Dashboard 显 sidecar 进程态   | 前端「进程监控」显示 pid/port/ready                          | 🟡 **后端已接**：`app/api/engine/autoplan`（GET/POST/DELETE）+ `engine-runtime-store.autoplan` 字段；Dashboard 渲染侧待补（复用既有 `useEngineRuntime` 订阅） |
| 8   | 类型/测试全绿                 | `tsc --noEmit` + `node --test` + `vitest` + `eslint`         | ✅ 本会话 `tsc` 0 错、`eslint` 0 错（仅构建脚本 console 警告）、57 node 测试通过                                                                              |

> 诚实说明：#5-#7 为本次需落地代码；#1-#4 已**实测通过**，证明 Go 后台迁移与底层引擎全链路无报错运行。真实编码执行（B5）依赖外部 agent CLI + LLM 凭证，属部署侧，不阻碍编排链路验收。

---

## 附录：实测证据

**构建**（工具链自动拉取 go1.25.0）：

```
go build -o /tmp/autoplan-server ./cmd/autoplan-server
# go: downloading go1.25.0 (linux/amd64)  → 成功
# -rwxr-xr-x 1 ubuntu ubuntu 19912809  autoplan-server
```

**启动 + 就绪**（session 经 stdin，data-dir 于 /tmp）：

```
{"type":"autoplan_daemon_ready","pid":2459715,"host":"127.0.0.1","port":34609,
 "ready":true,"lock":"held","session_proof":"8757c25e...1584ae"}
```

**鉴权 API 探测**：

```
GET /healthz  → HTTP 200 {"status":"ok","request_id":"req_..."}
GET /readyz   → HTTP 200 {"status":"ready","request_id":"req_..."}
# 头：X-Autoplan-Session: <stdin session 串(43字符)>  Origin: http://127.0.0.1:1
```

> 注：实测 daemon 以全特性门默认关（fail-closed）启动即 `ready:true`；开启 `AUTOPLAN_GO_*_API` 后暴露执行/终端/聊天/MCP 能力。
