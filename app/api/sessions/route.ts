import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";
import { errorResponse } from "@/lib/api-utils";

// P1：分页。默认 limit=200，offset=0。返回 { sessions, total, hasMore, runningSessionIds }。
const DEFAULT_SESSIONS_LIMIT = 200;

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const limitParam = Number(sp.get("limit"));
    const offsetParam = Number(sp.get("offset"));
    // 仅当用户显式传 limit 时才分页切片；否则保持旧行为（返回全量），
    // 避免破坏未改造的前端（默认 limit=200 会丢失后续会话的回归风险）。
    const hasPagination = Number.isFinite(limitParam) && limitParam > 0;
    const limit = hasPagination ? limitParam : DEFAULT_SESSIONS_LIMIT;
    const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0;

    // 全量用于 count；分页切片仅在显式 limit 时生效。
    const all = await listAllSessions();
    const total = all.length;
    const paged = hasPagination ? await listAllSessions({ limit, offset }) : all;
    const hasMore = hasPagination && offset + paged.length < total;
    return NextResponse.json({
      sessions: paged,
      total,
      hasMore,
      runningSessionIds: getRunningRpcSessionIds(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
