# 设计文档：S1 访问网关

## 1. 令牌生命周期

```
启动 (bin/pi-web.js 生产 / instrumentation.ts 开发)
  │
  ├─ ensureAccessToken()
  │     ├─ 读 <agentDir>/pi-web-auth.json (0600)
  │     │     ├─ 存在 → 复用其中 sha256 哈希（重启令牌不变）
  │     │     └─ 不存在 → crypto.randomBytes(32).hex 生成明文 T
  │     │               → 写 { hash: sha256(T) } 权限 0o600
  │     └─ 返回 { plain: T, hash: sha256(T) }
  │
  ├─ 明文 T → 仅打印终端 + 注入自动打开 URL (?token=T)
  └─ 哈希   → 经 env PI_WEB_ACCESS_TOKEN_HASH 传入 next 子进程 / 运行时
```

**关键约束**：Edge middleware **不能读本地文件**，故哈希必须经 `env` 注入（spawn 时透传 / dev 由
instrumentation 读文件后写 `process.env`）。明文**绝不**写盘、绝不经任何响应回传。

## 2. 新增 `lib/access-token.ts`（Node runtime，纯 fs，可单测）

- `ensureAccessToken(agentDir?)`：`0600` 持久化 sha256 哈希、重启复用、原子写（tmp+rename）。
- `loadTokenHash(agentDir?)`：读文件返回哈希或 `null`。
- 沿用现有 sidecar 落点约定 `join(agentDir, "pi-web-auth.json")`，agentDir 取
  `process.env.PI_WEB_ACCESS_TOKEN_DIR || process.env.PI_CODING_AGENT_DIR || ~/.pi/agent`。
- 刻意 `@/-free`（内联 getAgentDir），便于 node:test 直接 import（与 `lib/prompt-modules-state.ts` 一致）。

## 3. 新增 `app/middleware.ts`（Edge runtime）

```ts
export const config = { matcher: ["/api/:path*", "/api/health"] };

export async function middleware(req: NextRequest) {
  // 降级开关：救命绳，默认关闭
  if (process.env.PI_WEB_DISABLE_AUTH === "1") return NextResponse.next();

  // D3：无状态健康端点开放（不含任何数据）
  if (req.nextUrl.pathname === "/api/health") {
    return new NextResponse(JSON.stringify({ ok: true }), { status: 200 });
  }

  const expected = process.env.PI_WEB_ACCESS_TOKEN_HASH;
  if (!expected) {
    // D2：未配置令牌 → 强制拒绝（dev 也适用），不再「dev 自动开放」
    return deny(req, "no-token-configured");
  }

  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.cookies.get("__Host-pi-access")?.value ||
    req.nextUrl.searchParams.get("token");

  if (!provided) return deny(req, "missing-token");

  const h = await sha256Hex(provided); // Web Crypto (Edge 可用)
  if (!timingSafeEqualHex(h, expected)) return deny(req, "bad-token");

  return NextResponse.next();
}

function deny(_req: NextRequest, reason: string) {
  return new NextResponse(JSON.stringify({ error: "unauthorized", reason }), {
    status: 401,
    headers: { "WWW-Authenticate": "Bearer" },
  });
}
```

> `timingSafeEqualHex`：比较两等长 hex 字符串，长度不等直接 false，避免 `timingSafeEqual` 抛错；
> 用 `crypto.subtle.timingSafeEqual`（Edge 支持）或 `crypto` 模块降级。

## 4. 客户端接入（单一出口，无需逐路由改）

- `lib/csrf-client.ts#csrfHeaders`：合并 `Authorization: Bearer <localStorage 令牌>`；无令牌则省略
  （服务端按「未配置则拒绝 / 降级则放行」判定）。
- 新增 `lib/access-token-client.ts`：`getAccessToken()` 从 `localStorage` 读、`setAccessToken()` 写。
- `components/AppShell.tsx` 首屏 effect：读 `useSearchParams().get("token")`，`setAccessToken` 后
  `history.replaceState` 抹除 URL 中的 `?token=`（防泄露到 Referer/历史）。
- `lib/csrf-fetch.ts` 的 `csrfFetchJson` 已统一走 `csrfHeaders`，GET 与 mutation 一并携带。

## 5. 启动注入（D1 交付路径）

- **生产 `bin/pi-web.js#startServer()`**：spawn next 前调 `ensureAccessToken()`；把 `hash` 加入
  `env`（`PI_WEB_ACCESS_TOKEN_HASH`）；自动打开 URL 改为 `http://<host>:<port>/?token=<plain>`；
  非回环警告文案补充「已启用访问令牌，请将终端中的令牌用于浏览器访问」。
- **开发 `next dev`**：无 bin 包裹。新增 `app/instrumentation.ts`（Node runtime，`register()`
  钩子）调用 `ensureAccessToken()` 并把哈希写入 `process.env.PI_WEB_ACCESS_TOKEN_HASH`，供 middleware
  的 Edge 运行时经 env 读取。注意：Next instrumentation 在 Node 侧运行，env 写入对同进程 Edge 可用。

## 6. L10 归属校验（并入敏感路由入口）

新增 `lib/session-ownership.ts`（Node runtime）：

- `assertSessionOwned(sessionId, agentDir)`：解析会话路径，确认落在 `<agentDir>/sessions` 内。
- `assertFileWithinScope(absPath, allowedRoots)`：确认路径落在 `allowedRoots`（cwd + 受信会话输出
  目录）内；与第 2 轮 `sessionReference` 受信根收敛互补（旁路也需再过此关）。

在 `app/api/sessions/[id]/route.ts`、`app/api/sessions/[id]/{context,export}/route.ts`、
`app/api/files/[...path]/route.ts` 入口调用；越界返回 403（会话）或 404（文件不存在于受信根）。

## 7. 回滚与降级

- 即时降级：`PI_WEB_DISABLE_AUTH=1` 重启即整站开放。
- 提交级回滚：`git revert` 本 change 提交。
- 快照：`startServer`/`instrumentation` 改动前先 `git commit` 快照。

## 8. 风险

- middleware matcher 写错会导致**整站 401 打不开** → 必须有 `/api/health` 开放 + `PI_WEB_DISABLE_AUTH`
  降级 + 充分单测（有效/无效/缺令牌/禁用开关）。
- dev 强制令牌会改变开发者每日体验 → 已在 D2 显式取保守侧，并在 README 注明本地令牌获取方式。
- `instrumentation.ts` 与 Edge env 传递属 Next 特定机制，需实测确认 dev 下 hash 可达 Edge。
