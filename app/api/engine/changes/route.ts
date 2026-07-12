import { NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse } from "@/lib/api-utils";
import {
  registerDefaultEngine,
  getUnifiedEngineAdapter,
} from "@/lib/unified-engine/unified-engine-adapter";

// POST /api/engine/changes  body: { title, description?, cwd }
// 创建一次自主编程变更（autoplan 需求 + comet change 二合一），返回 RunState。
export async function POST(req: Request) {
  const csrf = validateCsrf(req);
  if (csrf) return csrf;

  try {
    const body = (await req.json()) as { title?: unknown; description?: unknown; cwd?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const description = typeof body.description === "string" ? body.description : undefined;

    if (!title) return NextResponse.json({ error: "title 必填" }, { status: 400 });
    if (!cwd)
      return NextResponse.json(
        { error: "cwd 必填（项目根目录，comet 状态机工作目录）" },
        { status: 400 },
      );

    registerDefaultEngine();
    const run = await getUnifiedEngineAdapter().createChange({ title, description, cwd });
    return NextResponse.json(run);
  } catch (error) {
    return errorResponse(error);
  }
}
