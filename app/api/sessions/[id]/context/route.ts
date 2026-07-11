import { NextResponse } from "next/server";
import { resolveSessionPath, buildSessionContext, getSessionEntries } from "@/lib/session-reader";
import { errorResponse } from "@/lib/api-utils";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const entries = getSessionEntries(filePath);
    const context = buildSessionContext(entries, leafId);

    return NextResponse.json({ context });
  } catch (error) {
    return errorResponse(error);
  }
}
