import { NextResponse } from "next/server";
import { statSync, type Stats } from "fs";
import { homedir } from "os";
import { isAbsolute, resolve } from "path";
import { allowFileRoot } from "@/lib/file-access";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse } from "@/lib/api-utils";

function normalizeCwd(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

// POST /api/cwd/validate  body: { cwd: string }
// Validates a candidate workspace before the UI selects it.
export async function POST(req: Request) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const body = (await req.json()) as { cwd?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";

    if (!cwd) return errorResponse("Path is required", 400);

    const normalizedCwd = normalizeCwd(cwd);
    let stat: Stats;
    try {
      stat = statSync(normalizedCwd);
    } catch {
      return errorResponse(`Directory does not exist: ${cwd}`, 400);
    }

    if (!stat.isDirectory()) return errorResponse(`Path is not a directory: ${cwd}`, 400);

    allowFileRoot(normalizedCwd);
    return NextResponse.json({ success: true, cwd: normalizedCwd });
  } catch (error) {
    return errorResponse(error);
  }
}
