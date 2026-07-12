import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody, jsonOk } from "@/lib/api-utils";
import { validateModelsConfig } from "@/lib/config-validators";
import { getPiAdapter } from "@/lib/pi";

const { getAgentDir } = getPiAdapter();

export const dynamic = "force-dynamic";

function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

function readModelsJson(): Record<string, unknown> {
  const path = getModelsPath();
  if (!existsSync(path)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return { providers: {} };
  }
}

function writeModelsJson(data: Record<string, unknown>): void {
  const path = getModelsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

export async function GET() {
  return jsonOk(readModelsJson());
}

export async function PUT(req: Request) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const [body, parseError] = await safeJsonBody<Record<string, unknown>>(req);
    if (parseError) return parseError;
    const validationError = validateModelsConfig(body);
    if (validationError) {
      return NextResponse.json(
        { error: validationError.error },
        { status: validationError.status },
      );
    }
    writeModelsJson(body);
    // Model registry refreshes on each /api/models request (no local cache to invalidate)
    return jsonOk({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
