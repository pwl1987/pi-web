import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { getPiAdapter } from "@/lib/pi";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";

const { DefaultResourceLoader, getAgentDir, parseFrontmatter } = getPiAdapter();

export const dynamic = "force-dynamic";

// GET /api/skills?cwd=<path>
// Uses DefaultResourceLoader (same logic as AgentSession startup) so settings.json
// skill paths, package skills, and .agents/skills directories are all included.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return errorResponse("cwd required", 400);

  try {
    const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
    await loader.reload();
    const { skills, diagnostics } = loader.getSkills();
    return NextResponse.json({ skills, diagnostics });
  } catch (e) {
    return errorResponse(e);
  }
}

// PATCH /api/skills — toggle disable-model-invocation on a SKILL.md file
export async function PATCH(req: Request) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const [body, parseError] = await safeJsonBody<{
      filePath: string;
      disableModelInvocation: boolean;
    }>(req);
    if (parseError) return parseError;
    const { filePath, disableModelInvocation } = body;
    if (!filePath) return errorResponse("filePath required", 400);

    // Prevent path traversal: only allow files within allowed roots
    const resolved = resolve(filePath);
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(resolved, allowedRoots)) {
      // Also allow files under the agent dir itself (for user-scoped skills)
      const agentDir = resolve(getAgentDir());
      if (!resolved.startsWith(agentDir)) return errorResponse("forbidden", 403);
    }
    if (!existsSync(resolved)) return errorResponse("file not found", 404);

    const content = readFileSync(resolved, "utf8");
    const key = "disable-model-invocation";

    // Use parseFrontmatter to check current value, then do a surgical line edit
    // to preserve the original YAML formatting of all other fields.
    const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
    const alreadySet = Boolean(frontmatter[key]);

    let updated = content;
    if (disableModelInvocation && !alreadySet) {
      // Add key after the opening --- line
      updated = content.replace(/^---\r?\n/, `---\n${key}: true\n`);
      // If no frontmatter exists, create one
      if (updated === content) updated = `---\n${key}: true\n---\n${content}`;
    } else if (!disableModelInvocation && alreadySet) {
      // Remove the key line entirely
      updated = content.replace(new RegExp(`^${key}\\s*:.*\\r?\\n`, "m"), "");
    }

    writeFileSync(resolved, updated, "utf8");
    return NextResponse.json({ success: true });
  } catch (e) {
    return errorResponse(e);
  }
}
