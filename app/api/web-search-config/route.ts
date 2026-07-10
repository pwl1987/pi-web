import { NextResponse } from "next/server";
import { join } from "path";
import { homedir } from "os";
import { readJsonFile, writeJsonFileAtomic, ensureParentDir } from "@/lib/config-file";

export const dynamic = "force-dynamic";

// Provider config keys that store API keys — never returned in GET responses.
const API_KEY_FIELDS = [
  "openaiApiKey", "braveApiKey", "tavilyApiKey", "exaApiKey",
  "perplexityApiKey", "geminiApiKey", "cloudflareApiKey",
] as const;

interface WebSearchConfig {
  provider?: string;
  workflow?: string;
  curatorTimeoutSeconds?: number;
  webSearch?: { enabled?: boolean };
  openaiApiKey?: string;
  braveApiKey?: string;
  tavilyApiKey?: string;
  exaApiKey?: string;
  perplexityApiKey?: string;
  geminiApiKey?: string;
  cloudflareApiKey?: string;
  [key: string]: unknown;
}

function configPath(): string {
  const base = process.env.PI_CODING_AGENT_DIR
    ? join(process.env.PI_CODING_AGENT_DIR, "..")
    : join(homedir(), ".pi");
  return join(base, "web-search.json");
}

// GET /api/web-search-config — read config, masking API keys as booleans.
export async function GET() {
  try {
    const config = readJsonFile<WebSearchConfig>(configPath(), {});

    const providers: Record<string, boolean> = {};
    for (const field of API_KEY_FIELDS) {
      const providerName = field.replace("ApiKey", "");
      providers[providerName] = Boolean(config[field]);
    }
    // Parallel is env-only.
    providers.parallel = Boolean(process.env.PARALLEL_API_KEY);

    return NextResponse.json({
      providers,
      provider: config.provider ?? "auto",
      workflow: config.workflow ?? "none",
      curatorTimeoutSeconds: config.curatorTimeoutSeconds ?? 20,
      webSearchEnabled: config.webSearch?.enabled ?? true,
      configPath: configPath(),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PUT /api/web-search-config — update config. API keys are set only if provided.
export async function PUT(req: Request) {
  try {
    const body = await req.json() as {
      provider?: string;
      workflow?: string;
      curatorTimeoutSeconds?: number;
      webSearchEnabled?: boolean;
      apiKeys?: Record<string, string>;
    };

    const existing = readJsonFile<WebSearchConfig>(configPath(), {});
    const updated: WebSearchConfig = { ...existing };

    if (body.provider !== undefined) updated.provider = body.provider;
    if (body.workflow !== undefined) updated.workflow = body.workflow;
    if (body.curatorTimeoutSeconds !== undefined) updated.curatorTimeoutSeconds = body.curatorTimeoutSeconds;
    if (body.webSearchEnabled !== undefined) {
      updated.webSearch = { ...(updated.webSearch ?? {}), enabled: body.webSearchEnabled };
    }
    if (body.apiKeys) {
      for (const [key, value] of Object.entries(body.apiKeys)) {
        if (API_KEY_FIELDS.includes(key as typeof API_KEY_FIELDS[number])) {
          if (value) (updated as Record<string, unknown>)[key] = value;
          else delete (updated as Record<string, unknown>)[key];
        }
      }
    }

    ensureParentDir(configPath());
    writeJsonFileAtomic(configPath(), updated);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
