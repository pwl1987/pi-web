# Comet 源码级分析（vendored @ a2b804d）

> 钉选 commit：`a2b804d575bc99574b245fd52b45fa42016a130c`（master）｜License：MIT
> 定位：可恢复的长时间任务工作流 + 编码技能（Skill）平台；将 OpenSpec 工件、Superpowers 方法论、Skill 创建/评估/发布连成闭环。

## 1. 形态与关键事实（集成前提）

- **comet 是 prompt + CLI 驱动，不是库**。没有任何 `createStateMachine()` 之类的导出。
- 真实运行时代码是单个文件：`assets/skills/comet/scripts/comet-runtime.mjs`（约 471 KB，由 `domains/**` 的 TypeScript 编译合并而成）。
- 仓库 `scripts/*.mjs` 是**仓库自身的开发/CI 工具**，与用户工作流状态机**无关**。真正的工作流 CLI 是 `assets/skills/comet/scripts/` 下的 8 个薄包装脚本。
- 每个薄包装脚本仅向 `comet-runtime.mjs` 的 `main()` 注入子命令名：
  - `comet-state.mjs`：`main(["state", ...process.argv.slice(2)])`
  - `comet-guard.mjs`：`main(["guard", ...process.argv.slice(2)])`
  - 其余 `comet-{hook-guard,handoff,archive,yaml-validate,env}.mjs` 同理。
- 统一 CLI 入口：`runClassicCli(argv)`（`comet-runtime.mjs:13113`）。`--json` 为全局标志（输出 JSON，便于程序解析）。

**集成结论**：`WorkflowStateMachinePort` 必须通过 `child_process` 生成 `node <vendor>/comet/assets/skills/comet/scripts/<script>.mjs ...`，且 **cwd 必须设为项目根目录**（脚本按相对路径 `openspec/changes/<name>/.comet.yaml` 读写状态）。绝不 `import()` 该 471KB 运行时。

## 2. 五阶段状态机

- 阶段常量（`comet-runtime.mjs:12095`）：`PHASES3 = ["open", "design", "build", "verify", "archive"]`。
- 转换表 `CLASSIC_TRANSITION_TABLE`（`comet-runtime.mjs:9309`）：

  | Event             | from    | 守卫                                                   |
  | ----------------- | ------- | ------------------------------------------------------ |
  | `open-complete`   | open    | `open-artifacts-present`                               |
  | `design-complete` | design  | `design-evidence-present`                              |
  | `build-complete`  | build   | `build-decisions-selected`                             |
  | `verify-pass`     | verify  | `verification-report-present`, `branch-status-handled` |
  | `verify-fail`     | verify  | `verification-failed`                                  |
  | `archive-reopen`  | archive | `archive-not-finalized`                                |
  | `archived`        | archive | `verify-result-pass`                                   |
  | `preset-escalate` | build   | `preset-workflow`（hotfix/tweak→full）                 |

- 相位推进映射（`comet-runtime.mjs:9362`）：`open→open-complete`、`design→design-complete`、`build→build-complete`、`verify→verify-pass`。
- 实际切换 `applyClassicTransition`（`comet-runtime.mjs:9376+`）：`open-complete`→`design`（或 hotfix/tweak 直接→`build`）；`design-complete`→`build`；`build-complete`→`verify`（`verify_result=pending`）；`verify-pass`→`verify_result=pass` 并触发 archive 守卫。

## 3. CLI 脚本（全部位于 `assets/skills/comet/scripts/`）

### 3.1 `comet-state.mjs`（子命令经 `classicStateCommand`，`comet-runtime.mjs:13006`）

- `init <change-name> <workflow>` — 写 `openspec/changes/<name>/.comet.yaml`（字段集见 §4）。
- `get <change-name> <field>` — 读单字段。
- `set <change-name> <field> <value>` — 写字段（受 `SETTABLE_FIELDS`/`MACHINE_OWNED_FIELDS` 限制；`phase` 禁止直接 set，除非 `COMET_FORCE_PHASE=1`）。
- `transition <change-name> <event>` — 状态机转换（按转换表校验前置条件后写 YAML + 追加审计事件）。
- `check <change-name> <phase> [--recover]` — 进入检查 / 恢复上下文。
- `scale <change-name>` — 评估规模设定 `verify_mode`。
- `task-checkoff <file> <task-text>` — 校验 tasks.md 勾选。
- `next <change-name>` — 输出 `NEXT: auto|manual|done` + `SKILL:`。

### 3.2 `comet-guard.mjs <change> <phase> [--apply]`

- 调用 `classicGuardCommand`（`comet-runtime.mjs:10840`）：校验该阶段守卫；加 `--apply` 时校验通过后调用 `applyStateUpdate` 把 `phase` 推进到下一阶段。
- 这是"守卫驱动阶段推进"的核心钩子。

