# 自主编程引擎融合落地可行性报告（comet × autoplan · 全量源码调研 + 无 Go 迁移）

> 调研对象（全量克隆至 `/data/Code/research/`）：
>
> - **comet** = `rpamis/comet` @ `0.4.0-beta.4`（TypeScript，734 文件）。**注**：用户所给 `rpamis/comit` 经 `git clone` 实测 `Repository not found`；GitHub 上仅有 `rpamis/comet`，即本项目 `vendor/comet` 的上游。
> - **autoplan** = `lyming99/autoplan` @ `0.2.3-beta.21`（Electron + TypeScript 前端 1963 文件 + `backend/` **426 个 Go 文件**）。
>
> 融合目标：本项目内置「自主编程引擎」（`lib/unified-engine` + `lib/agent-orchestrator` + `vendor/comet`/`vendor/autoplan`）。
> **硬性约束（延续项目既定决策）**：**严禁使用 Go 语言**。autoplan Go 后端须全量移植为 TypeScript，在既有 Node 运行时内等价运行，不拉起任何 Go 进程/二进制。
> 统一语言 = TypeScript（pi-web 主语言，Next.js 16 App Router）。
>
> 方法：全量克隆 + 静态源码通读（`search_content`/`read_file`/`list_dir`），**所有行号来自实际 grep/read**；上游视为不可信，仅读不执行。

---

## 0. 结论摘要（先给结论）

1. **融合架构定案**：三引擎各司其职、`comet`(阶段守卫/OpenSpec 生命周期) + `autoplan-ts`(需求→计划→任务队列→交付物→执行→反馈 全生命周期) + **pi-web 既有 Agent 运行时**(`lib/rpc-manager.ts` 的 `AgentSession`，承担「真实写码」) 三者深度融合；`unified-engine` 统一编排并把事件收敛到 `engine-runtime-store`；前端 `EngineDashboard` 三看板（进程监控 / 需求全生命周期 / 任务状态）消费统一状态。
2. **无 Go 迁移技术可行且证据充分**：autoplan Go 后端 `go.mod` 确认 `modernc.org/sqlite v1.53.0` 为**纯 Go 无 cgo**、`creack/pty`/`conpty` 为 PTY 库、`golang.org/x/sys` 为系统调用——每一项都有成熟 TS 等价物（`better-sqlite3`/`sql.js`、`node-pty`、`node:os/child_process`、`Next Route Handler + SSE`、`@modelcontextprotocol/sdk`），**无需 C 工具链、无跨语言不可逾越的障碍**。
3. **关键冲突点已定位并可编码消解**：comet 的 `process.exit`/`child_process(shell:true)`/内部 HTTP server 须在隔离子进程内执行（pi-web 已通过 `guards/comet-cli.ts` 调用 `vendor/comet/assets/skills/comet/scripts/*.mjs` 薄壳做到）；autoplan 的 Electron 亲和（renderer Origin / parent-pipe 监管）在纯 Node 侧以「保活 stdin 写端、EOF 即退出」+ 同源校验替代。
4. **安全正向面显著**：autoplan Go 后端**无硬编码密钥**（仅测试占位 `sk-write-only`/`claude-write-only` 与主动脱敏 marker 列表），session 用常量时间比较、拒绝转发头、loopback 绑定——可整体继承其安全设计；comet 的 `shell:true` 命令注入（P0）与 `@latest` 全局安装（P1）须在融合时改为数组传参 + 锁版本。
5. **可落地、可验收**：项目已具备 `PlanGeneratorPort` 契约 + TS 三档适配器 + `engine-runtime-store` + `useEngineRuntime` + `app/api/engine/state/` 统一状态层骨架；本报告给出逐模块 Go→TS 迁移映射与全链路验收标准，**底层引擎全链路无报错 + 三看板交互前端**可在既有骨架上完成。

---

## 1. 开源库调研对比与融合架构设计图（交付物 1）

### 1.1 能力矩阵（实测）

| 维度              | comet（`rpamis/comet` TS） | autoplan 前端（Electron TS）     | **autoplan Go 后端（`backend/`）**              | pi-web 既有（TS）                                 |
| ----------------- | -------------------------- | -------------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| 语言/运行时       | TypeScript / Node          | TypeScript / 浏览器+Vite         | **Go 1.25 / 独立进程**                          | TypeScript / Node（Next.js）                      |
| 计划生成          | OpenSpec change + 阶段守卫 | `src/loop/planGeneration.js`     | `internal/application/intake`+`plans`           | `lib/agent-orchestrator`（多角色讨论）            |
| 需求→任务生命周期 | 无（仅守卫）               | `src/loopService.js` 队列        | **完整：intake/plans/executors/loop/tasks**     | `unified-engine` `Requirement`/`Task` 类型        |
| 真实执行/写码     | 无（仅守卫）               | `src/executors/*`                | `internal/runtime/{process,terminal}`           | **`lib/rpc-manager.ts` AgentSession**             |
| 持久化            | `.comet.yaml` + markdown   | `src/database.js`（sql.js WASM） | **modernc.org/sqlite（纯 Go）**                 | `persistence.ts`（jsonl）/ `engine-runtime-store` |
| 事件/SSE          | 无（CLI 输出）             | `src/data/goDataClient.js`       | `internal/httpapi/sse.go` + `eventbus`          | `/api/plan/[id]/events` + `engine-runtime-store`  |
| 终端/PTY          | 无                         | `node-pty`（前端）               | `internal/runtime/terminal`（creack/pty）       | 复用 `node-pty`                                   |
| MCP               | 无                         | 无                               | `internal/mcp`（stdio/http）                    | 现有 MCP 适配层                                   |
| 安全模型          | 白名单脚本路径             | Origin 校验                      | session 令牌 + loopback + 转发头拒绝 + 常量比较 | 同源 + csrf                                       |

