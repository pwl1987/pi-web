import { type NextRequest, NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { getAssistantText } from "@/lib/api-shared";
import { getPiAdapter } from "@/lib/pi";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";

const { completeSimple } = getPiAdapter();
import { resolveDefaultModelCredentials } from "@/lib/pi-model-creds";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 60_000;

// POST /api/agents-md/optimize
// body: { content: string, file?: "agents"|"system"|"append", cwd?: string, instruction?: string }
// → { optimized: string }
export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const [body, parseError] = await safeJsonBody<{
      content?: string;
      file?: string;
      cwd?: string;
      instruction?: string;
    }>(req);
    if (parseError) return parseError;
    const content = body.content ?? "";
    const fileType = body.file ?? "agents";
    if (!content.trim()) return errorResponse("Content is empty — nothing to optimize.", 400);

    // 解析默认 provider/model + apiKey/headers（与压缩/选择共用的凭证解析）。
    const creds = await resolveDefaultModelCredentials(body.cwd ?? process.cwd());
    const { model, apiKey, headers } = creds;

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
      model as Parameters<typeof completeSimple>[0],
      {
        messages: [
          {
            role: "user",
            content: content,
            timestamp: Date.now(),
          },
        ],
      } as Parameters<typeof completeSimple>[1],
      {
        apiKey,
        headers,
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
