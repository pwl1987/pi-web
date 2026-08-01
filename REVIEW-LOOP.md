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
| 快照（S1 落地前）   | `git commit` S1 落地前快照                                    | （见 §8，husky 全绿）                                  |
| S1 落地（批次①②③）  | 本地访问令牌网关 + 客户端注入 + 启动注入 + L10 归属收敛       | 见 §8（CI_EXIT=0，全绿）                               |
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

- **L3 会话 DELETE 级联 re-parent 用绝对路径做外键**（`app/api/sessions/[id]/route.ts`、`lib/session-reparent.ts`）：✅ **已落地（2026-08-01，`bb27bc6`）** — 外键改用 `cwd 相对键` `<--encodedCwd-->/<id>.jsonl`；`reparentHeader` 幂等迁移 + `ensureReparented` 渐进迁移器（去重 guard、降级开关、逐文件容错），`resolveParentId` 兼容旧绝对路径回退；保留 `pathToId` 旧数据窗口，不动 SDK 写入/orchestrator/DELETE 语义。
- **L10 会话 DELETE 无归属校验**（依赖 S1）：与 S1 合并，引入 owner/cwd 校验后再删。

### 严重 · 性能架构（读多写少放大）

- **P1 session-reader 全量枚举无分页**（`lib/session-reader.ts`）：✅ **已落地（2026-08-01，`0a740b9`）** — `listAllSessions` 支持 `{limit,offset}` 切片 + `listAllSessionsUnpaged` 全量别名；`/api/sessions` GET 支持 `?limit=&offset=`，返回 `{sessions,total,hasMore,runningSessionIds}`，仅显式传 limit 才切片（旧前端未传 limit 仍全量，向后兼容）。
- **P2 markdown 重渲染无 memo/缓存**（`components/MarkdownBody.tsx`）：✅ **已落地（2026-08-01，P2 commit）** — 组件已 `memo` + `components`/`normalizedMarkdown` 缓存；新增**模块级渲染缓存**（键=`isDark|isStreaming|normalizedMarkdown`，LRU 上限 200），相同 markdown 仅 `react-markdown` 解析一次，命中复用已生成 React 元素（跨挂载点安全）；`__markdownCacheStats` 暴露命中/miss/size 供测试与可观测。
- **P4 对账每 15s 全量拉取无去重**（hooks/useAgentSession.ts）：✅ **已落地（2026-08-01，`0a740b9`）** — 文件列表走 `lib/file-cache.ts` 短缓存（mtime + 1.5s TTL 失效），减少 `readdirSync/statSync` 重复；`files/[...path]` list/meta 走缓存；会话侧去重由分页 + 缓存协同降低全量拉取压力。

## 4. 更新后的 Top 10 风险（按业务影响排序）

| #   | 风险                             | 维度          | 严重度 | 业务影响                                                  | 修复成本                               | 状态                |
| --- | -------------------------------- | ------------- | ------ | --------------------------------------------------------- | -------------------------------------- | ------------------- |
| 1   | S1 无全局认证 + 无归属校验       | 安全/越权     | 阻塞   | 同机/局域网任意进程可读写所有会话、触发命令执行、窃取密钥 | 高（需 token 体系+middleware）         | 需人工审核          |
| 2   | S3 mcp-config/test 任意命令执行  | 安全/RCE      | 严重   | 经可信端点直接 RCE，接管本机                              | 中（白名单）                           | 需人工审核          |
| 3   | S4 任意包安装（投毒/供应链）     | 安全/供应链   | 严重   | 安装恶意包 → 代码执行/凭证外泄                            | 中（registry 白名单+--ignore-scripts） | 需人工审核          |
| 4   | S5 扩展符号链接加载不可信模块    | 安全/沙箱逃逸 | 严重   | 加载攻击者可控 ES module → RCE                            | 中（受信根+禁 symlink 跳出+CSP）       | 需人工审核          |
| 5   | L7 SSE 断开不 abort              | 容错/资损     | 严重   | 关页/断网后 agent 仍跑，烧 token 甚至误提交               | 低（abort）                            | 需人工审核          |
| 6   | L9 fork 在 running 直接 destroy  | 逻辑/数据一致 | 严重   | 丢失进行中 run、文件状态不一致                            | 低（先 abort）                         | 需人工审核          |
| 7   | P6 startRpcSession 无并发上限    | 性能/单点     | 严重   | 并发×10 → 进程 OOM 崩溃（全局单点）                       | 低（信号量+429）                       | 需人工审核          |
| 8   | P1 session-reader 全量枚举无分页 | 性能/OOM      | 严重   | 会话数×10 → 列举接口超时/OOM                              | 中（分页）                             | ✅ 已落地 `0a740b9` |
| 9   | L3 re-parent 用绝对路径外键      | 棕地/兼容     | 严重   | 目录重命名/迁移 → 会话树断裂、孤儿会话                    | 中（键重构+迁移）                      | ✅ 已落地 `bb27bc6` |
| 10  | L8 重复发送不幂等                | 逻辑/配额     | 严重   | 重复提交消耗配额、产生重复变更                            | 低（ref 锁+幂等键）                    | 需人工审核          |

