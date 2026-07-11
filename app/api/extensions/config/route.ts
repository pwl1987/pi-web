import { type NextRequest, NextResponse } from "next/server";
import { setExtensionEnabled } from "@/lib/extensions/discovery";

export const dynamic = "force-dynamic";

// POST /api/extensions/config — toggle extension enabled state.
// Body: { id: string, enabled: boolean }
// The change takes effect on next page reload (extensions are imported on load).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; enabled?: boolean };
    if (typeof body.id !== "string" || typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "Expected { id: string, enabled: boolean }" },
        { status: 400 },
      );
    }
    setExtensionEnabled(body.id, body.enabled);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update config" }, { status: 500 });
  }
}
