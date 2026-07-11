import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ALLOWED_AGENT_COMMANDS } from "@/lib/allowed-commands";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse } from "@/lib/api-utils";

// POST /api/agent/[id] - Send a command to an existing session

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const { id } = await params;

  try {
    const body = (await req.json()) as { type: string; [key: string]: unknown };

    if (!ALLOWED_AGENT_COMMANDS.has(body.type)) {
      return NextResponse.json({ error: `unknown command: ${body.type}` }, { status: 400 });
    }

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      return NextResponse.json({ success: true, data: result });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();

    const { session } = await startRpcSession(id, filePath, cwd);
    const result = await session.send(body);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return errorResponse(error);
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return errorResponse(error);
  }
}
