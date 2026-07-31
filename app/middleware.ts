// S1 访问网关（Edge runtime）。
//
// 对所有 /api/* 请求做访问令牌校验，三源任选其一：
//   1. Authorization: Bearer <token>
//   2. Cookie __Host-pi-access=<token>
//   3. ?token=<token>
// 与 env.PI_WEB_ACCESS_TOKEN_HASH（sha256 哈希）做定时安全比较。
//
// 设计约束：
// - Edge 运行时不能读本地文件 → 哈希必须经 env 注入（spawn 透传 / instrumentation 写入）。
// - 降级开关 PI_WEB_DISABLE_AUTH=1：默认关闭；启用后整站开放（救命绳）。
// - D3：仅 /api/health 无状态开放（不含任何数据）。
// - D2：未配置哈希 → 强制拒绝（dev 也适用），不再「dev 自动开放」。
//
// 校验核心逻辑见 lib/access-gate.ts（纯函数，可单测）。

import { NextResponse, type NextRequest } from "next/server";
import { verifyAccessToken, extractProvidedToken } from "@/lib/access-gate";

export const config = {
  matcher: ["/api/:path*"],
};

function deny(reason: string): NextResponse {
  return new NextResponse(JSON.stringify({ error: "unauthorized", reason }), {
    status: 401,
    headers: { "WWW-Authenticate": "Bearer" },
  });
}

export async function middleware(req: NextRequest) {
  // 降级开关（默认关闭）
  if (process.env.PI_WEB_DISABLE_AUTH === "1") {
    return NextResponse.next();
  }

  // D3：无状态健康端点开放（不含任何数据）
  if (req.nextUrl.pathname === "/api/health") {
    return new NextResponse(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const expected = process.env.PI_WEB_ACCESS_TOKEN_HASH;

  const provided = extractProvidedToken({
    authorization: req.headers.get("authorization"),
    cookieToken: req.cookies.get("__Host-pi-access")?.value,
    queryToken: req.nextUrl.searchParams.get("token"),
  });

  const reason = await verifyAccessToken(provided, expected ?? undefined);
  if (reason) return deny(reason);

  return NextResponse.next();
}
