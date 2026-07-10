import { NextResponse } from "next/server";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";

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
  tasks?: unknown[];
  nextId?: number;
}

function isTodoDetails(d: unknown): d is TaskDetails {
  return typeof d === "object" && d !== null && Array.isArray((d as TaskDetails).tasks) && typeof (d as TaskDetails).nextId === "number";
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
    // This mirrors rpiv-todo's own replay logic (state/replay.ts).
    let lastTasks: TodoTask[] = [];
    let lastNextId = 0;
    for (const entry of entries) {
      const msg = ("message" in entry ? (entry as { message?: { role?: string; toolName?: string; details?: unknown } }).message : undefined);
      if (!msg || msg.role !== "toolResult" || msg.toolName !== "todo") continue;
      if (isTodoDetails(msg.details)) {
        lastTasks = (msg.details as TaskDetails).tasks as TodoTask[];
        lastNextId = (msg.details as TaskDetails).nextId ?? 0;
      }
    }

    // Filter out deleted (tombstones) by default.
    const visible = lastTasks.filter((t) => t.status !== "deleted");
    return NextResponse.json({ tasks: visible, nextId: lastNextId });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
