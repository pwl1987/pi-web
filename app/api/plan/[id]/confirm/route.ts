// POST /api/plan/[id]/confirm  body: { planId? }
// 交互确认闭环的「确认」出口：把选中方案拆为任务 → 创建自主编程变更并启动运行 → 跳转引擎。
import { type NextRequest, NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse } from "@/lib/api-utils";
import { getOrchestrator } from "@/lib/agent-orchestrator";
import {
  registerDefaultEngine,
  getUnifiedEngineAdapter,
} from "@/lib/unified-engine/unified-engine-adapter";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(req);
  if (csrf) return csrf;
  try {
    const { id } = await params;
    const orch = getOrchestrator(id);
    if (!orch) return NextResponse.json({ error: "编排会话不存在" }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as { planId?: unknown };
    const planId = typeof body.planId === "string" ? body.planId : undefined;

    const payload = orch.prepareTasks(planId);
    if (!payload.cwd) {
      return NextResponse.json(
        { error: "缺少项目目录（cwd），无法创建自主编程变更" },
        { status: 400 },
      );
    }

    registerDefaultEngine();
    const adapter = getUnifiedEngineAdapter();
    const run = await adapter.createChange({
      title: payload.title,
      description: payload.description,
      cwd: payload.cwd,
    });
    const started = await adapter.startRun(run.runId);
    orch.markDone();

    return NextResponse.json({
      ok: true,
      runId: started.runId,
      changeName: started.changeName,
      status: started.status,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
