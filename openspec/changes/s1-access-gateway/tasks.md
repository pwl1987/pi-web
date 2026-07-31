# 任务清单：S1 访问网关

## 批次 ①：令牌生成与持久化

- [ ] T1.1 新增 `lib/access-token.ts`（`ensureAccessToken`/`loadTokenHash`，0600，原子写，重启复用）
- [ ] T1.2 新增 `lib/access-token.test.mjs`（生成/持久化/权限/复用/损坏兜底）
- [ ] T1.3 `npm run ci` 全绿

## 批次 ②：网关 + 客户端 + 启动注入

- [ ] T2.1 新增 `app/middleware.ts`（matcher + 三源校验 + 定时安全比较 + 降级 + health 开放）
- [ ] T2.2 新增 `lib/access-token-client.ts`（localStorage get/set）
- [ ] T2.3 改 `lib/csrf-client.ts#csrfHeaders` 合并 `Authorization: Bearer`
- [ ] T2.4 改 `components/AppShell.tsx` 首屏 `?token=` 引导 + `replaceState` 抹除
- [ ] T2.5 改 `bin/pi-web.js#startServer` 注入哈希 env + 自动打开带 `?token=` + 警告补充
- [ ] T2.6 新增 `app/instrumentation.ts`（dev 令牌注入 env）
- [ ] T2.7 新增 `app/api/health/route.ts`（无状态）
- [ ] T2.8 middleware 单测（有效/无效/缺令牌/未配置/禁用/health）
- [ ] T2.9 手动验证隐身窗口 401 + `npm run ci` 全绿

## 批次 ③：L10 归属校验

- [ ] T3.1 新增 `lib/session-ownership.ts`（`assertSessionOwned`/`assertFileWithinScope`）
- [ ] T3.2 在 `sessions/[id]/*` 与 `files/[...path]` 入口调用
- [ ] T3.3 与 `sessionReference` 受信根收敛互补
- [ ] T3.4 `npm run ci` 全绿 + 手动越权拒绝验证
