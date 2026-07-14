import { type NextRequest } from "next/server";
import { getPiAdapter } from "@/lib/pi";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, jsonOk, safeJsonBody } from "@/lib/api-utils";
import type { SdkSettingsManager } from "@/lib/pi";

const { SettingsManager, getAgentDir } = getPiAdapter();

export const dynamic = "force-dynamic";

async function createManager(): Promise<SdkSettingsManager> {
  const agentDir = getAgentDir();
  const mgr = SettingsManager.create(process.cwd(), agentDir);
  await mgr.reload();
  return mgr;
}

// GET /api/settings — return all configurable pi settings for the settings panel.
export async function GET() {
  try {
    const mgr = await createManager();
    const compaction = mgr.getCompactionSettings();
    const retry = mgr.getRetrySettings();
    const branch = mgr.getBranchSummarySettings();
    const budgets = mgr.getThinkingBudgets();

    const settings = {
      // Model defaults
      defaultProvider: mgr.getDefaultProvider() ?? null,
      defaultModel: mgr.getDefaultModel() ?? null,
      defaultThinkingLevel: mgr.getDefaultThinkingLevel() ?? "auto",
      enabledModels: mgr.getEnabledModels() ?? null,

      // Agent behavior — compaction
      compactionEnabled: mgr.getCompactionEnabled(),
      compactionReserveTokens: compaction?.reserveTokens ?? null,
      compactionKeepRecentTokens: compaction?.keepRecentTokens ?? null,

      // Agent behavior — retry
      retryEnabled: mgr.getRetryEnabled(),
      retryMaxRetries: retry?.maxRetries ?? null,
      retryBaseDelayMs: retry?.baseDelayMs ?? null,

      // Agent behavior — branch summary
      branchSummaryReserveTokens: branch?.reserveTokens ?? null,
      branchSummarySkipPrompt: branch?.skipPrompt ?? false,

      // Thinking budgets
      thinkingBudgetsMinimal: budgets?.minimal ?? null,
      thinkingBudgetsLow: budgets?.low ?? null,
      thinkingBudgetsMedium: budgets?.medium ?? null,
      thinkingBudgetsHigh: budgets?.high ?? null,

      // Modes
      steeringMode: mgr.getSteeringMode(),
      followUpMode: mgr.getFollowUpMode(),

      // Network
      transport: mgr.getTransport(),
      httpProxy: (mgr as unknown as { getHttpProxy?: () => string }).getHttpProxy?.() ?? "",
      httpIdleTimeoutMs: mgr.getHttpIdleTimeoutMs(),
      websocketConnectTimeoutMs: mgr.getWebSocketConnectTimeoutMs(),

      // Shell
      shellPath: mgr.getShellPath() ?? "",
      shellCommandPrefix: mgr.getShellCommandPrefix() ?? "",
      npmCommand: mgr.getNpmCommand() ?? null,

      // Trust
      defaultProjectTrust: mgr.getDefaultProjectTrust(),
      sessionDir: mgr.getSessionDir() ?? "",
      externalEditor: mgr.getExternalEditorCommand?.() ?? "",

      // Display
      hideThinkingBlock: mgr.getHideThinkingBlock(),
      quietStartup: mgr.getQuietStartup(),
      collapseChangelog: mgr.getCollapseChangelog(),
      showImages: mgr.getShowImages(),
      imageWidthCells: mgr.getImageWidthCells(),
      clearOnShrink: mgr.getClearOnShrink(),
      showTerminalProgress: mgr.getShowTerminalProgress(),
      imageAutoResize: mgr.getImageAutoResize(),
      blockImages: mgr.getBlockImages(),
      editorPaddingX: mgr.getEditorPaddingX(),
      outputPad: mgr.getOutputPad(),
      autocompleteMaxVisible: mgr.getAutocompleteMaxVisible(),
      showHardwareCursor: mgr.getShowHardwareCursor(),
      codeBlockIndent: mgr.getCodeBlockIndent() ?? "  ",
      doubleEscapeAction: mgr.getDoubleEscapeAction(),
      treeFilterMode: mgr.getTreeFilterMode(),

      // Skills/commands
      enableSkillCommands: mgr.getEnableSkillCommands(),

      // Telemetry
      enableInstallTelemetry: mgr.getEnableInstallTelemetry(),
      enableAnalytics: mgr.getEnableAnalytics(),

      // Warnings
      warningsAnthropicExtraUsage: mgr.getWarnings().anthropicExtraUsage ?? false,
    };

    return jsonOk(settings);
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/settings — update one or more settings fields.
export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const [body, parseError] = await safeJsonBody<Record<string, unknown>>(req);
    if (parseError) return parseError;
    const mgr = await createManager();

    // Model defaults
    if (body.__batch !== undefined) {
      const batch = body.__batch as Record<string, unknown>;
      if (batch.defaultProvider !== undefined && batch.defaultModel !== undefined) {
        const p = batch.defaultProvider as string | null;
        const m = batch.defaultModel as string | null;
        if (p && m) mgr.setDefaultModelAndProvider(p, m);
      }
    }
    if (body.defaultProvider !== undefined && body.defaultModel !== undefined) {
      mgr.setDefaultModelAndProvider(body.defaultProvider as string, body.defaultModel as string);
    } else if (body.defaultProvider !== undefined) {
      mgr.setDefaultProvider(body.defaultProvider as string);
    } else if (body.defaultModel !== undefined) {
      mgr.setDefaultModel(body.defaultModel as string);
    }
    if (body.defaultThinkingLevel !== undefined) {
      mgr.setDefaultThinkingLevel(
        body.defaultThinkingLevel as "off" | "minimal" | "low" | "medium" | "high" | "xhigh",
      );
    }
    if (body.enabledModels !== undefined) {
      mgr.setEnabledModels(body.enabledModels as string[] | undefined);
    }

    // Compaction (only enabled has a setter; sub-fields are read-only in SDK)
    if (body.compactionEnabled !== undefined)
      mgr.setCompactionEnabled(body.compactionEnabled as boolean);

    // Retry (only enabled has a setter)
    if (body.retryEnabled !== undefined) mgr.setRetryEnabled(body.retryEnabled as boolean);

    // Modes
    if (body.steeringMode !== undefined)
      mgr.setSteeringMode(body.steeringMode as "all" | "one-at-a-time");
    if (body.followUpMode !== undefined)
      mgr.setFollowUpMode(body.followUpMode as "all" | "one-at-a-time");

    // Network
    if (body.transport !== undefined)
      mgr.setTransport(body.transport as "sse" | "websocket" | "websocket-cached" | "auto");
    if (body.httpIdleTimeoutMs !== undefined)
      mgr.setHttpIdleTimeoutMs(body.httpIdleTimeoutMs as number);

    // Shell
    if (body.shellPath !== undefined) mgr.setShellPath((body.shellPath as string) || undefined);
    if (body.shellCommandPrefix !== undefined)
      mgr.setShellCommandPrefix((body.shellCommandPrefix as string) || undefined);
    if (body.npmCommand !== undefined) mgr.setNpmCommand(body.npmCommand as string[] | undefined);

    // Trust
    if (body.defaultProjectTrust !== undefined)
      mgr.setDefaultProjectTrust(body.defaultProjectTrust as "ask" | "always" | "never");

    // Display
    if (body.hideThinkingBlock !== undefined)
      mgr.setHideThinkingBlock(body.hideThinkingBlock as boolean);
    if (body.quietStartup !== undefined) mgr.setQuietStartup(body.quietStartup as boolean);
    if (body.collapseChangelog !== undefined)
      mgr.setCollapseChangelog?.(body.collapseChangelog as boolean);
    if (body.showImages !== undefined) mgr.setShowImages?.(body.showImages as boolean);
    if (body.imageWidthCells !== undefined)
      mgr.setImageWidthCells?.(body.imageWidthCells as number);
    if (body.clearOnShrink !== undefined) mgr.setClearOnShrink?.(body.clearOnShrink as boolean);
    if (body.showTerminalProgress !== undefined)
      mgr.setShowTerminalProgress?.(body.showTerminalProgress as boolean);
    if (body.imageAutoResize !== undefined)
      mgr.setImageAutoResize?.(body.imageAutoResize as boolean);
    if (body.blockImages !== undefined) mgr.setBlockImages?.(body.blockImages as boolean);
    if (body.editorPaddingX !== undefined) mgr.setEditorPaddingX?.(body.editorPaddingX as number);
    if (body.outputPad !== undefined) mgr.setOutputPad?.(body.outputPad as 0 | 1);
    if (body.autocompleteMaxVisible !== undefined)
      mgr.setAutocompleteMaxVisible?.(body.autocompleteMaxVisible as number);
    if (body.showHardwareCursor !== undefined)
      mgr.setShowHardwareCursor?.(body.showHardwareCursor as boolean);
    if (body.doubleEscapeAction !== undefined)
      mgr.setDoubleEscapeAction?.(body.doubleEscapeAction as "fork" | "tree" | "none");
    if (body.treeFilterMode !== undefined)
      mgr.setTreeFilterMode?.(
        body.treeFilterMode as "default" | "no-tools" | "user-only" | "labeled-only" | "all",
      );
    if (body.enableSkillCommands !== undefined)
      mgr.setEnableSkillCommands?.(body.enableSkillCommands as boolean);

    // Telemetry
    if (body.enableInstallTelemetry !== undefined)
      mgr.setEnableInstallTelemetry?.(body.enableInstallTelemetry as boolean);
    if (body.enableAnalytics !== undefined)
      mgr.setEnableAnalytics?.(body.enableAnalytics as boolean);

    // Warnings
    if (body.warningsAnthropicExtraUsage !== undefined) {
      mgr.setWarnings?.({
        ...(mgr.getWarnings() ?? {}),
        anthropicExtraUsage: body.warningsAnthropicExtraUsage as boolean,
      });
    }

    await mgr.flush();
    return jsonOk({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
