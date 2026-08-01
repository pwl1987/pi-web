import { NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { safeJsonBody } from "@/lib/api-utils";
import { provisionCapability } from "@/lib/mcp-env";
import type { CapabilityEnv } from "@/lib/env-types";

export const dynamic = "force-dynamic";

// POST /api/mcp-config/env/setup
// Unified environment detection + provisioning for any MCP server or pi plugin.
// The body is a CapabilityEnv descriptor; the pipeline detects the required
// base runtime, validates compatibility, fetches/installs the capability's own
// dependency, and runs capability-specific init. Returns a ProvisionResult.
export async function POST(req: Request) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const [body, parseError] = await safeJsonBody<CapabilityEnv>(req);
  if (parseError) return parseError;

  if (!body || (body.kind !== "mcp" && body.kind !== "plugin")) {
    return NextResponse.json({ error: "kind must be 'mcp' or 'plugin'" }, { status: 400 });
  }

  try {
    const result = await provisionCapability(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        steps: [
          {
            key: "raw",
            status: "error",
            detail: error instanceof Error ? error.message : String(error),
          },
        ],
      },
      { status: 200 },
    );
  }
}
