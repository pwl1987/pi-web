import { NextResponse } from "next/server";
import { getPiAdapter } from "@/lib/pi";
import { resolveSessionPath, buildSessionContext } from "@/lib/session-reader";
import { errorResponse } from "@/lib/api-utils";

const { SessionManager } = getPiAdapter().codingAgent;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = SessionManager.open(filePath);
    const context = buildSessionContext(sm.getEntries() as never, leafId);

    return NextResponse.json({ context });
  } catch (error) {
    return errorResponse(error);
  }
}
