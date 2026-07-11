import { type NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { extname } from "path";
import { resolveExtensionAsset } from "@/lib/extensions/discovery";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

// GET /api/extensions/<extension-id>/<asset-path> — serve extension static assets.
// Uses [extensionId]/[...asset] (two-segment) routing so single-segment static
// routes (manifest, config, git-status) are never intercepted.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ extensionId: string; asset: string[] }> },
) {
  const { extensionId, asset } = await params;
  const assetPath = asset.join("/");

  const resolved = resolveExtensionAsset(extensionId, assetPath);
  if (!resolved) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const data = readFileSync(resolved.absPath);
  const mime = MIME[extname(resolved.absPath).toLowerCase()] ?? "application/octet-stream";

  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Cache-Control": "no-cache",
    },
  });
}