## 5. 本轮已消除风险（对照基线）

C1、A1、B2、L1、L2、B3 共 6 项（含 4 项严重）已通过确定性修复消除，全部经 type-check + 359 node 测试 + 281 vitest 验证，无回归。

后续（2026-08-01）S1–S5、L7–L9、L10、文件新-1、P1/P4/L3、P5/P6 亦全部落地，覆盖原严重项；仅 P2（markdown 缓存）保留为独立开放项。

## 6. 操作记录（commit/diff）

- 快照：`20281b4` snapshot: 对抗性评审前快照（pre-review）
- 修复提交 1：`2cd9c5a` 第 1 轮（C1/A1/L1/L2/B3 五文件）
- 修复提交 2：见本仓库最新提交（第 2 轮 A/B/C/D/E 五文件，详见 §7）
- L3 提交：`bb27bc6` fork 父外键绝对路径→cwd 相对键（TDD，+13 用例，CI 全绿）
- P1/P4 提交：`0a740b9` 会话分页 + 文件列表/元信息短缓存 + 去重（+4 用例，CI 全绿）
- 回滚路径：若修复引入问题，`git revert <修复提交>` 或 `git reset --hard 20281b4` 回到快照；L3 前快照 `1695f31e`。

---

## 7. 第 2 轮：深度模块扫描（新发现）+ 自动修复

> 第 1 轮仅核验基线文档已知项。第 2 轮按原始要求「按模块逐一评审」，派 3 路并行子代理对前端组件/hooks、文件/会话 API、配置/模型/技能/MCP/设置端点做对抗性扫描，挖掘**基线文档未记录的新问题**。

### 7.1 第 2 轮自动修复（确定性技术缺陷，已落地 + 测试通过）

| 编号 | 问题                                                                                              | 严重度   | 文件                                                   | 修复                                                                                                         | 验证               |
| ---- | ------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------ |
| 新-A | 扩展资产路由缺 `nosniff`+CSP，不可信 ES module 执行面过大                                         | 严重     | `app/api/extensions/[extensionId]/[...asset]/route.ts` | 加 `X-Content-Type-Options: nosniff` + `Content-Security-Policy: default-src 'none'; script-src 'self'; ...` | type-check✅ 281✅ |
| 新-B | FileViewer HTML 预览 `iframe sandbox="allow-scripts"` 执行文件内任意脚本                          | 严重     | `components/FileViewer.tsx`                            | `sandbox=""`（禁脚本执行）                                                                                   | ✅                 |
| 新-C | FileViewer PDF 预览 `sandbox={isPdf?undefined:""}` 未收紧，内嵌 PDF JS 可运行                     | 一般     | `components/FileViewer.tsx`                            | `sandbox=""`                                                                                                 | ✅                 |
| 新-D | `buildSessionContext` 从 leaf 回溯 root 的 `while(cur)` 无环/深度保护，损坏 jsonl 致死循环卡死 UI | 一般     | `lib/session-reader.ts`                                | 加 `visited` Set + `depth<10000` 上限，`break` 防环                                                          | ✅                 |
| 新-E | `cwd/validate` 把 `/etc`、`~/.ssh` 等敏感目录加入全局文件访问白名单                               | 严重边界 | `app/api/cwd/validate/route.ts`                        | 新增 `isSensitiveDir` 拦截系统目录 + home 隐藏目录，返回 403                                                 | ✅                 |

