import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

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
    return NextResponse.json({ error: "file must be 'agents', 'system', or 'append'" }, { status: 400 });
  }
  if (level !== "user" && level !== "project") {
    return NextResponse.json({ error: "level must be 'user' or 'project'" }, { status: 400 });
  }
  try {
    const filePath = resolvePath(file, level, cwd);
    if (!existsSync(filePath)) {
      return NextResponse.json({ content: "", exists: false, path: filePath });
    }
    const content = readFileSync(filePath, "utf8");
    return NextResponse.json({ content, exists: true, path: filePath });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT /api/agents-md — write content
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as { file?: string; level?: string; cwd?: string; content?: string };
    const file = (body.file ?? "agents") as PromptFile;
    if (!FILE_NAMES[file]) {
      return NextResponse.json({ error: "file must be 'agents', 'system', or 'append'" }, { status: 400 });
    }
    if (body.level !== "user" && body.level !== "project") {
      return NextResponse.json({ error: "level must be 'user' or 'project'" }, { status: 400 });
    }
    const filePath = resolvePath(file, body.level, body.cwd);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, body.content ?? "", "utf8");
    return NextResponse.json({ success: true, path: filePath });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
