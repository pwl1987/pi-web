# 对抗性评审修复循环记录（REVIEW-LOOP）

- 基线文档：`docs/ADVERSARIAL-REVIEW-2026-07-31.md`（S1–S10 / P1–P12 / A1–A3 / B1–B3 / C1–C3 / L1–L23）
- 项目：`@agegr/pi-web`（Next.js 16 全栈，JSONL/侧车 JSON 文件持久化，无传统 SQL DB）
- 评审日期：2026-07-31
- 分支：`phase1-2-engineering-security`

## 0. 铁律遵循与流程

| 步骤                | 操作                                                          | 结果                                                   |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| 风险评估地图        | 读取基线评审 + 3 路并行子代理核验当前代码态                   | 输出风险地图（见基线文档 + 本节 §3）                   |
| 快照                | `git commit` 评审前快照（仅源码+评审文档，排除 86k 行生成物） | `20281b4`（husky 全绿：lint+type+281 vitest+359 node） |
| 自动修复（第 1 轮） | 仅对"确定性技术缺陷"动手：C1 / A1+B2 / L1 / L2                | 见 §1                                                  |
| 测试验证            | type-check + test:node + vitest                               | 全绿（359 + 281，VITEST_EXIT=0）                       |
| 重评审              | 复读 4 个修复文件确认状态翻转                                 | §2 显示 4 项已从"开放"→"已修复"                        |
| 循环判定            | 阻塞/严重项中已无剩余"确定性可自动修复"项                     | 循环终止（见 §3）                                      |

> 未自动修复的阻塞/严重项均为**安全姿态变更 / 行为变更 / 架构级**决策，依铁律标记「需人工审核」，见 §3。

## 1. 第 1 轮自动修复清单（已落地 + 测试通过）

### 1.1 C1 — optimize 抽凭证后 400→500 契约退化（严重，确定性可修）

- 文件：`lib/pi-model-creds.ts`、`app/api/agents-md/optimize/route.ts`
- 根因：`resolveDefaultModelCredentials` 抛**普通 `Error`**，`optimize` 路由 `catch` 直接 `errorResponse(error)`（默认 500），把"无默认模型/无 API Key"这类 **4xx 客户端错误**吞成 500。
- 修复：新增 `ModelCredentialsError extends Error`（默认 `status=400`）；三处 `throw` 改为 `throw new ModelCredentialsError(...)`；`optimize` 路由 `catch`：
  ```ts
  } catch (error) {
    if (error instanceof ModelCredentialsError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse(error);
  }
  ```
- 兼容性：合法调用方（已配置凭证）行为完全不变；缺失凭证时从 500 恢复为正确的 400。

### 1.2 A1+B2 — enhance 无条件动态选择（回归）+ 死导入（一般，确定性可修）

- 文件：`app/api/agent/enhance/route.ts`
- 根因：第 168 行无条件 `buildEnhanceSystemPromptSelected(prompt, projectContext)`，绕过旧的全量 `buildEnhanceSystemPrompt`，导致**输出非确定性**，破坏与旧版本逐字一致的契约；且 `buildEnhanceSystemPrompt` 已成死导入（B2）。
- 修复：引入特性开关 `ENHANCE_DYNAMIC_SELECT`（默认 OFF），OFF 时回退 `buildEnhanceSystemPrompt(projectContext)`：
  ```ts
  const enableDynamicSelect = process.env.ENHANCE_DYNAMIC_SELECT === "1";
  const systemPrompt = enableDynamicSelect
    ? buildEnhanceSystemPromptSelected(prompt, projectContext)
    : buildEnhanceSystemPrompt(projectContext);
  ```
- 兼容性：默认 OFF = 旧行为逐字一致；启用开关才走动态提交（且保留 20% 安全底线/回退全量）。B2 死导入随默认分支被使用而消解。

### 1.3 L1 — 引擎 Run 已终态可被 start/resume 重跑（严重，确定性可修）

- 文件：`app/api/engine/runs/route.ts`
- 根因：`/api/engine/runs` 的 `start`/`resume` 对 `completed`/`failed` 终态 run 直接重跑，已完成需求被二次执行、重复写盘/提交（资损）。
- 修复：在路由边界对 `start` 与 `resume` 增加终态守卫：
  ```ts
  const current = await adapter.getRunState(runId);
  if (current.status === "completed" || current.status === "failed") {
    return NextResponse.json({ error: "运行已处于终态，不可恢复" }, { status: 409 });
  }
  ```
- 兼容性：仅拒绝非法重入；正常 idle/open/paused→running 流程不受影响。引擎生命周期测试未覆盖终态 resume，不受影响（已验证 281 测试全绿）。

