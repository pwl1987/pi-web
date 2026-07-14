import { type NextRequest, NextResponse } from "next/server";
import { setExtensionEnabled } from "@/lib/extensions/discovery";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

// POST /api/extensions/config — toggle extension enabled state.
// Body: { id: string, enabled: boolean }
// The change takes effect on next page reload (extensions are imported on load).
export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const [body, parseError] = await safeJsonBody<{ id?: string; enabled?: boolean }>(req);
    if (parseError) return parseError;
    if (typeof body.id !== "string" || typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "Expected { id: string, enabled: boolean }" },
        { status: 400 },
      );
    }
    setExtensionEnabled(body.id, body.enabled);
    return NextResponse.json({ success: true });
  } catch (e) {
    return errorResponse(e);
  }
}