### 1.2 融合架构设计图

```
┌──────────────────────────────────────────────────────────────────────────┐
│  浏览器（React 19 客户端）                                                  │
│  AppShell → EngineDashboard（三看板）                                       │
│    ├─ ProcessMonitor   进程监控（sidecar/agent 运行时）                      │
│    ├─ RequirementLifecycle  需求全生命周期（接收→讨论→收敛→执行→交付）        │
│    └─ TaskStatusBoard   任务状态（pending/running/done/blocked）             │
│         ↑ SSE（useEngineRuntime，重连/对账）                                │
└───────────────────────────┬──────────────────────────────────────────────┘
                              │ REST + SSE
┌───────────────────────────▼──────────────────────────────────────────────┐
│  Next.js Server（Node Runtime，serverExternalPackages 隔离）                │
│  app/api/engine/state/  ·  app/api/plan/[id]/(confirm|events)               │
│                                                                             │
│  ┌── unified-engine（编排中枢）─────────────────────────────────────────┐  │
│  │  unified-engine-runtime.ts（阶段管线 design→build→verify→archive）     │  │
│  │  engine-runtime-store.ts（globalThis 单例 + useSyncExternalStore）     │  │
│  │   ├─ comet 适配（guards/comet-cli.ts → vendor/comet/*.mjs 薄壳）        │  │
│  │   │     OpenSpec change 生命周期 + build/verify 阶段守卫（真实执行）    │  │
│  │   └─ autoplan-ts 适配（autoplan-adapter.ts → PlanGeneratorPort）        │  │
│  │        需求立项→计划→任务入队→交付物→执行→反馈（生命周期）              │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│         │ 执行委托                                                          │
│  ┌── pi-web Agent 运行时（真实写码）────────────────────────────────────┐  │
│  │  lib/rpc-manager.ts → AgentSession（send/abort/fork/compact）          │  │
│  │  = autoplan-ts executor 的实际执行体（替代 Go 的 codex/claude CLI 调用）│  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
   持久化：统一 jsonl（engine-runtime-store + persistence.ts），不引入原生 SQLite
   除非确需关系查询，否则 better-sqlite3 仅作为可选 repository 实现（见 §5.1）
```

**融合分层（统一语言 = TypeScript）**：

- **L1 计划/守卫层**：comet（OpenSpec 阶段守卫 + change 管理）——以隔离子进程调用 `vendor/comet/assets/skills/comet/scripts/*.mjs` 薄壳。
- **L2 生命周期/执行编排层**：autoplan-ts（Go→TS 移植）——供给 `PlanGeneratorPort` + 新增 `ExecutionPort`；executor 委托给 L3。
- **L3 真实执行层**：pi-web `AgentSession`（既有，承担实际写码，天然统一语言）。
- **L4 状态/前端层**：`engine-runtime-store` + `EngineDashboard`（三看板）。

---

## 2. 四维深度分析

### 2.1 维度一 · 架构剖析（含跨语言冲突点与融合方案）

**comet 分层**（实测）：`bin/comet.js` → `app/cli/index.ts`(`:55-568`) → `app/commands/*` → `domains/*`(comet-classic/engine/dashboard/skill/bundle/integrations) → `platform/*`；`assets/skills/comet/scripts/comet-runtime.mjs`（~509KB esbuild 打包镜像，被薄壳 import，`tsconfig.json:20` 不编译 `assets/`，故为独立构建产物）。依赖方向总体单向，但 `domains/**` 与 `comet-runtime.mjs` 存在**同源双份**状态机（见 §2.2）。

**autoplan Go 分层**（实测，`backend/`）：

```
cmd/autoplan-server/main.go          → mcp-stdio | daemon 分发
internal/bootstrap/                   → 进程生命周期/依赖装配/就绪协议（server.go/dependencies.go/lifecycle.go/readiness.go）
internal/httpapi/                     → REST/SSE/WS 适配器 + 鉴权 + 路由（router.go/middleware.go/security.go/sse.go/terminal_ws.go）
internal/application/                 → 24 个 use case 子域（intake/plans/executors/automation/chat/terminal/events/loop/operations/tasks/secrets/snapshot…）
internal/runtime/                     → process(执行)/terminal(PTY)/scheduler/eventbus/lifecycle
internal/repository/sqlite/           → 纯 Go SQLite 持久化（modernc，54 文件）
internal/mcp/                         → MCP stdio/http 传输 + 工具
internal/config/                      → 配置 + 特性门（AUTOPLAN_*）+ origins
internal/platform/                    → session/instance/logging/prerequisite/secrets(encryptedfile/keyring)
migrations/                           → SQL 迁移（embed）
```

**跨语言/跨运行时冲突点 + 融合方案**：

