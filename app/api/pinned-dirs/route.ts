import { NextResponse } from "next/server";
import { statSync } from "fs";
import { isAbsolute, resolve } from "path";
import { homedir } from "os";
import { allowFileRoot } from "@/lib/file-access";
import { getPinnedDirs, addPinnedDir, removePinnedDir } from "@/lib/session-state-store";

function normalizeCwd(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

// GET /api/pinned-dirs — list all pinned directories.
export async function GET() {
  try {
    return NextResponse.json({ pinnedDirs: getPinnedDirs() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/pinned-dirs  body: { path: string; alias?: string }
// Validates the path exists, registers it as an allowed file root, and pins it.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { path?: unknown; alias?: unknown };
    const rawPath = typeof body.path === "string" ? body.path.trim() : "";
    const alias = typeof body.alias === "string" ? body.alias : undefined;

    if (!rawPath) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const normalized = normalizeCwd(rawPath);
    try {
      const stat = statSync(normalized);
      if (!stat.isDirectory()) {
        return NextResponse.json({ error: `Path is not a directory: ${rawPath}` }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: `Directory does not exist: ${rawPath}` }, { status: 400 });
    }

    allowFileRoot(normalized);
    const pinned = addPinnedDir(normalized, alias);
    return NextResponse.json({ pinnedDir: pinned });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/pinned-dirs  body: { path: string }
// Unpins the directory matching `path` (normalized before comparison).
export async function DELETE(req: Request) {
  try {
    const body = (await req.json()) as { path?: unknown };
    const rawPath = typeof body.path === "string" ? body.path.trim() : "";

    if (!rawPath) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const normalized = normalizeCwd(rawPath);
    const removed = removePinnedDir(normalized);
    return NextResponse.json({ removed });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
