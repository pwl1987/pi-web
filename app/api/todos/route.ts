import { NextResponse } from "next/server";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";
import { errorResponse } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    if (!sessionId) return errorResponse("sessionId required", 400);

    const filePath = await resolveSessionPath(sessionId);
    if (!filePath) return errorResponse("Session not found", 404);

    const entries = getSessionEntries(filePath);
    return NextResponse.json({ tasks: [], entryCount: entries.length });
  } catch (error) {
    return errorResponse(error);
  }
}
