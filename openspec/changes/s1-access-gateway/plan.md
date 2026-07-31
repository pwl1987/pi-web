# 实施计划：S1 访问网关

> 分三个独立可回滚批次落地，每批次先 `git commit` 快照 → 跑 `npm run ci` 全绿 → 再提交。

## 批次 ①：令牌生成与持久化（无害，不接网关）

- [ ] 新增 `lib/access-token.ts`：`ensureAccessToken` / `loadTokenHash`（0600、原子写、重启复用）。
- [ ] 新增 `lib/access-token.test.mjs`：生成/持久化/权限 0600/重启复用/损坏文件兜底。
- [ ] 验证 `npm run ci` 全绿。

**风险**：纯新增、无行为变更，可最先合并。

## 批次 ②：网关 + 客户端 + 启动注入（核心）

- [ ] 新增 `app/middleware.ts`：matcher `/api/:path*` + `/api/health`，三源校验 + 定时安全比较 +
      `PI_WEB_DISABLE_AUTH` 降级 + `/api/health` 开放。
- [ ] 新增 `lib/access-token-client.ts`：`getAccessToken` / `setAccessToken`（localStorage）。
- [ ] 改 `lib/csrf-client.ts#csrfHeaders`：合并 `Authorization: Bearer`。
- [ ] 改 `components/AppShell.tsx`：首屏从 `?token=` 取令牌存 localStorage 并 `replaceState` 抹除。
- [ ] 改 `bin/pi-web.js#startServer`：调 `ensureAccessToken`，哈希注入子进程 env，自动打开 URL 带
      `?token=`，非回环警告补充令牌提示。
- [ ] 新增 `app/instrumentation.ts`（dev 令牌注入 env）。
- [ ] 新增 `app/api/health/route.ts`：无状态 `{ok:true}`。
- [ ] middleware 单测：有效/无效/缺令牌/未配置哈希/禁用开关/health 开放。
- [ ] 验证 `npm run ci` 全绿 + 手动：隐身窗口无令牌访问 `/api/agent` 应 401；错误 `?token=` 401。

**风险**：批次 ② 是回归爆炸面最大处，务必带降级开关与完整单测。

## 批次 ③：L10 归属校验（并入敏感路由）

- [ ] 新增 `lib/session-ownership.ts`：`assertSessionOwned` / `assertFileWithinScope`。
- [ ] 在 `sessions/[id]/*` 与 `files/[...path]` 路由入口调用，越界返回 403/404。
- [ ] 与第 2 轮 `sessionReference` 受信根收敛互补（旁路再叠加 `assertFileWithinScope`）。
- [ ] 验证 `npm run ci` 全绿 + 手动：构造受信根外路径应被拒。

**风险**：需确认现有合法访问路径均落在受信根内，避免误杀正常请求（先加日志观察再加硬拒）。
