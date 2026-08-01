import { validateCsrf } from "@/lib/csrf";
import { getPiAdapter } from "@/lib/pi";

const { AuthStorage } = getPiAdapter();

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const { provider } = await params;
  const authStorage = AuthStorage.create();
  const providers = authStorage.getOAuthProviders();
  if (!providers.find((p) => p.id === provider)) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  authStorage.logout(provider);
  return Response.json({ ok: true });
}
