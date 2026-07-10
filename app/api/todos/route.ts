import { NextResponse } from "next/server";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

    const filePath = await resolveSessionPath(sessionId);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const entries = getSessionEntries(filePath);
    return NextResponse.json({ tasks: [], entryCount: entries.length });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
