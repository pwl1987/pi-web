// 无状态健康检查端点（S1 网关 D3 开放项）。
// 不含任何会话/文件/配置数据；仅用于存活探测与网关放行白名单。
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
