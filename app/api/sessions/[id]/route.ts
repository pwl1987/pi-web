import { NextResponse } from "next/server";
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { getPiAdapter } from "@/lib/pi";
import {
  resolveSessionPath,
  invalidateSessionPathCache,
  invalidateSessionDataCache,
  buildSessionContext,
  listAllSessions,
  openSessionCached,
} from "@/lib/session-reader";

const { SessionManager } = getPiAdapter();
import { getRpcSession } from "@/lib/rpc-manager";
import { reparentSessionHeader } from "@/lib/session-reparent";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";

// BranchNavigator still traverses recursively, so keep the response tree shallow.
const MAX_PROJECTED_TREE_DEPTH = 200;

/**
 * Project the session tree into the shallow navigation tree sent to the client.
 * Keeps roots, branch points, and leaves while contracting single-child chains
 * without recursive traversal. Contracted entry IDs are attached to the next
 * visible node so the UI can still recognize an active leaf inside the chain.
 */
function projectTreeForResponse<
  T extends { entry: { id: string }; children: T[]; compressedEntryIds?: string[] },
>(nodes: T[]): T[] {
  const keep = new Set<T>();
  const roots = new Set(nodes);
  const seen = new Set<T>();
  const stack = [...nodes];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);

    if (roots.has(node) || node.children.length !== 1) {
      keep.add(node);
    }

    for (const child of node.children) {
      stack.push(child);
    }
  }

  const cloneNode = (node: T, compressedEntryIds?: string[]): T => ({
    ...node,
    children: [],
    ...(compressedEntryIds?.length ? { compressedEntryIds } : {}),
  });
  const projectedRoots = nodes.map((node) => cloneNode(node));
  const tasks = nodes.map((source, index) => ({
    source,
    projected: projectedRoots[index],
    depth: 1,
  }));

  const appendFlattenedKeptDescendants = (source: T, projectedParent: T) => {
    const pending = [{ node: source, compressedEntryIds: [] as string[] }];
    const flattenedSeen = new Set<T>();

    while (pending.length > 0) {
      const { node, compressedEntryIds } = pending.pop()!;
      if (flattenedSeen.has(node)) continue;
      flattenedSeen.add(node);

      if (keep.has(node)) {
        projectedParent.children.push(cloneNode(node, compressedEntryIds));
      }

      for (let i = node.children.length - 1; i >= 0; i--) {
        pending.push({
          node: node.children[i],
          compressedEntryIds: keep.has(node) ? [] : [...compressedEntryIds, node.entry.id],
        });
      }
    }
  };

  while (tasks.length > 0) {
    const { source, projected, depth } = tasks.pop()!;

    for (const sourceChild of source.children) {
      let child = sourceChild;

      if (depth >= MAX_PROJECTED_TREE_DEPTH) {
        appendFlattenedKeptDescendants(child, projected);
        continue;
      }

      const compressedEntryIds: string[] = [];
      while (!keep.has(child) && child.children.length === 1) {
        compressedEntryIds.push(child.entry.id);
        child = child.children[0];
      }

      if (!keep.has(child)) {
        continue;
      }

      const projectedChild = cloneNode(child, compressedEntryIds);
      projected.children.push(projectedChild);
      tasks.push({ source: child, projected: projectedChild, depth: depth + 1 });
    }
  }

  return projectedRoots;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return errorResponse("Session not found", 404);

    const snap = openSessionCached(filePath);
    const tree = projectTreeForResponse(snap.tree as Parameters<typeof projectTreeForResponse>[0]);
    const context = buildSessionContext(snap.entries, snap.leafId);

    const header = snap.header;
    let modified =
      ((header as Record<string, unknown> | null)?.timestamp as string) ?? new Date().toISOString();
    try {
      modified = statSync(filePath).mtime.toISOString();
    } catch {
      /* use header timestamp */
    }
    const allSessions = await listAllSessions();
    const parentSessionId = allSessions.find((s) => s.id === id)?.parentSessionId;
    const info = header
      ? {
          path: filePath,
          id: (header as Record<string, unknown>).id as string,
          cwd: ((header as Record<string, unknown>).cwd as string) ?? "",
          name: snap.sessionName,
          created: (header as Record<string, unknown>).timestamp as string,
          modified,
          messageCount: context.messages.length,
          firstMessage: context.messages.find((m) => m.role === "user")
            ? (() => {
                const msg = context.messages.find((m) => m.role === "user")!;
                const c = (msg as { content: unknown }).content;
                return typeof c === "string"
                  ? c
                  : (Array.isArray(c)
                      ? ((
                          c.find((b: { type: string }) => b.type === "text") as
                            { text: string } | undefined
                        )?.text ?? "")
                      : "") || "(no messages)";
              })()
            : "(no messages)",
          parentSessionId,
        }
      : null;

    const url = new URL(req.url);
    let agentState: { running: boolean; state?: unknown; timedOut?: boolean } | undefined;
    if (url.searchParams.has("includeState")) {
      const rpc = getRpcSession(id);
      if (rpc?.isAlive()) {
        // Race the state fetch against a timeout: get_state can hang if the
        // underlying agent is mid-construction or an extension binding blocks.
        // Rather than stall the whole session GET, degrade gracefully.
        const GET_STATE_TIMEOUT_MS = 5_000;
        const statePromise = rpc.send({ type: "get_state" });
        const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
          const timer = setTimeout(() => resolve({ timedOut: true }), GET_STATE_TIMEOUT_MS);
          // Don't let the pending timeout keep the Node event loop alive (and
          // block graceful process exit) when get_state resolves first.
          timer.unref?.();
        });
        const result = await Promise.race([statePromise, timeoutPromise]);
        if (result && typeof result === "object" && "timedOut" in result) {
          agentState = { running: true, state: null, timedOut: true };
        } else {
          agentState = { running: true, state: result };
        }
      } else {
        agentState = { running: false };
      }
    }

    return NextResponse.json({
      sessionId: id,
      filePath,
      info,
      leafId: snap.leafId,
      tree,
      context,
      ...(agentState !== undefined ? { agentState } : {}),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const { id } = await params;
  try {
    const [body, parseError] = await safeJsonBody<{ name?: string }>(req);
    if (parseError) return parseError;
    const { name } = body;
    if (typeof name !== "string") return errorResponse("name is required", 400);
    const filePath = await resolveSessionPath(id);
    if (!filePath) return errorResponse("Session not found", 404);
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(name.trim());
    invalidateSessionDataCache(filePath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return errorResponse("Session not found", 404);

    // Read header before deleting to get parentSession path
    const firstLine = readFileSync(filePath, "utf8").split("\n")[0];
    let parentSessionPath: string | undefined;
    try {
      const header = JSON.parse(firstLine) as { type?: string; parentSession?: string };
      if (header.type === "session") parentSessionPath = header.parentSession;
    } catch {
      /* ignore */
    }

    // Re-attach all direct children to this session's parent (cascade re-parent)
    // Scan sibling files in the same directory
    const dir = filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    try {
      const files = readdirSync(dir).filter(
        (f) => f.endsWith(".jsonl") && join(dir, f) !== filePath,
      );
      for (const file of files) {
        const childPath = join(dir, file);
        try {
          const content = readFileSync(childPath, "utf8");
          const firstLine = content.split("\n", 1)[0];
          const header = JSON.parse(firstLine) as { type?: string; parentSession?: string };
          if (header.type === "session" && header.parentSession === filePath) {
            // Rewrite ONLY the header line, preserving every subsequent byte —
            // re-joining the whole file normalized line endings and rewrote
            // large session files just to change one header field.
            writeFileSync(childPath, reparentSessionHeader(content, parentSessionPath), "utf8");
          }
        } catch {
          /* skip malformed */
        }
      }
    } catch {
      /* skip if dir unreadable */
    }

    getRpcSession(id)?.destroy();
    invalidateSessionDataCache(filePath);
    invalidateSessionPathCache(id);
    unlinkSync(filePath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
