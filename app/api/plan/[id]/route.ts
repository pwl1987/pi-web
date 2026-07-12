// GET /api/plan/[id] → 当前编排快照（供前端初次加载 / 轮询）
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-utils";
import {
  getOrchestrator,
  setOrchestratorRunnerFactory,
  createRoleAwareRunner,
  resolveLlmForRole,
} from "@/lib/agent-orchestrator";
import { loadPlanModelConfig } from "@/lib/plan-mode-config";

export const dynamic = "force-dynamic";

// 注册真实 runner 工厂，确保刷新时 rehydrate 出的编排器可继续真实讨论（幂等）。
setOrchestratorRunnerFactory((cwd) =>
  createRoleAwareRunner((role) => resolveLlmForRole(cwd, role, loadPlanModelConfig())),
);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orch = getOrchestrator(id);
    if (!orch) return NextResponse.json({ error: "编排会话不存在" }, { status: 404 });
    return NextResponse.json(orch.getSnapshot());
  } catch (error) {
    return errorResponse(error);
  }
}