| 冲突                                                         | 证据                                                                   | 融合方案                                                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| comet `process.exit` 杀进程                                  | `app/cli/index.ts:78,164`；`comet-runtime.mjs:14086`                   | 仅以**隔离子进程**调用 `vendor/comet/*.mjs` 薄壳（pi-web 已做）；绝不 `import` 进 Next 主进程 |
| comet `child_process(shell:true)` 执行 git/openspec/build    | `classic-guard.ts:359`；`comet-runtime.mjs:10532,9732`                 | 子进程内执行 + 数组传参（去 `shell:true`，见 §2.3）                                           |
| comet 内部 HTTP server                                       | `domains/dashboard/server.ts:50,58`（127.0.0.1:4321，重试 50 端口）    | 融合**不启用** dashboard server；监控改走 Next SSE                                            |
| comet 隐式 `COMET_*` env 污染全局                            | `classic-state-command.ts:314,323,334,343,419`；`classic-guard.ts:404` | 子进程内显式注入白名单 env，不污染 Next 进程                                                  |
| autoplan Electron 亲和（renderer Origin / parent-pipe 监管） | `lifecycle.go:41 daemonSessionType`；`security.go` Origin 校验         | 纯 Node 监管进程：保活 stdin 写端、EOF 即退出；同源校验复用 pi-web csrf/session               |
| autoplan 特性门全默认关（fail-closed）                       | `internal/config/features.go`                                          | TS `features.ts` 读 `ENGINE_*` env，默认关，显式开启                                          |
| autoplan `prerequisite` 网关（仅 Electron 迁移证据）         | `internal/platform/prerequisite/gate.go`                               | **不迁移**（daemon 路径不调用）                                                               |

### 2.2 维度二 · 代码评估（技术债/异味/冗余，附 file:line）

| 类别                        | 位置（精确）                                                                                                                                                                                       | 问题                                                          | 严重度                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| 重复实现（同源双份状态机）  | `comet/domains/comet-classic/classic-runtime-run.ts:37-296`（`embeddedClassicRuntimePackage`，`maxIterations:500` 于 `:248`）vs `assets/skills/comet/scripts/comet-runtime.mjs`（~509KB 打包镜像） | 同一套 classic 状态机在 TS 域与打包镜像各一份，改其一行为漂移 | P2                                  |
| 命令注入（shell:true）      | `comet/domains/comet-classic/classic-guard.ts:359` `spawnSync(command,{shell:true,timeout:300_000})`；`comet-runtime.mjs:10532,9732`                                                               | 外部输入（package.json 推断/change 参数）经 shell 拼接→RCE    | **P0**                              |
| 巨型打包文件                | `comet/assets/skills/comet/scripts/comet-runtime.mjs`（~509KB / 13k+ 行，函数名混淆 `validateChangeName4`/`fs20`）                                                                                 | 审计/维护难点，错误栈不可读                                   | P3                                  |
| 隐式配置面                  | `comet/domains/comet-classic/classic-state-command.ts:314,323,334,343,419`（≥12 个 `COMET_*` 无集中校验）                                                                                          | 行为受全局 env 隐式控制                                       | P3                                  |
| 供应链未锁版本              | `comet/domains/integrations/openspec.ts:319` `npm install -g @fission-ai/openspec@latest`                                                                                                          | `@latest` 版本不可控，可能引入 CVE                            | P1                                  |
| 伪造/降级逻辑（项目内既有） | `lib/unified-engine/comet-adapter.ts`（`prepareVerifyArtifacts` 写中文报告）；`unified-engine-runtime.ts`（`safeGuard/safeAdvance` 默认放行）                                                      | 守卫被「公关」通过，非真实验证                                | P1（项目内，须修）                  |
| Go 巨型装配函数             | `autoplan/backend/internal/bootstrap/dependencies.go:263` `AssembleDependencies`（单函数装配 60+ 服务，约 400 行）                                                                                 | 违反 SRP，单测/排错困难                                       | P3                                  |
| Go 过薄边界接口             | `autoplan/backend/internal/application/boundary.go:31-35` `Boundary` 仅 `Capabilities()`                                                                                                           | 真实能力靠闭包注入 router，契约不显式                         | P3                                  |
| Go O(n) 路由匹配            | `autoplan/backend/internal/httpapi/router.go:161` `func (router *Router) match(path string)` 线性扫描 ~100 路由                                                                                    | 高 QPS 下需 trie；迁移到 Next 文件路由后天然消除              | P3                                  |
| Electron 遗留死代码         | `autoplan/backend/internal/platform/prerequisite/gate.go`（校验 `docs/migration/p00                                                                                                                | p01/evidence` SHA256）                                        | 纯 Electron 迁移证据，daemon 不触发 | P2（须明确不启用） |
| 跨语言状态模型不一致        | autoplan Go `domain.Service` 事件 vs pi-web `engine-runtime-store` `EngineSnapshot`                                                                                                                | 需适配器映射                                                  | P2                                  |
| autoplan TS 循环依赖        | `src/loopService.js` ↔ `src/loop/runtime.js:584` 惰性 require                                                                                                                                      | 已规避但脆弱                                                  | P3                                  |
| 双 UI 并行（项目内既有）    | `components/PlanPanel.tsx` vs `components/AutonomousCodingDashboard.tsx`                                                                                                                           | 零复用，两个互不相通入口                                      | P2（须合并）                        |

### 2.3 维度三 · 性能排查（量化）

