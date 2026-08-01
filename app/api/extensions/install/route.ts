import { type NextRequest, NextResponse } from "next/server";
import { installLocalExtension } from "@/lib/extensions/discovery";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

// POST /api/extensions/install — install a local extension via symlink.
// body: { path: string }  — absolute path to the extension source directory.
export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const [body, parseError] = await safeJsonBody<{ path?: string }>(req);
    if (parseError) return parseError;
    const sourcePath = body.path?.trim();
    if (!sourcePath) return errorResponse("path is required", 400);
    const result = installLocalExtension(sourcePath);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }
}