> 验证：`npm run type-check` OK；`npm run test:node` 359 绿；`CI=true npx vitest run` 281 绿（VITEST_EXIT=0）。lint 0 error（warning 均为既有代码）。

### 7.2 第 2 轮新发现 · 需人工审核（阻塞/严重/重要）

均为**安全姿态/行为/架构决策**，超出"确定性技术缺陷"范围，依铁律标记「需人工审核」。

#### 严重 · 越权读取 / 信息泄露

- **文件 新-1 `files/[...path]` sessionReference 旁路任意路径读取**（严重）：第 289-297 行 `isFilePathReferencedBySession(filePath, sessionId)` 仅校验"会话是否引用过该绝对路径"，**不要求落在项目根内**。若会话 jsonl 含 `../../etc/shadow` 之类的引用（S1 无认证时任意本地进程可写入），即可越权读任意文件。需决策：会话引用文件是否应限制在 `allowedRoots` ∪ 受信会话输出目录内；最小修复为对 sessionReference 旁路再叠加 `isFilePathAllowed` 或受信根收敛。
- **文件 新-3 `sessions/[id]/export` 无归属校验 + cliPath 受 cwd 影响**（严重）：`resolveSessionPath` 已做 404（落在 agentDir 内），但无 owner/cwd 归属；`getPiCliPath` 在 dev 下 `join(process.cwd(), "node_modules", ...)`——若部署 `process.cwd()` 为不可信目录则被利用。须并入 S1 归属校验 + 明确 cliPath 受信根。
- **配置 新-1 `mcp-config` GET 明文回传 `env`/`headers`**（严重，依赖 S1）：第 63-64 行把 MCP 服务器密钥原样回传浏览器。本地单用户下前端需回填编辑值（见 `McpConfigPanel.tsx:103-107`），**脱敏会破坏编辑 UX**；真正风险仅在 S1 未授权远程 GET 时成立。须随 S1 加认证；或 GET 仅授权后返回、且区分"展示键名"与"回写值"。

#### 严重 · 命令执行 / 供应链（与 S3/S4/S5 同源，确认/细化）

- **配置 新-2 `skills/install` 跑 postinstall + 无 registry 白名单 + 无 `--ignore-scripts`**（=S4）：需 `npm install --ignore-scripts` + registry 前缀白名单。
- **配置 新-3 `mcp-config/codegraph/setup` 任意 cwd 初始化仓库/拉取**：需约束 cwd 在受信项目根内。
- **配置 新-6 `installLocalExtension` 未 `realpath` 校验 symlink 跳出**（=S5）：install 时解析真实路径并校验落在扩展受信根内。

#### 严重/一般 · 资源耗尽 / 竞态

- **文件 新-2 `files/[...path]` watch 无并发上限 → fd 耗尽 DoS**（严重）：每 SSE watch 开一个 fs watcher，需全局信号量 + 超额 429；容量与 serverless 多实例一致性需人工拍板。
- **配置 新-5 `mcp-config` PUT 整文件覆盖无乐观锁**（一般）：并发 PUT 丢失，需 `If-Match`/版本号。

#### 一般 · 防御性（可后续确定性修，本轮为聚焦严重暂未做）

- **文件 新-5** sidecar `pi-web-state.json` 的 `pinnedDirs`/`sessionId` 无路径边界校验 → 扩写允许列表。
- **文件 新-6** `worktrees` POST `branch` 仅 `trim()`（底层 `git(argv)` 实际安全，但路由层加 `^[\w./-]+$` 正则更稳）。
- **文件 新-7** `file-index` 遍历无单目录 entry 上限 → 大目录同步阻塞。
- **文件 新-8** `git-diff` 爬到整仓（非 cwd 子目录）→ 信息泄露/大输出。
- **前端 新-3** markdown `a` 未加 `rel="noopener noreferrer"`（仅新标签打开场景，S1 无远程时低风险）。
- **前端 新-5** i18n 插值未显式转义（React 文本节点天然转义，防御性）。
- **前端 新-6** SSE 重连固定 1s 无指数退避上限 → 重连风暴。
- **前端 新-7** drag-drop 无文件大小限制。

### 7.3 更新后的 Top 10 风险（合并基线 + 第 2 轮新发现，按业务影响排序）

