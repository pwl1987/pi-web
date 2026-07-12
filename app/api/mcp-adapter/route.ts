import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getPiAdapter } from "@/lib/pi";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse } from "@/lib/api-utils";

const { DefaultPackageManager, getAgentDir, SettingsManager } = getPiAdapter();

export const dynamic = "force-dynamic";

// The plugin that powers the MCP gateway. Without it the MCP panel's servers
// cannot be used by the agent, so the panel surfaces an install affordance.
const ADAPTER_SOURCE = "npm:pi-mcp-adapter";

type AdapterStatus = {
  source: string;
  installed: boolean;
  installedPath?: string;
  version?: string;
  configured?: boolean;
};

function readVersion(installedPath?: string): string | undefined {
  if (!installedPath || !existsSync(installedPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(join(installedPath, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function buildManager(cwd: string) {
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  return { packageManager };
}

async function getStatus(cwd: string): Promise<AdapterStatus> {
  const { packageManager } = buildManager(cwd);
  const installedPath =
    packageManager.getInstalledPath(ADAPTER_SOURCE, "user") ??
    packageManager.getInstalledPath(ADAPTER_SOURCE, "project");
  const configured = packageManager
    .listConfiguredPackages()
    .some((p) => p.source === ADAPTER_SOURCE);
  return {
    source: ADAPTER_SOURCE,
    installed: !!installedPath,
    installedPath,
    version: readVersion(installedPath),
    configured,
  };
}

// GET /api/mcp-adapter?cwd=... -> { installed, installedPath, version, configured }
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  try {
    return NextResponse.json(await getStatus(cwd));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/mcp-adapter { action: "install", cwd, scope? } -> AdapterStatus
export async function POST(req: Request) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const body = (await req.json()) as { action?: string; cwd?: string; scope?: string };
    if (!body.cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (body.action !== "install") {
      return NextResponse.json({ error: `Unsupported action: ${body.action}` }, { status: 400 });
    }
    const { packageManager } = buildManager(body.cwd);
    const local = body.scope === "project";
    await packageManager.installAndPersist(ADAPTER_SOURCE, { local });
    return NextResponse.json(await getStatus(body.cwd));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