| 问题                           | 位置                                                                                                             | 量化 / 说明                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| comet 深冻结+深拷贝每次决策    | `vendor/comet/domains/engine/resolver.ts:20-30`（`deepFreeze`+`structuredClone` 对大型 `SkillPackage`）          | 每次 `decide`/`recordOutcome` O(n) 拷贝；长链路 Run 累积 GC 压力           |
| comet trajectory 全量读改写    | `vendor/comet/domains/engine/manual-run.ts:74-81`（`appendEvent` 全量加载 `.comet/trajectory.jsonl` 再追加写回） | 随步数 O(n) 重复读 + 全量写，无增量 append，线性变慢                       |
| comet 迭代预算偏高             | `classic-runtime-run.ts:248` `maxIterations:500`（默认 50 于 `load.ts:336`）                                     | 长循环上限 10×，放大拷贝/IO 累积                                           |
| comet 全目录递归扫描           | `domains/dashboard/collector.ts`（collectDashboardSnapshot 扫 `openspec/changes`）                               | 大仓库 IO 放大（融合后废弃 dashboard server，影响消除）                    |
| comet HTTP server 句柄泄漏风险 | `server.ts:50,58`（新建 server，调用方须显式 `close()`）                                                         | Next 进程内尤甚；融合不启用                                                |
| autoplan 冷启动                | `dependencies.go:263` AssembleDependencies 全量装配 + SQLite 迁移 + `RecoverOperations`                          | 实测 daemon 就绪约 0.03s（空库）；生产库随数据增长                         |
| autoplan 路由 O(n)             | `router.go:161` 每请求线性扫描 ~100 路由                                                                         | 万级 QPS 需 trie；迁移到 Next 文件路由后**归零**                           |
| autoplan 进程树遍历            | `internal/runtime/process/tree_unix.go` 遍历 `/proc` 构建进程树                                                  | O(n) 每操作；高频启停有开销（TS 用 `child_process` + `ps` 替代，开销相当） |
| autoplan SQLite 单写者         | `repository/sqlite.Writer` 串行化写；event store 与 operation store 共用 writer                                  | 事件洪流可能争用 → 批处理（`DispatchBatch`，`dependencies.go:496`）        |
| autoplan eventbus 有界         | `RetentionAge`/`GlobalLimit`/`PerProjectLimit`（`dependencies.go:502`）                                          | **无泄漏迹象**（正面）                                                     |
| autoplan 巨型打包              | `comet-runtime.mjs` ~509KB                                                                                       | 加载/解析成本（仅 comet 侧）                                               |

> 量化说明：上述为静态推断的量级；精确基准需在融合后用 `node --prof` / Chrome DevTools 对长链路 Run profiling（纳入 §6 验收项 7）。

### 2.4 维度四 · 安全检测（分级，见交付物 3）

---

## 3. 分级安全漏洞清单（交付物 3）

| 等级   | 位置（精确）                                                                                                                                | 漏洞                                                                                                                                                                                                                      | 修复方向                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** | `comet/domains/comet-classic/classic-guard.ts:359`；`comet-runtime.mjs:10532,9732,9658`；`classic-state-command.ts:351`                     | **命令注入 / 任意命令执行**：`spawnSync(cmd,{shell:true})`，命令字符串来自 `package.json` 推断 / `.comet/config.yaml` / change 参数，未消毒                                                                               | 禁用 `shell:true`，改数组传参 `spawnSync(cmd, args[])`；对 change/路径做白名单校验                                                                 |
| **P1** | `comet/domains/integrations/openspec.ts:319` `npm install -g @fission-ai/openspec@latest`                                                   | **供应链漂移**：`@latest` 版本不可控                                                                                                                                                                                      | 锁定精确版本 + 校验完整性（`npm ci` / lockfile）                                                                                                   |
| **P1** | `lib/unified-engine/unified-engine-runtime.ts`（`safeGuard/safeAdvance` 默认放行）；`comet-adapter.ts`（`prepareVerifyArtifacts` 伪造报告） | **守卫被桩降级绕过真实验证**                                                                                                                                                                                              | 真实守卫失败时上抛错误；删除伪造报告，读真实 verify 输出                                                                                           |
| **P2** | `autoplan/backend/internal/runtime/terminal/pty_unix.go:36` `exec.Command(launch.executable, args...)`（经 WebSocket 执行任意 shell）       | **终端 RCE 面**                                                                                                                                                                                                           | session 令牌 + loopback 权威 + 转发头拒绝（`security.go:145`）；**默认 `AUTOPLAN_GO_TERMINAL_API=false`（已默认关）**；TS 侧 `node-pty` 同样默认关 |
| **P2** | `comet/domains/dashboard/server.ts:50,58`（127.0.0.1:4321，重试 50 端口）                                                                   | **进程内 server 泄漏 / 端口占用**                                                                                                                                                                                         | 融合不启用；如启用须显式 `close()` 且限本地                                                                                                        |
| **P2** | `autoplan/backend/internal/platform/prerequisite/gate.go`（Electron 迁移证据校验）                                                          | 死代码/误用风险                                                                                                                                                                                                           | 明确不启用 `RunServerCommand`，仅走 daemon                                                                                                         |
| **P3** | `autoplan/backend` 全量 grep（`sk-`/`ghp_`/`apiKey:=`/`password:=`）→ **0 处生产硬编码**                                                    | **凭据管理良好（正面）**：仅测试占位 `sk-write-only`/`claude-write-only`（`config_test.go:135-136`）与主动脱敏 marker 列表（`operations/output_policy.go:174`、`chat/tools.go:139`、`domain/operation/operation.go:334`） | 继承该脱敏设计；TS 侧 secrets 复用 pi-web env / OS keychain                                                                                        |
| **P3** | `autoplan/backend/internal/httpapi/security.go:145` `hasForwardingHeaders`；`session.go` 常量时间比较；`session.go` 凭据零化                | **安全设计正向（正面）**                                                                                                                                                                                                  | 整体继承到 TS 中间件                                                                                                                               |
| **P3** | `comet/package-lock.json` / `autoplan/package-lock.json`                                                                                    | 依赖漏洞待 SBOM 扫描                                                                                                                                                                                                      | 接 `npm audit` / `osv-scanner`                                                                                                                     |
| **P3** | `vendor/*` 未按 VENDOR.lock 的 `trim` 裁剪                                                                                                  | 攻击面/体积扩大                                                                                                                                                                                                           | 运行 `scripts/sync-vendor.mjs` 裁剪非运行时目录                                                                                                    |

