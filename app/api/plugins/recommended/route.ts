import { NextResponse } from "next/server";
import { ALL_PLUGINS } from "@/lib/recommended-plugins";
import { getConfiguredPackages, getAutoInstallStatus } from "@/lib/plugin-auto-install";
import { errorResponse } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

// GET /api/plugins/recommended — return recommended plugins with install status.
export async function GET() {
  try {
    const configured = getConfiguredPackages();
    const autoResults = getAutoInstallStatus();
    const autoMap = new Map((autoResults ?? []).map((r) => [r.source, r]));

    const plugins = ALL_PLUGINS.map((p) => {
      const isInstalled = configured.has(p.source);
      const auto = autoMap.get(p.source);
      return {
        source: p.source,
        name: p.name,
        description: p.description,
        tier: p.tier,
        complements: p.complements ?? [],
        installed: isInstalled,
        autoStatus: auto?.status ?? (isInstalled ? "already" : "pending"),
        autoError: auto?.error,
      };
    });

    return NextResponse.json({ plugins });
  } catch (error) {
    return errorResponse(error);
  }
}
