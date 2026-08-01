# 管线铁律与合并纪律（Pipeline Policy）

> 本文档是 pi-web 仓库的**合并纪律红线**，供提交人、Reviewer 与 Maintainer 直接引用。
> 铁律内容不可妥协；任何「特殊情况」不构成绕过理由。Hotfix 也不例外。

---

## 0. 总原则

凡是合并到受保护分支（默认 `main` / `master`）的变更，必须满足：

1. CI/CD 流水线全绿（铁律一）；
2. 增量覆盖率达标且不拉低全量质量（铁律二）；
3. 按风险等级配齐 LGTM（铁律三）；
4. 凡涉及对外 API 变更，必须有集成测试（铁律四）。

铁律五仅限 **P0 生产故障** 临时豁免二、三，且附带 24 小时偿债义务。

---

## 铁律一：管线绝对否决权（The Pipeline Veto）

- **内容**：CI 流水线中 **编译（Build）**、**静态扫描（Lint）**、**全部单测 / 集成测试**，任何一项为 `Failed`，该 PR **物理禁止合并**。
- **不可妥协点**：无任何借口绕过。即便是 Hotfix，也必须先跑通流水线。
- **本仓库落地**：
  - 本地闸门：`npm run ci` = `format:check && lint && type-check && test:node && test:coverage`，提交前必须本地全绿。
  - 远程强制（需 Maintainer 在 GitLab/GitHub 设置）：受保护分支勾选 **「Require status checks to pass before merging」**，并将上述 CI job 全部列为必过检查；同时勾选 **「Do not allow bypassing the above settings」**（禁止管理员绕过）。

---

## 铁律二：增量覆盖率硬门槛（The Delta Coverage Gate）

- **内容**：废除「全量覆盖率 95%」式幼稚指标，改为 **「本 MR 新增 / 修改代码（Diff）的行覆盖率必须 ≥ 85%」**。
- **补充约束**：若本次变更导致 **项目整体全量覆盖率** 相较目标分支 **下降超过 0.5%**，同样判定不通过。
- **不可妥协点**：覆盖率只算「你改的那几行」，历史烂代码的锅不背；但也不能把整体质量拉下水。
- **本仓库落地建议**：
  - 工具：在 `vitest` 覆盖率基础上引入 **增量覆盖率** 度量（如 `c8`/`nyc --changed` 或 PR 平台的 coverage diff / Codecov `threshold` 的 `patch` 维度），配置 `patch >= 85`、`project 下降 <= 0.5%`。
  - 纯逻辑模块（见 AGENTS.md「纯逻辑 / 服务侧模块约定」）变更须同步补 `node:test` 或 vitest 单测，确保增量可达标。
  - 计算口径：仅统计 `app/`、`components/`、`hooks/`、`lib/` 下被 Diff 触及的源文件行；测试文件、类型声明、配置文件不计入分母。

---

## 铁律三：风险分级审查制（Risk-based LGTM）

取消「一刀切两个 LGTM」，改为按风险分级：

| 级别      | 范围                                     | 最少 LGTM | 特殊要求                                   |
| --------- | ---------------------------------------- | --------- | ------------------------------------------ |
| 🔴 核心级 | 支付、账密、核心算法、数据库 Schema 变更 | **2**     | 其中 **1 个必须来自该模块指定 Code Owner** |
| 🟡 普通级 | 常规业务 CRUD、工具类封装                | **1**     | —                                          |
| 🟢 零级   | 仅 README、注释、非生产配置              | **0**     | 作者自检后可合并，但流水线仍须全绿         |

- **不可妥协点**：核心模块未经 Owner 签字，合并按钮绝不亮起。
- **本仓库核心级模块与 Code Owner 映射**（初始清单，可随 `CODEOWNERS` 调整）：

  | 模块路径                                                                          | 风险定性                          | 指定 Code Owner |
  | --------------------------------------------------------------------------------- | --------------------------------- | --------------- |
  | `app/middleware.ts`、`lib/csrf.ts`、`lib/csrf-client.ts`、`lib/csrf-fetch.ts`     | 访问令牌 / CSRF 网关（账密/认证） | 安全负责人      |
  | `lib/session-state-store.ts`、`~/.pi/agent/pi-web-*.json` 侧车 Schema             | 持久化 Schema 变更                | 运行时负责人    |
  | `lib/prompt-system/`、`lib/rpc-manager.ts`、`lib/pi-sdk-adapter.ts`               | 核心算法 / 智能体编排             | 引擎负责人      |
  | `lib/plugin-master-switch.ts`、`lib/mcp-probe-guard.ts`、`lib/skill-pkg-guard.ts` | 权限 / 安装准入（安全）           | 安全负责人      |

  > 远程落地：仓库根放置 `CODEOWNERS`，对上述路径标注 `* @owner`，并在分支保护中开启 **「Require review from Code Owners」**。

