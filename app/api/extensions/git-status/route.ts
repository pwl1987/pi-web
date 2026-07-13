import { type NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { join } from "path";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { errorResponse } from "@/lib/api-utils";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

// GET /api/extensions/git-status?cwd=<path> — return git status summary for a directory.
// Used by the built-in git-status extension panel.
export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get("cwd");
  if (!cwd || !existsSync(cwd)) return errorResponse("Invalid cwd", 400);
  // Restrict to allowed roots — the panel is driven by the selected project cwd,
  // but the endpoint must not let a caller probe arbitrary directories' git state.
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots)) return errorResponse("forbidden", 403);

  // Check if it's a git repo.
  const gitDir = join(cwd, ".git");
  if (!existsSync(gitDir)) return errorResponse("Not a git repository", 404);

  try {
    // Get branch name.
    const { stdout: branchOut } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd, timeout: 5000 },
    ).catch(() => ({ stdout: "" }));

    // Get porcelain status counts.
    const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    }).catch(() => ({ stdout: "" }));

    let modified = 0,
      staged = 0,
      untracked = 0;
    for (const line of statusOut.trim().split("\n")) {
      if (!line) continue;
      const x = line[0];
      const y = line[1];
      if (x === "?" && y === "?") untracked++;
      else {
        if (x !== " " && x !== "?") staged++;
        if (y !== " " && y !== "?") modified++;
      }
    }

    return NextResponse.json({
      branch: branchOut.trim() || null,
      modified,
      staged,
      untracked,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
