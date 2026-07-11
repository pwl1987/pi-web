import { type NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { ensureParentDir } from "@/lib/config-file";
import { errorResponse } from "@/lib/api-utils";
import { validateCsrf } from "@/lib/csrf";

export const dynamic = "force-dynamic";

type PromptFile = "agents" | "system" | "append";

const FILE_NAMES: Record<PromptFile, string> = {
  agents: "AGENTS.md",
  system: "SYSTEM.md",
  append: "APPEND_SYSTEM.md",
};

function resolvePath(file: PromptFile, level: string, cwd?: string): string {
  const fileName = FILE_NAMES[file];
  if (level === "user") return join(getAgentDir(), fileName);
  if (level === "project") {
    if (!cwd) throw new Error("cwd is required for project level");
    // SYSTEM.md and APPEND_SYSTEM.md live in <cwd>/.pi/, AGENTS.md in <cwd>/
    if (file === "agents") return join(cwd, fileName);
    return join(cwd, ".pi", fileName);
  }
  throw new Error("Invalid level");
}

// GET /api/agents-md?file=agents|system|append&level=user|project&cwd=<path>
export async function GET(req: NextRequest) {
  const file = (req.nextUrl.searchParams.get("file") ?? "agents") as PromptFile;
  const level = req.nextUrl.searchParams.get("level");
  const cwd = req.nextUrl.searchParams.get("cwd") ?? undefined;

  if (!FILE_NAMES[file]) {
    return NextResponse.json(
      { error: "file must be 'agents', 'system', or 'append'" },
      { status: 400 },
    );
  }
  if (level !== "user" && level !== "project") {
    return NextResponse.json({ error: "level must be 'user' or 'project'" }, { status: 400 });
  }
  // For project-level reads, validate cwd is within allowed roots — otherwise
  // an attacker could read AGENTS.md/SYSTEM.md/APPEND_SYSTEM.md from any path.
  if (level === "project" && cwd) {
    const resolvedCwd = resolve(cwd);
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(resolvedCwd, allowedRoots)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  try {
    const filePath = resolvePath(file, level, cwd);
    if (!existsSync(filePath)) {
      return NextResponse.json({ content: "", exists: false, path: filePath });
    }
    const content = readFileSync(filePath, "utf8");
    return NextResponse.json({ content, exists: true, path: filePath });
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/agents-md — write content
const MAX_AGENTS_MD_SIZE = 1_000_000; // 1MB limit
export async function PUT(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const body = (await req.json()) as {
      file?: string;
      level?: string;
      cwd?: string;
      content?: string;
    };
    const file = (body.file ?? "agents") as PromptFile;
    if (!FILE_NAMES[file]) {
      return NextResponse.json(
        { error: "file must be 'agents', 'system', or 'append'" },
        { status: 400 },
      );
    }
    if (body.level !== "user" && body.level !== "project") {
      return NextResponse.json({ error: "level must be 'user' or 'project'" }, { status: 400 });
    }
    // Limit content size
    const content = body.content ?? "";
    if (content.length > MAX_AGENTS_MD_SIZE) {
      return NextResponse.json({ error: "content too large" }, { status: 413 });
    }
    // For project-level writes, validate cwd is within allowed roots
    if (body.level === "project" && body.cwd) {
      const resolvedCwd = resolve(body.cwd);
      const allowedRoots = await getAllowedFileRoots();
      if (!isFilePathAllowed(resolvedCwd, allowedRoots)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }
    const filePath = resolvePath(file, body.level, body.cwd);
    ensureParentDir(filePath);
    writeFileSync(filePath, content, "utf8");
    return NextResponse.json({ success: true, path: filePath });
  } catch (error) {
    return errorResponse(error);
  }
}