### 1.4 L2 — 插件总闸关闭后单包仍可启用/安装（严重，确定性可修）

- 文件：`app/api/plugins/route.ts`
- 根因：`/api/plugins` 的 `enable`/`install`/`update` 不读总开关状态，总闸关闭后单包启用会使其与"全局停用"意图漂移。
- 修复：导入 `readPluginMasterState`，在 action 校验后增加守卫（禁用/移除/降级仍允许）：
  ```ts
  if (!readPluginMasterState().enabled) {
    if (body.action === "enable" || body.action === "install" || body.action === "update") {
      return NextResponse.json(
        { error: "插件总开关已关闭，请先在插件面板开启总开关" },
        { status: 409 },
      );
    }
  }
  ```
- 兼容性：总闸开启时行为不变；总闸自身的 PUT 切换走独立端点，不冲突。

### 1.5 B3 — optimize 路由 import 置于执行语句之后（建议，顺带修）

- 文件：`app/api/agents-md/optimize/route.ts`
- 修复：将 `import { resolveDefaultModelCredentials } from "@/lib/pi-model-creds"` 上移并与其它 import 归并（C1 修改时一并处理，干净化）。

## 2. 重评审结论（第 1 轮后）

| 编号 | 修复前                | 修复后                    |
| ---- | --------------------- | ------------------------- |
| C1   | 开放（500 退化）      | ✅ 已修复（恢复 400）     |
| A1   | 开放（回归·非确定性） | ✅ 已修复（开关默认 OFF） |
| B2   | 开放（死导入）        | ✅ 已修复（随 A1 消解）   |
| L1   | 开放（终态可重跑）    | ✅ 已修复（409 守卫）     |
| L2   | 开放（总闸可被绕）    | ✅ 已修复（409 守卫）     |
| B3   | 开放（import 顺序）   | ✅ 已修复                 |

## 3. 无法自动修复 · 需人工干预清单（阻塞/严重）

> 均为安全姿态变更 / 行为变更 / 架构级决策，超出"确定性技术缺陷"范围，须人工评审后落地。每项附最小修复建议。

### 阻塞（架构级）

- **S1 全局无身份认证 + 无会话归属校验**（严重/阻塞）：无 `app/middleware.ts`；`files/[...path]`、`sessions/[id]` 等可直接读写任意会话、触发命令执行。
  建议：引入本地 token 体系（启动生成、存 `~/.pi/agent/`），`middleware.ts` 校验 `Authorization: Bearer`；敏感端点叠加 owner/cwd 归属校验（与 L10 合并）。

### 严重 · 安全姿态变更（需决策默认值/白名单）

- **S2 CSRF 在 dev/非 production 默认失效**（`lib/csrf.ts:42` `if (NODE_ENV!=="production") return null`）：建议默认开启，提供 `PI_WEB_DISABLE_CSRF=1` 显式退出；影响 dev 手动 curl，需团队确认。
- **S3 mcp-config/test 用户可控 `command` 任意执行**（`app/api/mcp-config/test/route.ts`）：建议 `command` 限 **PATH 基名白名单**（如 `node`/`npx`/`python*`/`go`/`cargo`/`git`），拒绝绝对路径与 shell 元字符；白名单内容需人工拍板。
- **S4 skills/install + mcp-config/env/setup 任意包安装**（`app/api/skills/install/route.ts`、`lib/npx.ts`、`lib/mcp-env.ts`）：建议 `package` 限可信 registry 前缀 + `npm install --ignore-scripts` + 锁网络 egress；registry 白名单需人工拍板。
- **S5 extensions/install 符号链接加载不可信 ES module**（`app/api/extensions/install/route.ts`、`lib/extensions/discovery.ts`）：建议（a）资源路由加 `Content-Security-Policy: script-src 'self'` + `X-Content-Type-Options: nosniff`；（b）install 时 `realpath` 解析并校验落在受信根（extensions 目录）内，禁止符号链接跳出；（c）受信根清单需人工拍板。

### 严重 · 行为变更（需决策 UX/阈值）