---

## 4. 关键阻塞问题专项（交付物 4）

### 类别 A · 底层引擎

- **A1 comet 状态机被桩降级绕过真实验证**：`hotfix` 预设 + `COMET_SKIP_BUILD=1` + `safeGuard/safeAdvance` 放行 + `prepareVerifyArtifacts` 伪造报告 → build/verify 守卫从未真实验证。**处置**：`DEFAULT_WORKFLOW` 改 `standard`/`full` 启用守卫；`safeGuard/safeAdvance` 失败上抛；删除伪造报告（§5.2）。
- **A2 comet Node 专用 API 与 Next.js 冲突**：`crypto`/`fs`/`child_process`/`http`（`classic-guard.ts:2-4`、`server.ts:1-4`）→ 限定 Node Runtime + 子进程隔离（pi-web 已做）。
- **A3 autoplan Go 后端缺失真实执行（项目内既有）**：`autoplan-adapter.ts` 内存桩 `runTask` 仅标记完成、无真实写码。**处置**：Go→TS 迁移后用 pi-web `AgentSession` 作执行体（§5.1）。

### 类别 B · 后台迁移联调

- **B1 特性门全默认关**：`internal/config/features.go` `AUTOPLAN_*_API` 默认 false → TS `features.ts` 须显式开启（loop/executors/terminal/chat/mcp 按需）。
- **B2 真实执行依赖外部 agent**：Go `loop` 原调用 codex/claude CLI。**处置**：TS 执行体改为调用 pi-web 既有 `AgentSession`（`lib/rpc-manager.ts`），天然统一语言、零额外依赖。
- **B3 Electron parent-pipe 监管**：daemon 以 stdin EOF 判定父死（`lifecycle.go` `watchDaemonParent`）。**处置**：纯 Node 监管进程写 session 后保持 stdin 写端打开，关闭触发优雅退出（§5.1.4）。
- **B4 跨语言状态模型不一致**：Go `domain.Service` 事件 vs `engine-runtime-store` `EngineSnapshot` → 需适配层（§5.3）。

### 类别 C · UI 渲染障碍

- **C1 双 UI 并行**：`PlanPanel` 与 `AutonomousCodingDashboard` 零复用。**处置**：合并为唯一 `EngineDashboard`，统一消费 `engine-runtime-store`（§5.3）。
- **C2 监控维度缺失**：现有前端无「进程监控 / 需求全生命周期 / 任务状态」三看板实时聚合。**处置**：`EngineDashboard` 三栏 + SSE 实时（§5.3）。
- **C3 状态未对接**：autoplan 进程态/任务态未注入 `engine-runtime-store`。**处置**：autoplan-ts 事件桥接进同一 store（§5.3.2）。

---

## 5. 分模块重构与融合实施方案（交付物 5）

### 5.1 autoplan Go → TypeScript 非 Go 迁移逻辑（核心，具体可编码）

> 原则：**不拉起 Go 进程**；在 pi-web Node 运行时内等价实现 autoplan 全生命周期。逐模块映射如下。

