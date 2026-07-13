import { type NextRequest, NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { getAssistantText } from "@/lib/api-shared";
import { getPiAdapter } from "@/lib/pi";
import { errorResponse } from "@/lib/api-utils";

const { AuthStorage, ModelRegistry, SettingsManager, getAgentDir, completeSimple } = getPiAdapter();

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 60_000;

// POST /api/agents-md/optimize
// body: { content: string, file?: "agents"|"system"|"append", cwd?: string, instruction?: string }
// → { optimized: string }
export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const body = (await req.json()) as {
      content?: string;
      file?: string;
      cwd?: string;
      instruction?: string;
    };
    const content = body.content ?? "";
    const fileType = body.file ?? "agents";
    if (!content.trim()) return errorResponse("Content is empty — nothing to optimize.", 400);

    // Read the user's default model + provider from settings.
    const agentDir = getAgentDir();
    const mgr = SettingsManager.create(body.cwd ?? process.cwd(), agentDir);
    await mgr.reload();
    const defaultProvider = mgr.getDefaultProvider();
    const defaultModel = mgr.getDefaultModel();
    if (!defaultProvider || !defaultModel) {
      return errorResponse("No default model configured. Set one in Settings.", 400);
    }

    // Resolve model + API key from the real models.json (not a temp copy).
    const modelsPath = `${agentDir}/models.json`;
    const registry = ModelRegistry.create(AuthStorage.create(), modelsPath);
    const model = registry.find(defaultProvider, defaultModel);
    if (!model) return errorResponse(`Model not found: ${defaultProvider}/${defaultModel}`, 400);

    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok) return errorResponse(auth.error, 400);
    if (!auth.apiKey) return errorResponse(`No API key for "${defaultProvider}"`, 400);

    const customInstruction = body.instruction?.trim();
    const promptContext =
      fileType === "system"
        ? "This is a SYSTEM.md file that COMPLETELY REPLACES the agent's default system prompt. It should define the agent's core identity, available tools, and operating guidelines."
        : fileType === "append"
          ? "This is an APPEND_SYSTEM.md file that is APPENDED to the system prompt. It should contain supplementary instructions without repeating the base prompt."
          : "This is an AGENTS.md file that provides project-specific instructions and guidelines injected as project context.";
    const systemPrompt = [
      `You are an expert at writing prompt instruction files for AI coding agents. ${promptContext}`,
      "Optimize the following content for clarity, completeness, and structure.",
      "Keep it concise and actionable.",
      "Preserve all important technical details, conventions, and warnings.",
      customInstruction ? `Additional instruction: ${customInstruction}` : "",
      "Respond with ONLY the optimized markdown. No explanation, no code fences around the whole thing.",
    ]
      .filter(Boolean)
      .join("\n");

    const message = await completeSimple(
      model,
      {
        messages: [
          {
            role: "user",
            content: content,
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: 8192,
        timeoutMs: TIMEOUT_MS,
        maxRetries: 0,
        cacheRetention: "none",
        // Inject system prompt via the model's system message capability
        systemPrompt,
      } as Parameters<typeof completeSimple>[2],
    );

    const optimized = getAssistantText(message);
    if (!optimized.trim()) return errorResponse("AI returned empty content.", 500);

    return NextResponse.json({ optimized });
  } catch (error) {
    return errorResponse(error);
  }
}