- **普通级**：其余 `app/api/**`、`components/**`、`hooks/**`、`lib/**` 业务变更。
- **零级**：`.md` 文档、`*.config.*` 非生产配置、`lib/i18n/*.ts` 纯文案（无逻辑分支改动）等。

---

## 铁律四：接口契约必测（The Contract Mandate）

- **内容**：凡涉及对外提供 API（HTTP / RPC / 消息队列）的变更，**必须包含至少 1 个集成测试用例**，该用例须真实调用测试环境数据库或下游 Stub 服务。
- **不可妥协点**：**禁止仅用纯 Mock 的单测代替**。没有接口测试的 API 变更，Reviewer 有权直接 **Request Changes**，无需讨论业务逻辑对错。
- **本仓库落地**：
  - 集成测试定义：调用真实路由处理器（经 `next` 测试运行时或 `node:test` + 轻量 HTTP server），对真实文件系统（如 `~/.pi/agent` 临时目录）或真实 `child_process` 跑 `git`，而非 `vi.mock` 掉整层。
  - 路由级测试可复用 `lib/test-fetch-mock.ts` 思路但须指向真实实现；纯 `vi.mock("@/lib/xxx")` 屏蔽实现的用例**不计入**契约测试。
  - 标注：API 变更的 PR 描述须列明「契约测试文件路径」，Reviewer 据此核验。

---

## 铁律五：紧急熔断与追偿（The Emergency Breaker）

- **内容**：仅限 **P0 级生产故障**（服务宕机 / 核心链路阻断）允许**紧急跳过**铁律二、三（覆盖率与双审）。
- **追偿铁则**：提交人须在 **24 个自然小时** 内发起补救 PR，补齐缺失的测试与 Review。超时未补，将 **自动冻结该提交人接下来 72 小时的所有合并权限**。
- **不可妥协点**：紧急通道是「债务通道」，不是「免罪通道」，必须计息偿还。
- **本仓库落地**：
  - 紧急合并须在 PR / Commit 标题前缀 `[P0-HOTFIX]`，并在描述写明故障单号与偿债 PR 计划。
  - 偿债 PR 合并前，提交人不得再合并其他 PR（Maintainer 凭描述手动冻结，或接 bot 自动执行 72h 冻结）。
  - 非 P0（含性能优化、体验改进、常规需求）一律**不适用**本铁律，走正常一/二/三/四。

---

## 合并前自检清单（提交人用）

- [ ] 本地 `npm run ci` 全绿（铁律一）
- [ ] 若改了 `app/ components/ hooks/ lib/` 源码：增量覆盖率 ≥ 85% 且全量降幅 ≤ 0.5%（铁律二）
- [ ] 按风险级别配齐 LGTM，核心级含 Code Owner 签字（铁律三）
- [ ] 若有对外 API 变更：至少有 1 个真实集成测试（铁律四）
- [ ] 非 P0 不得走铁律五；若走，标题 `[P0-HOTFIX]` 且 24h 内补偿债 PR

---

## 维护说明

- 本文件为团队约定，由 Maintainer 维护。核心模块 / Code Owner 清单变更须同步更新 `CODEOWNERS` 与本文件 §铁律三表格。
- 远程侧（分支保护、状态检查、CODEOWNERS 必审）不在此文件自动生效，需 Maintainer 在 GitLab/GitHub 仓库设置中落实。

### 本仓库已落地状态（2026-08-01，solo 开发）

- GitHub `pwl1987/pi-web` 的 `main` 分支已开启分支保护（经 `gh api` 写入）：
  - `required_status_checks.strict=true`，强制三个 CI check 通过：`Lint, Format, Type-Check` / `Build (ubuntu-latest)` / `Test & Coverage (ubuntu-latest)`；
  - `enforce_admins=true`（owner 亦不可绕过）；
  - **不要求审批**（`required_pull_request_reviews` 已移除）：GitHub 默认禁止作者批准自己的 PR，solo 开发无第二双眼睛，故以「`main` 受保护不可直推 + 强制开 PR + CI 三件套必过」作为实质闸门；铁律三的完整双审属多人团队场景，solo 作自律项；
  - `allow_force_pushes=false` / `allow_deletions=false`。
- **编译门槛已闭环（2026-08-01）**：`.github/workflows/ci.yml` 已新增 `Build (ubuntu-latest)` job（`npm run build`，位于质量检查之后、测试之前），并已加入 `main` 分支保护的 `required_status_checks`（连同原先两项共三个强制 check）。注意：该 ci.yml 改动需经 PR 合入 `main` 后，`main` 上的 CI 才会实际运行 build——在此之前，针对 `main` 的保护虽已登记 `Build (ubuntu-latest)`，但需该 PR 的流水线先跑通方可合入。
- 铁律二（增量覆盖率门槛）需接入 Codecov / PR 平台 coverage diff；铁律四（契约测试）为 Review 口径，暂无自动化卡点。
