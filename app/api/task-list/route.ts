import { NextResponse } from "next/server";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";
import { findEntryForTask } from "@/lib/task-entry-resolver";
import { errorResponse } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

interface TodoTask {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  blockedBy?: number[];
  owner?: string;
}

interface TaskDetails {
  tasks: TodoTask[];
  nextId: number;
}

function isTodoDetails(d: unknown): d is TaskDetails {
  if (typeof d !== "object" || d === null) return false;
  const obj = d as Record<string, unknown>;
  return Array.isArray(obj.tasks) && typeof obj.nextId === "number";
}

// GET /api/task-list?sessionId=... — read the latest todo snapshot from the session branch.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

    const filePath = await resolveSessionPath(sessionId);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const entries = getSessionEntries(filePath);

    // Walk the branch in chronological order, keep the last todo tool-result's details.
    // The same walk happens in lib/task-entry-resolver.findEntryForTask — but
    // here we want the LATEST todo entry overall (not per taskId), so we can't
    // reuse that helper directly.
    let lastTasks: TodoTask[] = [];
    let lastNextId = 0;
    for (const entry of entries) {
      const msg =
        "message" in entry
          ? (entry as { message?: { role?: string; toolName?: string; details?: unknown } }).message
          : undefined;
      if (!msg || msg.role !== "toolResult" || msg.toolName !== "todo") continue;
      if (isTodoDetails(msg.details)) {
        lastTasks = msg.details.tasks;
        lastNextId = msg.details.nextId;
      }
    }

    // Build a taskId → entryId map for click-to-jump (entry that last
    // mentioned each task). Single linear pass; O(n*m) where m is the
    // average tasks-per-snapshot. Fine for sessions up to ~10k entries.
    const entryIds: Record<number, string> = {};
    for (const task of lastTasks) {
      if (entryIds[task.id] !== undefined) continue; // already mapped
      const entry = findEntryForTask(entries, task.id);
      if (entry && typeof (entry as { id?: string }).id === "string") {
        entryIds[task.id] = (entry as { id: string }).id;
      }
    }

    // Filter out deleted (tombstones) by default.
    const visible = lastTasks.filter((t) => t.status !== "deleted");
    return NextResponse.json({ tasks: visible, nextId: lastNextId, entryIds });
  } catch (error) {
    return errorResponse(error);
  }
}
