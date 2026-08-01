import { NextResponse } from "next/server";
import { statSync, type Stats } from "fs";
import { homedir } from "os";
import { isAbsolute, resolve } from "path";
import { allowFileRoot } from "@/lib/file-access";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";

function normalizeCwd(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

// 新-9：拒绝把敏感系统目录或 home 下的隐藏凭据目录（~/.ssh、~/.gnupg、
// ~/.aws 等）纳入全局文件访问白名单，否则未鉴权的 cwd/validate 可被用来
// 把机密目录加入可浏览根。
const SENSITIVE_SYSTEM_DIRS = ["/etc", "/proc", "/sys", "/root", "/boot", "/usr", "/var", "/opt"];
function isSensitiveDir(cwd: string, home: string): boolean {
  for (const d of SENSITIVE_SYSTEM_DIRS) {
    if (cwd === d || cwd.startsWith(d + "/")) return true;
  }
  if (cwd === home || cwd.startsWith(home + "/.")) return true;
  return false;
}

// POST /api/cwd/validate  body: { cwd: string }
// Validates a candidate workspace before the UI selects it.
export async function POST(req: Request) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const [body, parseError] = await safeJsonBody<{ cwd?: unknown }>(req);
    if (parseError) return parseError;
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";

    if (!cwd) return errorResponse("Path is required", 400);

    const normalizedCwd = normalizeCwd(cwd);

    // 新-9：敏感目录不得加入全局白名单
    if (isSensitiveDir(normalizedCwd, homedir())) {
      return errorResponse(`Refusing to allow sensitive directory: ${cwd}`, 403);
    }

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
