import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { ensureSession, getSession, readSessionCwd } from "@/lib/services/session-service";
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
    const existing = getSession(id);
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      return NextResponse.json({ success: true, data: result });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const cwd = readSessionCwd(filePath);

    const { session } = await ensureSession(id, filePath, cwd);
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
    const session = getSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    // Race get_state against a timeout. get_state can hang (agent mid-
    // construction, a blocking extension binding) and this endpoint is polled
    // by the client's reconcile loop, so a stalled fetch must not wedge the
    // loop or keep the Node event loop alive. On timeout or rejection we report
    // running with no state and a timedOut flag, so the client keeps its
    // current UI and retries on the next poll instead of prematurely finishing
    // a run it can't confirm has ended.
    const GET_STATE_TIMEOUT_MS = 5_000;
    const state = await new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: true }), GET_STATE_TIMEOUT_MS);
      // Don't keep the event loop alive (and block graceful exit) if get_state
      // resolves first and the timer is still pending.
      timer.unref?.();
      session.send({ type: "get_state" }).then(
        (s) => {
          clearTimeout(timer);
          resolve(s);
        },
        (err) => {
          clearTimeout(timer);
          // Unknown phase on error — assume still running and let the client retry.
          resolve({ timedOut: true, error: String(err) });
        },
      );
    });

    if (state && typeof state === "object" && "timedOut" in state) {
      return NextResponse.json({ running: true, state: null, timedOut: true });
    }
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return errorResponse(error);
  }
}