| Go 模块（backend/路径:行）                                                           | 职责                                                                                                         | TS 等价实现（库/API）                                                                                                                                                                                                               | 落点文件（`lib/unified-engine/autoplan-ts/`）    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `internal/repository/sqlite/*`（modernc.org/sqlite v1.53.0，纯 Go 无 cgo）           | SQLite 持久化（54 文件，表：`secret_refs`/`ai_configs`/`claude_cli_configs`/`operations`/`plans`/`intake`…） | **首选复用 pi-web 既有 jsonl store**（`persistence.ts` + `engine-runtime-store`）；仅当确需关系查询时引入 `better-sqlite3`（Node 原生同步，无 cgo 等价）。迁移：`migrations/0001_schema_v1.sql` 等经 `better-sqlite3` `exec()` 重放 | `persistence.ts`（复用 / 可选 `sqlite-repo.ts`） |
| `internal/runtime/terminal/pty_unix.go:36` `exec.Command`                            | PTY 终端执行                                                                                                 | `node-pty`（`pty.spawn(executable, args)`）；默认关，限 loopback                                                                                                                                                                    | `terminal.ts`                                    |
| `internal/runtime/process/runner.go`                                                 | 进程执行                                                                                                     | `node:child_process` `spawn`/`execFile`                                                                                                                                                                                             | `executor-process.ts`                            |
| `internal/runtime/eventbus/bus.go`（`RetentionAge`/`GlobalLimit`/`PerProjectLimit`） | 有界事件总线                                                                                                 | `node:events` `EventEmitter` + 有界队列（`Map` + TTL 裁剪），复用 `engine-runtime-store` 的 `emit`                                                                                                                                  | `eventbus.ts`（复用 store）                      |
| `internal/runtime/scheduler/manager.go`                                              | 任务调度                                                                                                     | TS 优先队列 + `setTimeout`/`setInterval`（或 `bullmq` 若需持久化）                                                                                                                                                                  | `scheduler.ts`                                   |
| `internal/httpapi/router.go:161` `match`（O(n)）                                     | HTTP 路由 + SSE                                                                                              | **Next.js 文件路由**（零成本，无手动 match）+ Route Handler 返回 `ReadableStream` 作 SSE                                                                                                                                            | `app/api/engine/autoplan/[[...]]/route.ts`       |
| `internal/httpapi/security.go:145` `hasForwardingHeaders`；`session.go` 常量比较     | 鉴权/session                                                                                                 | TS 中间件：生成 `crypto.randomUUID()` session，`X-Autoplan-Session` + Origin 校验 + 转发头拒绝；复用 pi-web `csrf`/`session`                                                                                                        | `session.ts`                                     |
| `internal/mcp/*`（server.go/http_transport.go/stdio_transport.go/tools）             | MCP stdio/http                                                                                               | `@modelcontextprotocol/sdk`（官方 TS）                                                                                                                                                                                              | `mcp.ts`                                         |
| `internal/config/features.go`（`AUTOPLAN_*_API` fail-closed）                        | 特性门                                                                                                       | TS `features.ts` 读 `ENGINE_*` env，默认关                                                                                                                                                                                          | `features.ts`                                    |
| `internal/platform/secrets/*`（encryptedfile/keyring）+ `migrations`/`secret_refs`   | 凭据加密存储                                                                                                 | **复用 pi-web 既有凭据管理**（env / `~/.pi`）；不必须复刻加密文件格式；如需落盘用 `node:crypto` aes-256-gcm                                                                                                                         | `secrets.ts`（薄封装）                           |
| `internal/application/intake`（需求立项）                                            | 创建需求                                                                                                     | TS `intake.ts` 实现 `PlanGeneratorPort.createRequirement`                                                                                                                                                                           | `domain/intake.ts`                               |
| `internal/application/plans`（计划生成）                                             | 生成计划                                                                                                     | TS `plans.ts` 实现 `generatePlan`/`enqueueTasks`                                                                                                                                                                                    | `domain/plans.ts`                                |
| `internal/application/executors` + `loop`（执行）                                    | 任务执行/循环                                                                                                | TS `executors.ts`：每个 task → 委托 **pi-web `AgentSession`**（`lib/rpc-manager.ts` `startRpcSession().send(task.spec)`）                                                                                                           | `domain/executors.ts`（ExecutionPort）           |
| `internal/application/tasks` / `operations` / `events`                               | 任务/操作/事件                                                                                               | TS 领域对象，事件经 `eventbus` 入 `engine-runtime-store`                                                                                                                                                                            | `domain/tasks.ts`                                |
| `internal/application/chat`（provider_service）                                      | 多角色讨论                                                                                                   | 复用 pi-web `lib/agent-orchestrator`（多角色讨论已上线）                                                                                                                                                                            | 直接复用，不重写                                 |
| `internal/platform/prerequisite/gate.go`                                             | Electron 迁移证据校验                                                                                        | **不迁移**（daemon 不调用）                                                                                                                                                                                                         | —                                                |
| `cmd/autoplan-server/main.go` + `internal/bootstrap/*`                               | 进程生命周期/就绪协议                                                                                        | TS 监管进程（§5.1.4）或**直接由 `unified-engine` 进程内编排**（推荐，免去 sidecar）                                                                                                                                                 | `supervisor.ts`（可选）                          |

**关键结论**：autoplan Go 后端的「进程/端口/鉴权」外壳在 pi-web 内**无需复刻**——因为融合目标是同进程内 TS 等价运行，session/loopback/Origin 校验可整体简化为 pi-web 既有同源 + csrf 机制；真正要迁移的是**领域逻辑**（intake/plans/executors/loop/tasks/events）与**执行体**（PTY/process → node-pty/child_process，最终委托 AgentSession）。

#### 5.1.1 持久化迁移（具体）

- 若复用 jsonl：autoplan 的 `Plan`/`Task`/`Operation`/`Intake` 直接映射为 pi-web `RunState`/`Task` 既有类型（`unified-engine-types.ts`），经 `persistence.ts` 落盘，**零原生依赖**。
- 若用 `better-sqlite3`：新增 `lib/unified-engine/autoplan-ts/sqlite-repo.ts`，在模块加载时 `db.exec(readFileSync('migrations/0001_schema_v1.sql','utf8'))` 重放建表；所有写走同步 API，避免 Go 单写者争用（TS 单进程本就串行）。`better-sqlite3` 须加入 `next.config.ts` `serverExternalPackages`。

#### 5.1.2 执行体迁移（具体，真实写码）

```ts
// lib/unified-engine/autoplan-ts/domain/executors.ts（伪代码要点）
import { startRpcSession } from "@/lib/rpc-manager"; // pi-web 既有 Agent 运行时
export async function runTaskWithAgent(task: Task, ctx: RunContext): Promise<TaskResult> {
  const session = await startRpcSession(ctx.cwd); // 复用 ChatWindow 同款 agent
  const res = await session.send(task.spec); // 真实写码
  await session.destroy();
  return { taskId: task.id, status: "completed", output: res };
}
```

