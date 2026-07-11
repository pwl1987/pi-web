import { type NextRequest, NextResponse } from "next/server";
import { installLocalExtension } from "@/lib/extensions/discovery";
import { validateCsrf } from "@/lib/csrf";

export const dynamic = "force-dynamic";

// POST /api/extensions/install — install a local extension via symlink.
// body: { path: string }  — absolute path to the extension source directory.
export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const body = (await req.json()) as { path?: string };
    const sourcePath = body.path?.trim();
    if (!sourcePath) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    const result = installLocalExtension(sourcePath);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