- **P5 rpc-manager idle 计时器因 `promptRunning` 永不回收**（严重）：建议加**绝对硬上限**（如 12h）兜底销毁；阈值需人工拍板（避免误杀长任务）。
- **P6 startRpcSession 无全局并发上限**（严重）：建议加**并发信号量**（如 8）+ 超额返回 429；容量阈值需人工拍板。
- **L7 SSE 断开/关页后服务端 Agent 仍跑烧 token**（`app/api/agent/[id]/events/route.ts`）：建议 `cleanup` 调 `abort`；关页即停 agent 属 UX 变更，需人工拍板。
- **L8 重复点击发送不幂等**（`hooks/useSessionActions.ts` + `lib/rpc-manager.ts`）：建议前端发送加同步 `ref` 锁 + 服务端 prompt 分支加幂等键（如 `clientNonce`）；行为变更需确认。
- **L9 fork 在 running 中直接 `destroy`**（`lib/rpc-manager.ts`）：建议 `fork` 前 `await inner.abort()` 或返回 `cancelled`；行为变更需确认。

### 严重 · 棕地历史兼容（需兼容旧数据）

- **L3 会话 DELETE 级联 re-parent 用绝对路径做外键**（`app/api/sessions/[id]/route.ts`、`lib/session-reparent.ts`）：建议外键改用**会话 ID + cwd 相对键**；迁移旧数据需兼容脚本，须人工评审。
- **L10 会话 DELETE 无归属校验**（依赖 S1）：与 S1 合并，引入 owner/cwd 校验后再删。

### 严重 · 性能架构（读多写少放大）

- **P1 session-reader 全量枚举无分页**（`lib/session-reader.ts`）：建议引入分页/游标 + 增量缓存；架构改动，需人工评审。
- **P2 markdown 重渲染无 memo/缓存**（`components/MarkdownBody.tsx`）：建议 `React.memo` + 渲染结果缓存；影响首屏，需评估。
- **P4 对账每 15s 全量拉取无去重**（hooks/useAgentSession.ts）：建议改为 `If-None-Match`/增量事件；架构改动，需人工评审。

## 4. 更新后的 Top 10 风险（按业务影响排序）

| #   | 风险                             | 维度          | 严重度 | 业务影响                                                  | 修复成本                               | 状态       |
| --- | -------------------------------- | ------------- | ------ | --------------------------------------------------------- | -------------------------------------- | ---------- |
| 1   | S1 无全局认证 + 无归属校验       | 安全/越权     | 阻塞   | 同机/局域网任意进程可读写所有会话、触发命令执行、窃取密钥 | 高（需 token 体系+middleware）         | 需人工审核 |
| 2   | S3 mcp-config/test 任意命令执行  | 安全/RCE      | 严重   | 经可信端点直接 RCE，接管本机                              | 中（白名单）                           | 需人工审核 |
| 3   | S4 任意包安装（投毒/供应链）     | 安全/供应链   | 严重   | 安装恶意包 → 代码执行/凭证外泄                            | 中（registry 白名单+--ignore-scripts） | 需人工审核 |
| 4   | S5 扩展符号链接加载不可信模块    | 安全/沙箱逃逸 | 严重   | 加载攻击者可控 ES module → RCE                            | 中（受信根+禁 symlink 跳出+CSP）       | 需人工审核 |
| 5   | L7 SSE 断开不 abort              | 容错/资损     | 严重   | 关页/断网后 agent 仍跑，烧 token 甚至误提交               | 低（abort）                            | 需人工审核 |
| 6   | L9 fork 在 running 直接 destroy  | 逻辑/数据一致 | 严重   | 丢失进行中 run、文件状态不一致                            | 低（先 abort）                         | 需人工审核 |
| 7   | P6 startRpcSession 无并发上限    | 性能/单点     | 严重   | 并发×10 → 进程 OOM 崩溃（全局单点）                       | 低（信号量+429）                       | 需人工审核 |
| 8   | P1 session-reader 全量枚举无分页 | 性能/OOM      | 严重   | 会话数×10 → 列举接口超时/OOM                              | 中（分页）                             | 需人工审核 |
| 9   | L3 re-parent 用绝对路径外键      | 棕地/兼容     | 严重   | 目录重命名/迁移 → 会话树断裂、孤儿会话                    | 中（键重构+迁移）                      | 需人工审核 |
| 10  | L8 重复发送不幂等                | 逻辑/配额     | 严重   | 重复提交消耗配额、产生重复变更                            | 低（ref 锁+幂等键）                    | 需人工审核 |

## 5. 本轮已消除风险（对照基线）

C1、A1、B2、L1、L2、B3 共 6 项（含 4 项严重）已通过确定性修复消除，全部经 type-check + 359 node 测试 + 281 vitest 验证，无回归。

## 6. 操作记录（commit/diff）

- 快照：`20281b4` snapshot: 对抗性评审前快照（pre-review）
- 修复提交：见 `git show` 本仓库最新提交（C1/A1/L1/L2/B3 五文件）
- 回滚路径：若修复引入问题，`git revert <修复提交>` 或 `git reset --hard 20281b4` 回到快照。