### 3.3 其他

- `comet-hook-guard.mjs`：PreToolUse 钩子，阻止在 open/design/archive 阶段写入文件。
- `comet-handoff.mjs <change> <phase> [mode]`（`comet-runtime.mjs:11184`）：设计交接，生成带 SHA256 追踪的上下文包（`handoff`）。
- `comet-archive.mjs`：一键归档自动化。
- `comet-yaml-validate.mjs`：YAML 模式校验。
- `comet-env.mjs`：脚本发现助手。

退出码：成功 0；校验失败一般非 0 并写 stderr。

## 4. 状态文件 schema

### 4.1 `openspec/changes/<name>/.comet.yaml`

- `REQUIRED_CLASSIC_KEYS` 至少含：`workflow`、`phase`、`design_doc`、`plan`（其余截断，已知枚举字段见下）。
- `FIELD_ENUMS`（`comet-runtime.mjs:12106`）：
  - `workflow`: `PROFILES`
  - `phase`: `PHASES3`
  - `context_compression`: `off | beta`
  - `build_mode`: `subagent-driven-development | executing-plans | direct`
  - `build_pause`: `null | plan-ready`
  - `subagent_dispatch`: `null | confirmed`
  - `tdd_mode`: `tdd | direct`
  - `review_mode`: `off | standard | thorough`
  - `isolation`: `branch | worktree`
  - `verify_mode`: `light | full`
- 机器拥有字段 `MACHINE_OWNED_FIELDS = { run_id, classic_profile, classic_migration }`，不可经 `set` 直接改，由运行时维护。
- `run_id` 字段：状态机与运行实例的关联键（见 §5）。

### 4.2 `.comet/run-state.json`（`RUN_STATE_FILE`，`comet-runtime.mjs:7539`）

由 `runStateToJson` 序列化，字段：

```json
{
  "runId": "...",
  "skill": "...",
  "skillVersion": "...",
  "skillHash": "...",
  "orchestration": "...",
  "currentStep": "...",
  "iteration": 0
}
```

源结构 `startRun`（`comet-runtime.mjs:8132`）：`runId`（`randomUUID`，可注入）、`skill`（pkg 名）、`skillVersion`、`skillHash`、`orchestration.mode`、`currentStep`（entry）、`iteration`。

### 4.3 `.comet/state-events.jsonl`

追加式状态转换审计日志（每次 `transition`/`applyStateUpdate` 追加一条事件，含 `runId`/`stateVersion`/`contextHash`/`artifactsHash`/`createdAt`）。

### 4.4 `.openspec.yaml`

OpenSpec 规格生命周期与变更元数据。

## 5. run_id 恢复机制

- `run_id` 是工作流可恢复的"运行实例身份"。创建 run 时写入 `.comet.yaml` 的 `run_id` 字段，并持久化 `.comet/run-state.json`。
- 校验/恢复：脚本读取 `.comet.yaml` 的 `run_id` + `.comet/run-state.json` 重建运行上下文（`runStateFromDocument`，`comet-runtime.mjs:7425`）；`check --recover` 用于断点续跑。
- `comet-handoff.mjs` 生成带 SHA256 的上下文包，支持跨设备恢复。
- **集成结论**：`resumeRun(runId)` 通过读取 `.comet/run-state.json` + `.comet.yaml` 重建状态；run_id 可作为断点续跑的入口。

## 6. SKILL.md harness（简述）

- `/comet` 主入口自动检测阶段并分发到 `comet-open/design/build/verify/archive`。
- 阶段守卫通过 `comet-phase-guard.md`（规则层注入阶段感知）+ `comet-hook-guard.mjs`（钩子层硬阻止非法写文件）实现。
- 这些 prompt 层机制在 pi-web 服务端集成时**不直接复用**，但 `.mjs` 脚本（CLI）是真正的可执行入口，应被 `WorkflowStateMachinePort` 调用。

## 7. 集成映射（WorkflowStateMachinePort → CLI）

| 端口方法                        | 实际调用                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `openChange(planId)`            | `node comet-state.mjs init <change> classic --json`（cwd=项目根）            |
| `getState(changeId)`            | `node comet-state.mjs get <change> <field> --json`                           |
| `advanceStage(changeId, event)` | `node comet-guard.mjs <change> <phase> --apply --json`（按当前阶段选 phase） |
| `evaluateGuard(changeId)`       | `node comet-guard.mjs <change> <phase> --json`（不带 --apply，仅校验）       |
| `resumeRun(runId)`              | 读 `.comet/run-state.json` + `.comet.yaml` 重建状态                          |

> 注：comet 的薄壳脚本依赖"当前工作目录含 `openspec/`"，适配层 spawn 时须显式设置 `cwd`。所有调用均走白名单脚本路径 + 显式 argv 校验（见 `lib/unified-engine/guards/`）。
