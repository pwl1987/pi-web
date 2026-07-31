import { type NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { extname } from "path";
import { resolveExtensionAsset } from "@/lib/extensions/discovery";
import { errorResponse } from "@/lib/api-utils";

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
  if (!resolved) return errorResponse("Asset not found", 404);

  const data = readFileSync(resolved.absPath);
  const mime = MIME[extname(resolved.absPath).toLowerCase()] ?? "application/octet-stream";

  // 新-2/新-4：扩展脚本/资源在浏览器侧以可信 ES module 动态 import 执行，
  // 加 X-Content-Type-Options: nosniff 防止 MIME 嗅探，并用 CSP 收紧执行能力
  // （禁内联脚本/连接外域），降低不可信扩展的沙箱逃逸面。
  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'",
    },
  });
}
