import { type NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getPiAdapter } from "@/lib/pi";
import { validateCsrf } from "@/lib/csrf";

const { AuthStorage, ModelRegistry, SettingsManager, getAgentDir } = getPiAdapter().codingAgent;
const { completeSimple } = getPiAdapter().aiCompat;
import { getAssistantText } from "@/lib/api-shared";
import {
  buildEnhanceSystemPrompt,
  buildEnhanceUserMessage,
  stripToolCallArtifacts,
} from "@/lib/prompt-enhance";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 60_000;

// Directories / artifacts we skip when listing a project's top level so the
// context we hand the model stays small and focused on source.
const CONTEXT_SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "__pycache__",
  ".turbo",
  ".cache",
  "coverage",
  "target",
  "vendor",
  ".DS_Store",
  ".idea",
  ".vscode",
]);

// Builds a compact, real snapshot of the user's project from cwd so the
// enhanced prompt can be grounded in the actual tech stack / modules / paths.
// Everything is best-effort: any failed read is simply omitted. Returns null
// when nothing useful could be gathered.
async function gatherProjectContext(cwd: string): Promise<string | null> {
  try {
    const parts: string[] = [];
    const base = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
    parts.push(`Project directory: ${cwd}`);
    parts.push(`Project name: ${base}`);

    try {
      const pjRaw = await fs.readFile(path.join(cwd, "package.json"), "utf8");
      const pj = JSON.parse(pjRaw) as {
        name?: string;
        type?: string;
        description?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      const deps = [
        ...Object.keys(pj.dependencies ?? {}),
        ...Object.keys(pj.devDependencies ?? {}),
      ];
      parts.push(`Package: ${pj.name ?? base}${pj.type ? ` (${pj.type})` : ""}`);
      if (pj.description) parts.push(`Description: ${pj.description}`);
      if (deps.length) parts.push(`Dependencies: ${deps.slice(0, 40).join(", ")}`);
      if (pj.scripts && Object.keys(pj.scripts).length) {
        parts.push(`Scripts: ${Object.keys(pj.scripts).join(", ")}`);
      }
    } catch {
      // no package.json — fine, other signals may still exist
    }

    try {
      const readme = await fs.readFile(path.join(cwd, "README.md"), "utf8");
      const head = readme
        .slice(0, 800)
        .replace(/\r/g, "")
        .replace(/\n{2,}/g, "\n")
        .trim();
      if (head) parts.push(`README (excerpt):\n${head}`);
    } catch {
      // no README — fine
    }

    try {
      const entries = await fs.readdir(cwd, { withFileTypes: true });
      const names = entries
        .filter((e) => !CONTEXT_SKIP.has(e.name) && !e.name.startsWith("."))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort();
      if (names.length) parts.push(`Top-level contents: ${names.join(", ")}`);
    } catch {
      // cannot list — fine
    }

    const joined = parts.join("\n");
    return joined.trim() ? joined : null;
  } catch {
    return null;
  }
}

// POST /api/agent/enhance
// body: { prompt: string, provider?: string, modelId?: string, cwd?: string, useContext?: boolean }
// → { enhanced: string } | { error: string }
export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const body = (await req.json()) as {
      prompt?: string;
      provider?: string;
      modelId?: string;
      cwd?: string;
      useContext?: boolean;
    };
    const prompt = body.prompt ?? "";
    if (!prompt.trim()) {
      return NextResponse.json({ error: "Prompt is empty — nothing to enhance." }, { status: 400 });
    }

    const agentDir = getAgentDir();
    const modelsPath = `${agentDir}/models.json`;
    const registry = ModelRegistry.create(AuthStorage.create(), modelsPath);

    // Prefer the model the user selected for the current session; fall back to
    // the default configured model when none was supplied.
    let model: ReturnType<typeof registry.find>;
    if (body.provider && body.modelId) {
      model = registry.find(body.provider, body.modelId);
    }
    if (!model) {
      const mgr = SettingsManager.create(body.cwd ?? process.cwd(), agentDir);
      await mgr.reload();
      const defaultProvider = mgr.getDefaultProvider();
      const defaultModel = mgr.getDefaultModel();
      if (defaultProvider && defaultModel) {
        model = registry.find(defaultProvider, defaultModel);
      }
    }
    if (!model) {
      return NextResponse.json(
        {
          error: "No model available. Select a model or set a default in Settings.",
        },
        { status: 400 },
      );
    }

    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: 400 });
    }
    if (!auth.apiKey) {
      return NextResponse.json({ error: `No API key for "${model.provider}"` }, { status: 400 });
    }

    // When a project working directory is known, ground the enhanced prompt in
    // the real project context (tech stack, modules, paths) so the result is
    // tailored rather than generic boilerplate. Callers may opt out via
    // useContext: false, but ChatInput always passes a cwd, so context-aware
    // enhancement is the default.
    let projectContext: string | undefined;
    if (body.useContext !== false && body.cwd) {
      try {
        const ctx = await gatherProjectContext(body.cwd);
        if (ctx) projectContext = ctx;
      } catch {
        // context is best-effort; proceed without it
      }
    }

    const systemPrompt = buildEnhanceSystemPrompt(projectContext);

    // IMPORTANT: in @earendil-works/pi-ai the system prompt lives on the Context
    // object (2nd arg), NOT on the options object (3rd arg). Putting it in
    // options silently drops it — which is why the model used to ignore every
    // instruction here.
    const message = await completeSimple(
      model,
      {
        systemPrompt,
        messages: [
          {
            role: "user",
            content: buildEnhanceUserMessage(prompt),
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: 4096,
        timeoutMs: TIMEOUT_MS,
        maxRetries: 0,
        cacheRetention: "none",
      } as Parameters<typeof completeSimple>[2],
    );

    const enhanced = stripToolCallArtifacts(getAssistantText(message));
    if (!enhanced.trim()) {
      return NextResponse.json(
        {
          error:
            "The model returned only tool-call protocol instead of a prompt. Try a different model or rephrase.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ enhanced });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
