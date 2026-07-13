import { type NextRequest, NextResponse } from "next/server";
import { uninstallExtension, listExtensionsWithState } from "@/lib/extensions/discovery";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

// POST /api/extensions/uninstall — remove a local extension.
// body: { id: string }
export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const body = (await req.json()) as { id?: string };
    const id = body.id?.trim();
    if (!id) return errorResponse("id is required", 400);

    // Safety: bundled extensions cannot be uninstalled.
    const extensions = listExtensionsWithState();
    const ext = extensions.find((e) => e.id === id);
    if (ext && !ext.canUninstall) {
      return errorResponse(`Cannot uninstall bundled extension "${id}". Disable it instead.`, 400);
    }

    uninstallExtension(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }
}