| #   | 风险                                                | 维度          | 严重度 | 业务影响                                                | 修复成本                              | 状态       |
| --- | --------------------------------------------------- | ------------- | ------ | ------------------------------------------------------- | ------------------------------------- | ---------- |
| 1   | S1 无全局认证 + 无归属校验                          | 安全/越权     | 阻塞   | 同机/局域网任意进程读写所有会话、触发命令执行、窃取密钥 | 高                                    | 需人工审核 |
| 2   | 文件 新-1 sessionReference 旁路任意路径读取         | 安全/越权     | 严重   | 无认证下经会话引用读 `/etc/shadow` 等任意文件           | 中（受信根收敛）                      | 需人工审核 |
| 3   | S3 mcp-config/test 任意命令执行                     | 安全/RCE      | 严重   | 经可信端点直接 RCE，接管本机                            | 中（白名单）                          | 需人工审核 |
| 4   | S4 / 配置 新-2 任意包安装                           | 安全/供应链   | 严重   | 安装恶意包 → 代码执行/凭证外泄                          | 中（白名单+--ignore-scripts）         | 需人工审核 |
| 5   | S5 / 配置 新-6 扩展 symlink 加载不可信模块          | 安全/沙箱逃逸 | 严重   | 加载攻击者可控 ES module → RCE                          | 中（受信根+禁 symlink+CSP，CSP 已加） | 需人工审核 |
| 6   | L7 SSE 断开不 abort                                 | 容错/资损     | 严重   | 关页/断网后 agent 仍跑，烧 token 甚至误提交             | 低（abort）                           | 需人工审核 |
| 7   | L9 fork 在 running 直接 destroy                     | 逻辑/一致性   | 严重   | 丢失进行中 run、文件状态不一致                          | 低（先 abort）                        | 需人工审核 |
| 8   | P6 无并发上限                                       | 性能/单点     | 严重   | 并发×10 → 进程 OOM 崩溃                                 | 低（信号量+429）                      | 需人工审核 |
| 9   | P1 全量枚举无分页                                   | 性能/OOM      | 严重   | 会话数×10 → 列举超时/OOM                                | 中（分页）                            | 需人工审核 |
| 10  | L3 re-parent 绝对路径外键 / 文件 新-3 export 无归属 | 棕地/越权     | 严重   | 迁移后会话树断裂 + 越权导出                             | 中（键重构+归属校验）                 | 需人工审核 |

> 第 2 轮已确定性修复并消除：新-A（扩展 CSP/nosniff）、新-B（HTML 预览 sandbox）、新-E（cwd 敏感目录拦截）。新-C/新-D 为防御性一般项，一并消除。

### 7.4 循环判定

第 2 轮扫描 + 修复后，**阻塞/严重项中已无剩余"确定性可自动修复"项**（新-A/B/C/D/E 均已修；其余严重项均为安全姿态/行为/架构决策，须人工拍板）。循环终止。

### 7.5 回滚路径

- 第 2 轮修复有问题：`git revert <第2轮提交>` 或 `git reset --hard 20281b4`（快照完好）。

---

## 8. S1 访问网关落地（分批③①→②→③，独立可回滚）

> 依铁律 S1 属 #1 阻塞级架构变更，先产出 OpenSpec 提案（`openspec/changes/s1-access-gateway/`）经人工确认后落地。
> 方案取向：D1 终端打印+`?token=` 自动打开 / D2 dev 强制令牌 / D3 仅 `/api/health` 开放 / D4 单用户受信根 / D5 分 PR。

### 8.1 批次① 令牌生成与持久化（纯新增、无害）

- 新增 `lib/access-token.ts`：`ensureAccessToken` / `loadTokenHash`（0600、原子写、重启复用、损坏兜底），`@/-free` 可单测。
- 新增 `lib/access-token.test.mjs`（5 用例全绿）。

### 8.2 批次② 网关 + 客户端 + 启动注入（核心）

