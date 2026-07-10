import { NextRequest, NextResponse } from "next/server";
import { completeSimple, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import { AuthStorage, ModelRegistry, SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 60_000;

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

// POST /api/agents-md/optimize
// body: { content: string, cwd?: string, instruction?: string }
// → { optimized: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { content?: string; cwd?: string; instruction?: string };
    const content = body.content ?? "";
    if (!content.trim()) {
      return NextResponse.json({ error: "Content is empty — nothing to optimize." }, { status: 400 });
    }

    // Read the user's default model + provider from settings.
    const agentDir = getAgentDir();
    const mgr = SettingsManager.create(body.cwd ?? process.cwd(), agentDir);
    await mgr.reload();
    const defaultProvider = mgr.getDefaultProvider();
    const defaultModel = mgr.getDefaultModel();
    if (!defaultProvider || !defaultModel) {
      return NextResponse.json({ error: "No default model configured. Set one in Settings." }, { status: 400 });
    }

    // Resolve model + API key from the real models.json (not a temp copy).
    const modelsPath = `${agentDir}/models.json`;
    const registry = ModelRegistry.create(AuthStorage.create(), modelsPath);
    const model = registry.find(defaultProvider, defaultModel);
    if (!model) {
      return NextResponse.json({ error: `Model not found: ${defaultProvider}/${defaultModel}` }, { status: 400 });
    }

    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: 400 });
    }
    if (!auth.apiKey) {
      return NextResponse.json({ error: `No API key for "${defaultProvider}"` }, { status: 400 });
    }

    const customInstruction = body.instruction?.trim();
    const systemPrompt = [
      "You are an expert at writing AGENTS.md files for AI coding agents.",
      "Optimize the following AGENTS.md for clarity, completeness, and structure.",
      "Keep it concise and actionable — this file guides an AI agent working in a codebase.",
      "Preserve all important technical details, conventions, and warnings.",
      customInstruction ? `Additional instruction: ${customInstruction}` : "",
      "Respond with ONLY the optimized markdown. No explanation, no code fences around the whole thing.",
    ].filter(Boolean).join("\n");

    const message = await completeSimple(model, {
      messages: [{
        role: "user",
        content: content,
        timestamp: Date.now(),
      }],
    }, {
      apiKey: auth.apiKey,
      headers: auth.headers,
      maxTokens: 8192,
      timeoutMs: TIMEOUT_MS,
      maxRetries: 0,
      cacheRetention: "none",
      // Inject system prompt via the model's system message capability
      systemPrompt,
    } as Parameters<typeof completeSimple>[2]);

    const optimized = getAssistantText(message);
    if (!optimized.trim()) {
      return NextResponse.json({ error: "AI returned empty content." }, { status: 500 });
    }

    return NextResponse.json({ optimized });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
