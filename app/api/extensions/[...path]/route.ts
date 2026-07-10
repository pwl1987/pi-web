import { NextRequest, NextResponse } from "next/server";
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
// The first path segment is the extension id; the rest is the asset path within
// the extension's package directory.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  if (segments.length < 2) {
    return NextResponse.json({ error: "Expected /<extension-id>/<asset-path>" }, { status: 400 });
  }

  const extensionId = segments[0];
  const assetPath = segments.slice(1).join("/");

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