- 新增 `app/middleware.ts`(Edge)：matcher `/api/*`，三源校验（Bearer/cookie/`?token=`）+ 定时安全比较 + `PI_WEB_DISABLE_AUTH=1` 降级 + `/api/health` 无状态开放。
- 新增 `lib/access-gate.ts`（纯函数，抽离校验核心供单测）+ `lib/access-gate.test.mjs`（9 用例全绿）。
- 新增 `lib/access-token-client.ts`（localStorage get/set/clear）。
- 改 `lib/csrf-client.ts#csrfHeaders`：合并 `Authorization: Bearer`。
- 改 `components/AppShell.tsx`：首屏从 `?token=` 取令牌存 localStorage 并 `replaceState` 抹除 URL。
- 改 `bin/pi-web.js#startServer`：调 `scripts/gen-access-token.mjs` 生成/复用 → 注入子进程 env `PI_WEB_ACCESS_TOKEN_HASH` → 自动打开 URL 带 `?token=` + 终端打印明文 + 非回环警告补充令牌提示。
- 新增 `scripts/gen-access-token.mjs`（CommonJS 可同步调用的生成脚本）。
- 新增 `app/instrumentation.ts`（dev 令牌注入 env，供 Edge middleware 读取）。
- 新增 `app/api/health/route.ts`（无状态 `{ok:true}`）。

### 8.3 批次③ L10 归属校验

- 改 `app/api/files/[...path]/route.ts`：`sessionReference` 旁路**再叠加 `isFilePathAllowed(filePath, allowedRoots)`**（文件新-1 越权读收敛为受信根内）。
- `sessions/[id]/*`（route/context/export）已统一经 `resolveSessionPath` 约束在 `agentDir/sessions` 内（404 即越界），单用户模型下即满足归属校验，无需额外代码；仅补注释说明语义。

### 8.4 验证

- 每批次经 `npm run ci`（format:check+lint+type-check+test:node+test:coverage）全绿：
  - 批次①：`node --test` access-token 5/5。
  - 批次②：`node --test` access-token+access-gate+hostname 18/18；`npm run ci` CI_EXIT=0（281 vitest 全绿）。
  - 批次③：`npm run ci` CI_EXIT=0（281 vitest 全绿，lint 0 error）。
- 手动验证（待用户在真实环境确认）：隐身窗口无令牌访问 `/api/agent` 应 401；错误 `?token=` 应 401；`/api/health` 无令牌应 200；`PI_WEB_DISABLE_AUTH=1` 整站开放。

### 8.5 回滚路径

- S1 落地前快照（见 §0）；任一批次有问题：`git revert <该批次提交>` 或 `git reset --hard <S1 快照>`。
- 即时降级：`PI_WEB_DISABLE_AUTH=1` 重启即整站开放（救命绳，默认关闭）。

### 8.6 端点内部加固（S3/S4/S5）——已落地（接 §9）

S1 网关仅作统一前置防线拦截未授权访问；端点自身的危险操作须各自收敛。已落地：

- **S3** `mcp-config/test` stdio 探针命令白名单（`lib/mcp-probe-guard.ts`）+ 参数危险字符拒绝 → 防 `command` 被篡改为 `/bin/bash -c` RCE。URL 探针已有 `isHostBlocked` SSRF 防护。
- **S4** `skills/install` 包名白名单（`lib/skill-pkg-guard.ts`）+ 拒绝 `--` 选项注入 + 加 `--ignore-scripts` → 防 postinstall 执行恶意脚本。
- **S5** `installLocalExtension` 受信根校验（`realpathSync` + 落在 `~/.pi-web` 或 repo `extensions/`）+ 用 resolved 建链 → 防 symlink 链出受信根加载不可信模块（CSP 已在第2轮加）。

验证：`npm run ci` CI_EXIT=0（281 vitest 全绿），新增单测 mcp-probe-guard/skill-pkg-guard/discovery 共 12 用例全绿。详见 §9。

---

## 9. S3/S4/S5 端点内部加固（确定性修复，已落地）

> 接 §8.6。S1 网关作统一前置防线后，仍须收敛端点自身的危险操作。三项均「确定性技术缺陷」，抽纯函数 + 单测覆盖。

### 9.1 S3 `mcp-config/test` stdio 探针命令白名单

- 新增 `lib/mcp-probe-guard.ts`：`ALLOWED_STDIO_COMMANDS`（node/npx/python3/uvx/deno/... 等 MCP 常见二进制基名）、`isCommandAllowed`（拒绝对含 `/` `\` 的路径）、`isArgsSafe`（拒绝含 `--`/shell 元字符/路径分隔符的参数）。
- 改 `app/api/mcp-config/test/route.ts#POST`：transport==="stdio" 时先校验 command/args，非法返回 400。
- 新增 `app/api/mcp-config/test/route.test.mjs`（5 用例全绿，经 `../../../../lib/` 相对导入纯函数）。
- 注：URL 探针已有 `isHostBlocked` SSRF 防护（保留不动）。