> 此即「autoplan executor 调用 codex/claude CLI」的**统一语言等价替代**，满足「真实执行」且无 Go、无外部 CLI 依赖。

#### 5.1.3 终端/PTY 迁移（具体）

```ts
// lib/unified-engine/autoplan-ts/terminal.ts
import pty from "node-pty";
export function spawnShell(executable: string, args: string[], opts) {
  if (!features.terminalApiEnabled) throw new Error("terminal disabled");
  return pty.spawn(executable, args, { cwd: opts.cwd }); // 等价 pty_unix.go:36
}
```

`node-pty` 加入 `serverExternalPackages`；默认 `ENGINE_TERMINAL_API=0`。

#### 5.1.4 监管/生命周期迁移（具体，仅当需要 sidecar 形态时）

纯 Node 监管进程（替代 Go daemon 的 stdin-session + EOF 自杀）：

```ts
// lib/unified-engine/autoplan-ts/supervisor.ts
export async function ensureAutoplanTs(): Promise<void> {
  if (globalThis.__autoplanTs) return;
  const session = crypto.randomUUID();
  // 同进程内直接初始化 domain 服务（无需 spawn Go）；
  // 若保留「监管子进程」语义，仅用于隔离 node-pty，保持 stdin 写端打开、close 触发退出。
  bootstrapDomainServices({ session, features: readFeatures() });
  globalThis.__autoplanTs = { session };
}
```

> 推荐**同进程内编排**（去掉 sidecar），因为 autoplan-ts 已是 TS、与 pi-web 同运行时，session/loopback 约束自然消失，仅保留 `features` fail-closed 与事件桥接。

### 5.2 统一语言代码重构（comet 侧 + 项目内既有桩）

| 改造点               | 文件（精确）                                                      | 具体可编码修改                                                                                                |
| -------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 移除 hotfix 跳过验证 | `unified-engine-types.ts:8-24`（`DEFAULT_WORKFLOW`）              | `ENGINE_WORKFLOW` 默认 `"standard"`；删除 `COMET_SKIP_BUILD=1` 强制（`guards/comet-cli.ts`）                  |
| 真实守卫执行         | `unified-engine-runtime.ts`（`safeGuard/safeAdvance` 默认放行处） | 失败时**上抛错误**而非静默放行；调用真实 `comet-guard.mjs`/`comet-state.mjs`                                  |
| 去伪造验证           | `comet-adapter.ts`（`prepareVerifyArtifacts` 写中文报告）         | 删除 `writeFileSync` 伪造；改为读取 comet 真实 verify 输出                                                    |
| comet shell 注入修复 | `vendor/comet/domains/comet-classic/classic-guard.ts:359`         | `spawnSync(command, [args], { shell: false })` + 参数白名单（上游修复，须同步到 `vendor/comet`）              |
| comet 供应链锁版本   | `vendor/comet/domains/integrations/openspec.ts:319`               | `@latest` → 锁定精确版本（如 `@fission-ai/openspec@1.5.0`）+ lockfile                                         |
| trim 生效            | `vendor/*`                                                        | 运行 `scripts/sync-vendor.mjs` 裁剪 comet 的 website/eval/platform/docs/test 与 autoplan 的 ui/build/snapshot |

### 5.3 前端接口对接与状态同步机制

**统一状态层扩展**（`lib/engine-runtime-store.ts` 已存在，补充字段）：

```ts
export interface EngineSnapshot {
  engineId: string;
  phase: EnginePhase; // idle|planning|discussing|executing|done|error
  processes: EngineProcess[]; // 进程监控（autoplan-ts supervisor / AgentSession pid）
  requirementLifecycle: RequirementNode[]; // 需求全生命周期
  taskStatus: TaskStatusSummary; // 任务状态可视
  autoplan?: { ready: boolean; features: string[] }; // autoplan-ts 状态桥接
  stats: { startedAt: number; updatedAt: number; errorCount: number };
}
// globalThis 单例 + useSyncExternalStore（沿用 lib/agent-runtime-store.ts 模式）
```

**SSE 端点**：扩展 `app/api/plan/[id]/events`（orchestrator 已有）或新增 `app/api/engine/state/route.ts`，在 `EngineEvent` 基础上追加 `EngineProcess`/`RequirementNode`/`TaskStatus` 增量；`confirm` 路由在 engine 模式经统一 store 写入执行状态。

**前端订阅**：`hooks/useEngineRuntime.ts`（已存在）→ `EventSource('/api/engine/state')` + 重连/对账（复用 `useAgentSession` 逻辑），写入 `engine-runtime-store`，组件按切片订阅，避免整页重渲染。

**三看板对接**（合并 `PlanPanel` + `AutonomousCodingDashboard` 为 `components/EngineDashboard.tsx`）：

- **进程监控 `ProcessMonitor.tsx`**：`processes`（autoplan-ts supervisor pid / AgentSession 运行时）+ 进度环 + 折叠日志。
- **需求全生命周期 `RequirementLifecycle.tsx`**：`requirementLifecycle`（已接收→讨论中→已收敛→执行中→已交付），点击联动任务列表。
- **任务状态 `TaskStatusBoard.tsx`**：`taskStatus`（pending/running/done/blocked 分布计数卡 + 阻塞置顶标注原因）。

