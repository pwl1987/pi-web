# Vendor 集成：autoplan + comet 融合引擎

本文档说明 pi-web 如何把 [autoplan](https://github.com/lyming99/autoplan) 与
[comet](https://github.com/rpamis/comet) 两个上游仓库以 **Vendor 镜像 + 分层反腐端口 + 白名单 CLI 桥接 + 同步脚本**
的方式融合为统一的「自主长时编程工作流引擎」，以及如何平滑跟进上游迭代。

> 源码级分析详见 [`vendor-autoplan.md`](./vendor-autoplan.md) 与 [`vendor-comet.md`](./vendor-comet.md)。
> 仓库级约定见 `AGENTS.md` 的「Vendor 集成约定」章节。

---

## 1. 为什么是 Vendoring 而非 submodule / subtree / npm

| 方案            | 优点                  | 缺点（对本项目）                                                            |
| --------------- | --------------------- | --------------------------------------------------------------------------- |
| submodule       | git 原生              | 上游需大量源码级改造，子模块指针管理易冲突                                  |
| subtree         | 代码合并进主树        | 改造与上游追踪混在一起，回放/升级痛苦                                       |
| npm 包          | 版本干净              | 上游非库形态（comet 是 prompt+CLI；autoplan 是 Electron），无法作为依赖消费 |
| **Vendor 镜像** | 原样拷贝 + patch 重放 | 需自管 lock + 同步脚本（本项目已提供）                                      |

Web 单体要对上游做**源码级深度改造**，并希望「改造」与「平滑跟进」两全。
Vendor 镜像 + 分层补丁重放对二者最友好：`VENDOR.lock` 让版本可追溯，补丁集让本地改动可重放。

---

## 2. 分层端口架构

复用 `lib/pi` 反腐层（ACL）范式：`接口契约` + `唯一运行时导入点` + `register/get` 注册。

```
browser ── REST/SSE ──> app/api/engine/** ──> UnifiedEngineAdapter（编排）
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
   UnifiedEnginePort        PlanGeneratorPort  WorkflowStateMachinePort
     （业务门面）            （autoplan 侧）      （comet 侧）
              │                 │                 │
              ▼                 ▼                 ▼
   unified-engine-runtime   autoplan-adapter   comet-adapter
     （globalThis 单例）      （唯一 import       （唯一 import
                              vendor/autoplan）    vendor/comet .mjs）
```

| 层                 | 文件                              | 职责                                                                                                   |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 业务门面           | `unified-engine-ports.ts`         | 定义 `UnifiedEnginePort`（`createChange/startRun/pauseRun/resumeRun/getRunState`）+ `register/get/has` |
| 能力端口：计划生成 | `plan-generator-ports.ts`         | `PlanGeneratorPort`：`createRequirement/generatePlan/enqueueTasks/runTask/submitFeedback`              |
| 能力端口：状态机   | `workflow-state-machine-ports.ts` | `WorkflowStateMachinePort`：`openChange/getState/advanceStage/evaluateGuard/resumeRun`（均带 `cwd`）   |
| 适配：autoplan     | `autoplan-adapter.ts`             | 唯一导入 `vendor/autoplan`；`createRequire` 按 flag 懒加载，默认内存态实现                             |
| 适配：comet        | `comet-adapter.ts`                | 唯一调用 `vendor/comet` 的 `.mjs`；通过 `guards/comet-cli.ts` 白名单 bridge                            |
| 白名单 CLI 桥      | `guards/comet-cli.ts`             | `runCometScript(script, args, cwd)`：仅允许 `comet-*.mjs`，校验绝对 `cwd` 与参数，30s 超时             |
| 编排 + 运行时      | `unified-engine-adapter.ts`       | 组合两能力端口 + 运行时，作为融合编排点                                                                |
| 运行时单例         | `unified-engine-runtime.ts`       | `globalThis.__piEngineRuntime` 单例 + 10 分钟空闲销毁 + 事件发布/订阅                                  |
| 类型               | `unified-engine-types.ts`         | `Stage`/`STAGES`/`TaskStatus`/`RunStatus`/`ChangeState`/`RunState`/`EngineEvent` 等融合领域类型        |

**接缝原则**：业务层只依赖 `UnifiedEnginePort`；适配层是对应 vendor 的**唯一**导入/调用点；
编排层不知道 vendor 具体形态，只编排两个能力端口。任一上游可被打桩或替换而不影响业务层。

---

## 3. 融合编排（状态机为骨架，计划生成为内容）

`unified-engine-runtime.ts` 的 `runLoop` 以 comet 五阶段状态机为骨架推进：

```
open → design → build → verify → archive
 │       │        │        │        │
 │       │        │        │        └─ comet-archive.mjs 归档
 │       │        │        └────────── comet-guard.mjs 校验
 │       │        └─── autoplan 拆任务 + 逐任务执行（PlanGeneratorPort）
 │       └────────── autoplan generatePlan（需求 → 计划/任务）
 └─ comet-state.mjs open（建 .comet.yaml 变更）
```

- **design**：引擎调 `PlanGeneratorPort.generatePlan` 把需求拆为计划与任务。
- **build**：逐任务 `runTask`，任务结果写入运行态。
- **verify**：调 `WorkflowStateMachinePort.evaluateGuard`（comet 守卫脚本）。
  - 通过 → `advanceStage` 流转到 `archive`。
  - 失败 → 把守卫错误作为 `submitFeedback` 回灌 autoplan 重规划，回到 `design`。
- **断点续跑**：`run_id` 由 comet 状态机 machine-owned 字段管理，重启后引擎按 `.comet/run-state.json` 恢复。

---

## 4. 安全：不可信供应链隔离

上游视为不可信供应链，三重门禁：

1. **白名单 CLI**：`comet-cli.ts` 的 `ALLOWED_SCRIPTS` 仅含 6 个 `comet-*.mjs`；任何越权脚本名直接抛错。
2. **参数/路径约束**：`cwd` 必须为绝对路径；`args` 禁止 `..` 路径穿越与 `\0`；调用 30s 超时 + 10MB buffer 上限。
3. **Feature flag 门禁**：
   - `ENGINE_AUTOPLAN_VENDOR=1`：才允许 `createRequire` 加载 `vendor/autoplan`（默认关，使用内存态适配）。
   - `ENGINE_AUTOPLAN_EXECUTOR`：autoplan 任务执行器默认关闭（其会 shell-out 到外部 coding agent，属运维风险）。

> 绝不 `import()` 上游运行时代码（`comet-runtime.mjs` 471KB / autoplan Electron 主进程），全部经 `child_process` 隔离。
> `vendor/` 已被 `tsconfig.json` 的 `exclude` 排除，宿主永不类型检查上游。

---

## 5. 更新机制（`scripts/sync-vendor.mjs`）

同步流程（读 `vendor/VENDOR.lock` → 应用补丁 → 裁剪 → 校验）：

```bash
node scripts/sync-vendor.mjs                 # 同步全部 repo
node scripts/sync-vendor.mjs autoplan        # 仅同步指定 repo
node scripts/sync-vendor.mjs --check         # 仅校验 lock/补丁一致性/补丁干跑，不改动
node scripts/sync-vendor.mjs --dry           # 演算但不落盘
node scripts/sync-vendor.mjs --typecheck     # 同步后运行 `npm run type-check` 校验宿主适配层
```

脚本职责：

1. **钉选 commit**：`git fetch --depth 1 <commit>` + `checkout --force` + `clean -fd`，保留 `.git` 供增量同步。
2. **分层补丁**：按文件名排序应用 `vendor/patches/<repo>/*.patch`，前缀约定 `00xx-compat`（兼容，必选）/ `01xx-fusion`（融合，可选）。冲突即抛错中断。
3. **裁剪非运行时**：按 `VENDOR.lock` 的 `trim` 列表删除无关目录（autoplan 的 `src/renderer`/`ui`/构建产物；comet 的 `website`/`docs`/`eval` 等），缩小攻击面与体积。
4. **完整性校验**：`git rev-parse HEAD` 必须等于 `VENDOR.lock` 钉选 commit（防供应链漂移）。
5. **类型校验**：`--typecheck` 调用宿主 `npm run type-check`（vendor 已排除，仅校验 `lib/unified-engine` 适配层是否因上游语义变化而失配）。

`VENDOR.lock` 记录：`remote` / `commit` / `license` / `patches` / `trim`，示例：

```yaml
autoplan:
  remote: https://github.com/lyming99/autoplan
  commit: e06c2b2be052e141ccb19c1e18b16f2927d5cd89
  license: Apache-2.0
  patches: []
  trim:
    - src/renderer
    - ui
comet:
  remote: https://github.com/rpamis/comet
  commit: a2b804d575bc99574b245fd52b45fa42016a130c
  license: MIT
  patches: []
  trim:
    - website
    - docs
```

**跟进上游的步骤**：

1. 在 `VENDOR.lock` 更新目标 `commit`（钉选新版本）。
2. 若需本地改动，新增 `vendor/patches/<repo>/00xx-*.patch`（用 `git diff` 生成，提交前 `git apply --check` 验证）。
3. 跑 `node scripts/sync-vendor.mjs --check` 预检补丁是否仍能干净应用。
4. 跑 `node scripts/sync-vendor.mjs --typecheck` 实际同步并校验宿主适配层。
5. 若上游语义 break change 导致适配层失配，优先在 `lib/unified-engine/*-adapter.ts` 调整，必要时新增 `fusion` 补丁。

---

## 6. 前端与 API

- **API**：`app/api/engine/{changes,runs,runs/[runId],stream}`。变更/运行经 CSRF 双提交校验；`stream` 为 SSE 事件流（`EngineEvent` 增量推送）。
- **前端**：`components/AutonomousCodingDashboard.tsx` 单面板（需求树 + 五阶段 Stepper + 任务看板 + 事件/反馈流），经 `hooks/useUnifiedEngine.ts`（SSE 订阅）接入，挂载于 `AppShell` 的 `engine` 顶栏面板；文案走 `lib/i18n` 的 `engine.*` 键（en/zh 双语，中文模式禁裸英文）。
- **降级**：comet CLI 不可用时引擎退化为内存态、守卫默认放行，保证面板可演示。