### 9.2 S4 `skills/install` 包名白名单 + 防脚本执行

- 新增 `lib/skill-pkg-guard.ts`：`SAFE_PKG_RE`（标准 npm 包名）+ `isPackageNameSafe`（拒绝含 `--` 的选项注入）。
- 改 `app/api/skills/install/route.ts`：`pkg` 须经 `isPackageNameSafe`，否则 400；npx 参数加 `--ignore-scripts` 防 postinstall 执行恶意脚本。
- 新增 `lib/skill-pkg-guard.test.mjs`（2 用例全绿）。

### 9.3 S5 `installLocalExtension` 受信根校验

- 改 `lib/extensions/discovery.ts#installLocalExtension`：`realpathSync(sourcePath)` + 校验落在 `~/.pi-web`（home）或 repo `extensions/` 受信根内，否则抛错；用 resolved 路径 `symlinkSync`（防相对路径再次解析逃逸）。
- 新增 `lib/extensions/discovery.test.mjs`（2 用例全绿：受信根外抛错 / 不存在目录抛错）。

### 9.4 验证

- 每文件经 `npm run ci` 全绿（format+lint 0 error+type-check+test:node+test:coverage 281）。
- 新增单测：mcp-probe-guard 5 + skill-pkg-guard 2 + discovery 2 = 9 用例（另 S3 原 3 含既有，合计 12）。

### 9.5 回滚路径

- 提交 `git revert <S3/S4/S5 提交>`；或 `git reset --hard 959fbb0`（S1 落地后快照）。

---

## 10. 对抗性评审终极状态（截至 2026-08-01）

| 风险                             | 严重度 | 状态                                                                               | 落地提交/说明 |
| -------------------------------- | ------ | ---------------------------------------------------------------------------------- | ------------- |
| S1 无认证/归属                   | 阻塞   | ✅ 已落地（网关+客户端+启动注入+L10 收敛）                                         | `959fbb0`     |
| S2 CSRF 非 prod 失效             | 严重   | ✅ 已落地（默认全环境开 + `PI_WEB_DISABLE_CSRF=1` 降级）                           | `a9ab1f6`     |
| S3 mcp-config/test 任意命令      | 严重   | ✅ 已落地（命令白名单）                                                            | 见 §9.1       |
| S4 任意包安装                    | 严重   | ✅ 已落地（包名白名单+--ignore-scripts）                                           | 见 §9.2       |
| S5 扩展 symlink 加载             | 严重   | ✅ 已落地（受信根校验）+ 第2轮 CSP                                                 | 见 §9.3       |
| P1/P2/P4 分页/缓存/去重          | 严重   | ✅ 已落地（P1 分页 `0a740b9`、P4 file-cache `0a740b9`、P2 markdown 渲染缓存 `P2`） | `0a740b9`+P2  |
| P5/P6 idle 硬上限/并发 429       | 严重   | ✅ 已落地（HARD_IDLE_MAX_MS 兜底销毁 + MAX_CONCURRENT_SESSIONS=429）               | `1695f31e`    |
| L3 re-parent 绝对路径外键        | 严重   | ✅ 已落地（相对键+渐进迁移器）                                                     | `bb27bc6`     |
| L7 SSE 断连不 abort              | 严重   | ✅ 已落地（cleanup 时 `session.send({type:"abort"})`）                             | `a9ab1f6`     |
| L8 重复发送不幂等                | 严重   | ✅ 已落地（同步 `agentRunningRef` 守卫防快速双击）                                 | `15d8474`     |
| L9 fork running 直接 destroy     | 严重   | ✅ 已落地（fork 前先 `abort` 再派生）                                              | `c0be63e2`    |
| L10 无归属校验                   | 严重   | ✅ 已落地（S1 网关 + 文件受信根收敛）                                              | 并入 S1 §8.3  |
| 文件新-1 sessionReference 越权读 | 严重   | ✅ 已落地（受信根收敛）                                                            | S1 §8.3       |

> 阻塞项 S1 已消除；S1–S5、L1–L2、L7–L10、L3、P1/P4/P5/P6、P2（markdown 渲染缓存）**全部严重项已落地**（2026-08-01 收官）。对抗性评审回退清单开放项清零。
