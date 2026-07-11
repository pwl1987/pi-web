import { NextResponse } from "next/server";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";
import { validateCsrf } from "@/lib/csrf";
import { getPiAdapter } from "@/lib/pi";

const { AuthStorage, ModelRegistry } = getPiAdapter().codingAgent;

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/api-key/[provider] — returns auth status (never returns the actual key)
export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  const authStorage = AuthStorage.create();
  const registry = ModelRegistry.create(authStorage);
  const status = registry.getProviderAuthStatus(provider);
  const displayName = registry.getProviderDisplayName(provider);
  const models = registry.getAll().filter((m) => m.provider === provider).length;
  return NextResponse.json({
    provider,
    displayName,
    configured: status.configured,
    source: status.source,
    models,
  });
}

// POST /api/auth/api-key/[provider]  body: { apiKey: string }
export async function POST(req: Request, { params }: Params) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const { provider } = await params;
  try {
    const [body, parseError] = await safeJsonBody<{ apiKey?: string }>(req, 16_384);
    if (parseError) return parseError;

    const apiKey = body?.apiKey;
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    // Reject unreasonably long API keys (> 16KB trimmed)
    if (apiKey.trim().length > 16_384) {
      return NextResponse.json({ error: "apiKey too long" }, { status: 400 });
    }
    const authStorage = AuthStorage.create();
    authStorage.set(provider, { type: "api_key", key: apiKey.trim() });
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API key
export async function DELETE(req: Request, { params }: Params) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const { provider } = await params;
  try {
    const authStorage = AuthStorage.create();
    authStorage.remove(provider);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
