import { NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { safeJsonBody } from "@/lib/api-utils";
import { scanAllEnvironments } from "@/lib/mcp-env";
import type { CapabilityEnv, EnvScanResult } from "@/lib/env-types";

export const dynamic = "force-dynamic";

// POST /api/mcp-config/env/scan
// Comprehensive environment integrity scan across many capabilities (all MCP
// servers + all plugins). The body carries the full CapabilityEnv inventory.
// For each capability the pipeline detects the required runtime, validates
// compatibility, and (when install !== false) fetches/installs its own
// dependency, returning a per-dependency breakdown. The UI renders every item.
export async function POST(req: Request) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const [body, parseError] = await safeJsonBody<{
    capabilities: CapabilityEnv[];
    install?: boolean;
    concurrency?: number;
  }>(req);
  if (parseError) return parseError;

  if (!body || !Array.isArray(body.capabilities)) {
    return NextResponse.json({ error: "capabilities must be an array" }, { status: 400 });
  }

  try {
    const result: EnvScanResult = await scanAllEnvironments(body.capabilities, {
      install: body.install !== false,
      concurrency: typeof body.concurrency === "number" ? body.concurrency : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        items: [
          {
            kind: "mcp",
            id: "scan",
            label: "scan",
            status: "failed",
            ok: false,
            dependencies: [],
            steps: [
              {
                key: "raw",
                status: "error",
                detail: error instanceof Error ? error.message : String(error),
              },
            ],
          },
        ],
      } satisfies EnvScanResult,
      { status: 200 },
    );
  }
}
