import { NextRequest, NextResponse } from "next/server";
import { SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

async function createManager(): Promise<SettingsManager> {
  const agentDir = getAgentDir();
  const mgr = SettingsManager.create(process.cwd(), agentDir);
  await mgr.reload();
  return mgr;
}

// GET /api/settings — return all configurable pi settings for the settings panel.
export async function GET() {
  try {
    const mgr = await createManager();

    const settings = {
      // Model defaults
      defaultProvider: mgr.getDefaultProvider() ?? null,
      defaultModel: mgr.getDefaultModel() ?? null,
      defaultThinkingLevel: mgr.getDefaultThinkingLevel() ?? "auto",
      enabledModels: mgr.getEnabledModels() ?? null,

      // Agent behavior
      compactionEnabled: mgr.getCompactionEnabled(),
      retryEnabled: mgr.getRetryEnabled(),
      steeringMode: mgr.getSteeringMode(),
      followUpMode: mgr.getFollowUpMode(),

      // Network
      transport: mgr.getTransport(),
      httpIdleTimeoutMs: mgr.getHttpIdleTimeoutMs(),

      // Shell
      shellPath: mgr.getShellPath() ?? "",
      shellCommandPrefix: mgr.getShellCommandPrefix() ?? "",
      npmCommand: mgr.getNpmCommand() ?? null,

      // Trust
      defaultProjectTrust: mgr.getDefaultProjectTrust(),

      // Display
      hideThinkingBlock: mgr.getHideThinkingBlock(),
      quietStartup: mgr.getQuietStartup(),
    };

    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/settings — update one or more settings fields.
// Body: partial SettingsPayload — only provided fields are written.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const mgr = await createManager();

    // Model defaults — handle batch save (both provider + model together)
    if (body.__batch !== undefined) {
      const batch = body.__batch as Record<string, unknown>;
      if (batch.defaultProvider !== undefined && batch.defaultModel !== undefined) {
        const p = batch.defaultProvider as string | null;
        const m = batch.defaultModel as string | null;
        if (p && m) mgr.setDefaultModelAndProvider(p, m);
      }
    }

    // Model defaults
    if (body.defaultProvider !== undefined && body.defaultModel !== undefined) {
      mgr.setDefaultModelAndProvider(body.defaultProvider as string, body.defaultModel as string);
    } else if (body.defaultProvider !== undefined) {
      mgr.setDefaultProvider(body.defaultProvider as string);
    } else if (body.defaultModel !== undefined) {
      mgr.setDefaultModel(body.defaultModel as string);
    }
    if (body.defaultThinkingLevel !== undefined) {
      mgr.setDefaultThinkingLevel(body.defaultThinkingLevel as "off"|"minimal"|"low"|"medium"|"high"|"xhigh");
    }
    if (body.enabledModels !== undefined) {
      mgr.setEnabledModels(body.enabledModels as string[] | undefined);
    }

    // Agent behavior
    if (body.compactionEnabled !== undefined) mgr.setCompactionEnabled(body.compactionEnabled as boolean);
    if (body.retryEnabled !== undefined) mgr.setRetryEnabled(body.retryEnabled as boolean);
    if (body.steeringMode !== undefined) mgr.setSteeringMode(body.steeringMode as "all"|"one-at-a-time");
    if (body.followUpMode !== undefined) mgr.setFollowUpMode(body.followUpMode as "all"|"one-at-a-time");

    // Network
    if (body.transport !== undefined) mgr.setTransport(body.transport as "sse"|"websocket"|"websocket-cached"|"auto");
    if (body.httpIdleTimeoutMs !== undefined) mgr.setHttpIdleTimeoutMs(body.httpIdleTimeoutMs as number);

    // Shell
    if (body.shellPath !== undefined) mgr.setShellPath((body.shellPath as string) || undefined);
    if (body.shellCommandPrefix !== undefined) mgr.setShellCommandPrefix((body.shellCommandPrefix as string) || undefined);
    if (body.npmCommand !== undefined) mgr.setNpmCommand(body.npmCommand as string[] | undefined);

    // Trust
    if (body.defaultProjectTrust !== undefined) {
      mgr.setDefaultProjectTrust(body.defaultProjectTrust as "ask"|"always"|"never");
    }

    // Display
    if (body.hideThinkingBlock !== undefined) mgr.setHideThinkingBlock(body.hideThinkingBlock as boolean);
    if (body.quietStartup !== undefined) mgr.setQuietStartup(body.quietStartup as boolean);

    await mgr.flush();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
