import { NextResponse } from "next/server";
import { join } from "path";
import { readJsonFile, writeJsonFileAtomic, ensureParentDir, getAgentDir } from "@/lib/config-file";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";
import { validateMcpServers } from "@/lib/config-validators";

export const dynamic = "force-dynamic";

interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  auth?: string;
  lifecycle?: string;
  idleTimeout?: number;
  requestTimeoutMs?: number;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
  settings?: Record<string, unknown>;
  imports?: unknown[];
}

interface McpCacheEntry {
  tools?: unknown[];
  resources?: unknown[];
}

interface McpCache {
  version?: number;
  servers?: Record<string, McpCacheEntry>;
}

function mcpConfigPath(): string {
  return join(getAgentDir(), "mcp.json");
}

function mcpCachePath(): string {
  return join(getAgentDir(), "mcp-cache.json");
}

// GET /api/mcp-config — read MCP server config + cache metadata.
export async function GET() {
  try {
    const config = readJsonFile<McpConfig>(mcpConfigPath(), { mcpServers: {} });
    const cache = readJsonFile<McpCache>(mcpCachePath(), {});

    const servers = Object.entries(config.mcpServers ?? {}).map(([name, entry]) => ({
      name,
      transport: entry.url ? "url" : "stdio",
      command: entry.command,
      args: entry.args,
      url: entry.url,
      lifecycle: entry.lifecycle ?? "lazy",
      auth: entry.auth ?? false,
      idleTimeout: entry.idleTimeout,
      toolCount: cache.servers?.[name]?.tools?.length ?? 0,
      resourceCount: cache.servers?.[name]?.resources?.length ?? 0,
    }));

    return NextResponse.json({
      servers,
      settings: config.settings ?? {},
      configPath: mcpConfigPath(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/mcp-config — write full config (add/update/remove servers + settings).
// body: { mcpServers: Record<string, McpServerEntry>, settings?: Record<string, unknown> }
export async function PUT(req: Request) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const [body, parseError] = await safeJsonBody<{ mcpServers?: unknown; settings?: unknown }>(
      req,
    );
    if (parseError) return parseError;

    const serversError = validateMcpServers(body.mcpServers);
    if (serversError) {
      return NextResponse.json({ error: serversError.error }, { status: serversError.status });
    }

    // Merge with existing config (preserve imports if present).
    const existing = readJsonFile<McpConfig>(mcpConfigPath(), {});
    const newConfig: McpConfig = {
      ...existing,
      mcpServers: body.mcpServers as Record<string, McpServerEntry>,
    };
    if (body.settings !== undefined) {
      newConfig.settings = body.settings as Record<string, unknown>;
    }

    ensureParentDir(mcpConfigPath());
    writeJsonFileAtomic(mcpConfigPath(), newConfig);

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
