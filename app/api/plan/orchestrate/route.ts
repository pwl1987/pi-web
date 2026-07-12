// POST /api/plan/orchestrate
// 创建并启动一次多 Agent 协同讨论。body: { requirement, cwd?, config?, mock? }
// → { id, status }
import { type NextRequest, NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse } from "@/lib/api-utils";
import {
  createCompleteSimpleRunner,
  createMockRunner,
  createOrchestrator,
  createPiLlmCompletion,
  type OrchestratorConfig,
} from "@/lib/agent-orchestrator";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const csrf = validateCsrf(req);
  if (csrf) return csrf;

  try {
    const body = (await req.json()) as {
      requirement?: unknown;
      cwd?: unknown;
      config?: Partial<OrchestratorConfig>;
      mock?: unknown;
    };
    const requirement = typeof body.requirement === "string" ? body.requirement.trim() : "";
    if (!requirement) {
      return NextResponse.json({ error: "需求内容为空" }, { status: 400 });
    }
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : undefined;
    const useMock = body.mock === true;

    const runner = useMock
      ? createMockRunner({ planCount: body.config?.planCount ?? 2 })
      : createCompleteSimpleRunner(createPiLlmCompletion(cwd));

    const orch = createOrchestrator({
      requirement,
      cwd,
      config: body.config,
      runner,
    });
    orch.start();

    return NextResponse.json({ id: orch.id, status: orch.status });
  } catch (error) {
    return errorResponse(error);
  }
}
