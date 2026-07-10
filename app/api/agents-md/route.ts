import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

function resolveAgentsPath(level: string, cwd?: string): string {
  if (level === "user") return join(getAgentDir(), "AGENTS.md");
  if (level === "project" && cwd) return join(cwd, "AGENTS.md");
  throw new Error("Invalid level or missing cwd");
}

// GET /api/agents-md?level=user|project&cwd=<path>
export async function GET(req: NextRequest) {
  const level = req.nextUrl.searchParams.get("level");
  const cwd = req.nextUrl.searchParams.get("cwd") ?? undefined;
  if (level !== "user" && level !== "project") {
    return NextResponse.json({ error: "level must be 'user' or 'project'" }, { status: 400 });
  }
  try {
    const filePath = resolveAgentsPath(level, cwd);
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
    const body = await req.json() as { level?: string; cwd?: string; content?: string };
    if (body.level !== "user" && body.level !== "project") {
      return NextResponse.json({ error: "level must be 'user' or 'project'" }, { status: 400 });
    }
    const filePath = resolveAgentsPath(body.level, body.cwd);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, body.content ?? "", "utf8");
    return NextResponse.json({ success: true, path: filePath });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
