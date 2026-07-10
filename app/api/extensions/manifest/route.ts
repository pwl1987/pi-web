import { NextResponse } from "next/server";
import { buildManifest } from "@/lib/extensions/discovery";

export const dynamic = "force-dynamic";

// GET /api/extensions/manifest.json — list discoverable browser-side extensions.
// The browser fetches this on page load and dynamically imports each module.
export async function GET() {
  const manifest = buildManifest();
  return NextResponse.json(manifest, {
    headers: { "Cache-Control": "no-store" },
  });
}
