import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { errorResponse } from "@/lib/api-utils";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout.trim();
}

/** Parse `git diff --numstat` output and sum added/deleted columns. */
function sumNumstat(output: string): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const a = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    // Binary files show "-" for counts — skip them.
    if (Number.isFinite(a)) added += a;
    if (Number.isFinite(d)) deleted += d;
  }
  return { added, deleted };
}

// GET /api/git-diff?cwd=... — returns line-level diff stats + branch + file counts.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const cwd = searchParams.get("cwd");
    if (!cwd || !existsSync(cwd)) {
      return NextResponse.json({ error: "Invalid cwd" }, { status: 400 });
    }
    // Restrict to allowed roots — without this, the endpoint could probe the git
    // state (branch, diff counts) of any directory on the host.
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // Check it's a git repo.
    try {
      await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    } catch {
      return NextResponse.json({
        isGit: false,
        branch: null,
        added: 0,
        deleted: 0,
        modified: 0,
        staged: 0,
        untracked: 0,
      });
    }

    // Get branch name.
    let branch: string | null = null;
    try {
      branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
      if (branch === "HEAD") branch = null; // detached
    } catch {
      /* detached or error */
    }

    // Unstaged changes (worktree vs index).
    let unstaged = { added: 0, deleted: 0 };
    try {
      unstaged = sumNumstat(await git(cwd, ["diff", "--numstat"]));
    } catch {
      /* no changes or error */
    }

    // Staged changes (index vs HEAD).
    let staged = { added: 0, deleted: 0 };
    try {
      staged = sumNumstat(await git(cwd, ["diff", "--cached", "--numstat"]));
    } catch {
      /* no changes or error */
    }

    // File counts from porcelain status.
    let modified = 0;
    let stagedCount = 0;
    let untracked = 0;
    try {
      const status = await git(cwd, ["status", "--porcelain"]);
      for (const line of status.split("\n")) {
        if (line.length < 2) continue;
        const x = line[0];
        const y = line[1];
        if (x === "?" && y === "?") untracked++;
        else {
          if (x !== " " && x !== "?") stagedCount++;
          if (y !== " " && y !== "?") modified++;
        }
      }
    } catch {
      /* ignore */
    }

    return NextResponse.json({
      isGit: true,
      branch,
      added: unstaged.added + staged.added,
      deleted: unstaged.deleted + staged.deleted,
      modified,
      staged: stagedCount,
      untracked,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
