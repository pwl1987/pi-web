import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { allowFileRoot } from "@/lib/file-access";
import { startRpcSession } from "@/lib/rpc-manager";
import { isAllowedAgentCommand } from "@/lib/allowed-commands";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse } from "@/lib/api-utils";

// POST /api/agent/new  body: { cwd: string; type: string; message?: string; ... }
// Spawns a brand-new pi session. Most calls immediately send the first command;
// type:"ensure_session" only creates the runtime so clients can query commands.
// Returns { sessionId, data } where sessionId is pi's real session id.
export async function POST(req: Request) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const body = (await req.json()) as { cwd?: string; [key: string]: unknown };
    const { cwd, ...command } = body;

    if (!cwd || typeof cwd !== "string") return errorResponse("cwd is required", 400);
    if (!existsSync(cwd)) return errorResponse(`Directory does not exist: ${cwd}`, 400);

    // Use a one-time key so startRpcSession's lock doesn't conflict with real session ids
    const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } = command as {
      provider?: string;
      modelId?: string;
      toolNames?: string[];
      thinkingLevel?: string;
      [key: string]: unknown;
    };

    const tempKey = `__new__${Date.now()}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames);

    // Keep the files-route allowed-roots cache (see app/api/files/[...path]/route.ts)
    // in sync so the new cwd is immediately readable via /api/files. Without this,
    // a file request under a brand-new cwd would 403 for up to the cache TTL.
    allowFileRoot(cwd);

    // Apply pre-selected model before sending the prompt
    if (provider && modelId) {
      await session.send({ type: "set_model", provider, modelId });
    }

    // Apply pre-selected thinking level before sending the prompt
    if (thinkingLevel) {
      await session.send({ type: "set_thinking_level", level: thinkingLevel });
    }

    if (promptCommand.type === "ensure_session") {
      return NextResponse.json({ success: true, sessionId: realSessionId, data: null });
    }

    // Gate the dispatched command through the same allowlist as /api/agent/[id].
    // Without this, a client could spread arbitrary fields into the body and
    // invoke any wrapper command type (e.g. reload) bypassing the [id] gate.
    if (typeof promptCommand.type !== "string" || !isAllowedAgentCommand(promptCommand.type)) {
      return errorResponse(`unknown command: ${promptCommand.type ?? ""}`, 400);
    }

    const result = await session.send(promptCommand);

    return NextResponse.json({ success: true, sessionId: realSessionId, data: result });
  } catch (error) {
    return errorResponse(error);
  }
}
