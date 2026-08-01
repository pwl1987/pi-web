import { NextResponse } from "next/server";
import { listExtensionsWithState } from "@/lib/extensions/discovery";
import { errorResponse } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

// GET /api/extensions/list — all discovered extensions with enabled state (for config UI).
export async function GET() {
  try {
    const extensions = listExtensionsWithState();
    return NextResponse.json({ extensions });
  } catch (error) {
    return errorResponse(error);
  }
}