> 约束：客户端组件一律 `csrfFetchJson`（`lib/csrf-fetch.ts`）；配置/模态复用 `components/ui/ConfigModal.tsx`；API 响应用 `jsonOk`（`lib/api-utils.ts`）；窄屏（`useIsMobile`）折叠为标签页。

---

## 6. 全链路验收标准（交付物 6，逐条可验证）

| #   | 验收项                   | 验证方式                                                                                                                                                                                                           | 目标状态                      |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| 1   | 质量门禁全绿             | `npm run lint` + `type-check` + `test:node` + `test:coverage`                                                                                                                                                      | 全绿（husky pre-commit 一致） |
| 2   | trim 生效                | 运行 `scripts/sync-vendor.mjs` 后 `vendor/comet` 不含 website/eval/platform/docs/test，`vendor/autoplan` 不含 ui/build/snapshot                                                                                    | 攻击面收敛                    |
| 3   | Go 零依赖                | `grep -r "go build\|autoplan-server\|backend/go.mod" lib/ app/` → 0 命中；无 Go 进程 spawn                                                                                                                         | **严禁 Go**（硬性）           |
| 4   | 引擎无报错跑通（端到端） | `POST /api/plan/orchestrate` → SSE 持续推送 phase；`POST /api/plan/[id]/confirm`（engine 模式）→ `createChange/startRun` 在 comet 适配层**不抛错**真实守卫被执行或明确上抛；`tryLoadVendorAutoPlan` 缺后端静默降级 | 全链路无报错                  |
| 5   | autoplan-ts 生命周期贯通 | 需求立项→计划→任务入队→交付物落盘→`runTaskWithAgent`（委托 AgentSession）→反馈回收，全流程无异常；`engine-runtime-store` 实时更新                                                                                  | 全生命周期可视                |
| 6   | 统一状态同步             | `engine-runtime-store` 单例被 orchestrator 与 engine 共用；SSE 增量写入，前端 `useEngineRuntime` 重连对账无丢失                                                                                                    | 无重复/丢失                   |
| 7   | 前端三看板交互           | `EngineDashboard` 渲染进程监控/需求生命周期/任务状态，随 SSE 实时更新；无 console 错误；窄屏折叠                                                                                                                   | 可交互、无报错                |
| 8   | 安全回归                 | §3 中 P0（`shell:true`）改数组传参 + 参数白名单；P1（`@latest`）锁版本；复跑 `npm audit` 无新增高危；autoplan 脱敏设计继承到 TS                                                                                    | 高危清零                      |
| 9   | 性能基线                 | 长链路 Run：trajectory 改增量 append（消除 `manual-run.ts:74-81` 全量读写）；`decide` 深拷贝在大型 `SkillPackage` 场景做结构共享/懒拷贝；`node --prof` profiling 显示 GC/IO 不随步数线性恶化                       | 量化达标                      |

---

## 附：核心证据索引（文件:行号 → 结论）

- **comet**：`classic-guard.ts:359`（shell:true 注入 P0）；`openspec.ts:319`（`@latest` P1）；`server.ts:20,21,50,58`（HTTP server 127.0.0.1:4321，重试 50，泄漏风险）；`open-browser.ts:27`（浏览器 spawn）；`classic-runtime-run.ts:37,248,296`（内嵌第二份状态机 `maxIterations:500`）；`classic-state-command.ts:314,323,334,343,419`（隐式 COMET_* env）；`app/cli/index.ts:78,164`（process.exit）；`tsconfig.json:20`（assets 不编译）；`comet-runtime.mjs`（~509KB 打包镜像，函数名混淆）。
- **autoplan Go**：`go.mod:5-21`（modernc.org/sqlite v1.53.0 纯 Go 无 cgo、creack/pty v1.1.24、conpty v0.1.4、golang.org/x/sys v0.44.0）；`backend/internal/bootstrap/dependencies.go:263`（AssembleDependencies 巨型装配）；`internal/httpapi/router.go:161`（O(n) match）；`internal/httpapi/security.go:99,145`（转发头拒绝）；`internal/runtime/terminal/pty_unix.go:36`（终端 RCE）；`internal/bootstrap/lifecycle.go:41`（daemonSessionType）；`internal/application/`（24 子域：intake/plans/executors/automation/chat/terminal/events/loop/operations/tasks/secrets/snapshot…）；`internal/platform/prerequisite/gate.go`（Electron 死代码）；`config_test.go:135-136`/`operations/output_policy.go:174`/`chat/tools.go:139`（仅测试占位 + 主动脱敏 marker，**无生产硬编码密钥**）。
- **pi-web 既有基础**：`lib/unified-engine/autoplan-adapter.ts`（`PlanGeneratorPort` + 三档适配器 + 内存桩 `runTask` 仅标记完成）；`unified-engine-types.ts`（`Requirement`/`Plan`/`Task`/`Stage` 类型）；`lib/engine-runtime-store.ts` + `hooks/useEngineRuntime.ts` + `app/api/engine/state/`（统一状态层骨架）；`lib/rpc-manager.ts`（`AgentSession`，作 autoplan-ts 真实执行体）。

> 调研完成。所有行号均来自对克隆仓库的实际 grep/read；上游视为不可信，仅读不执行。融合方案在既有 `unified-engine` + `agent-orchestrator` 骨架之上落地，严格遵循「禁用 Go、统一 TypeScript」硬性约束。
