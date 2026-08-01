import assert from "node:assert/strict";
import test from "node:test";

// Verifies the prompt-enhance helpers produce a self-contained instruction set
// and correctly strip leaked tool-call protocol, without depending on the
// network or any SDK.

async function loadSubject() {
  return import("./prompt-enhance.ts");
}

test("buildEnhanceSystemPrompt covers intent, context, constraints, and language", async () => {
  const { buildEnhanceSystemPrompt } = await loadSubject();
  const prompt = buildEnhanceSystemPrompt();

  assert.equal(typeof prompt, "string");
  assert.ok(prompt.length > 0, "system prompt must not be empty");

  const lower = prompt.toLowerCase();
  assert.ok(lower.includes("intent"), "should mention clarifying intent");
  assert.ok(lower.includes("context"), "should mention supplying context");
  assert.ok(
    lower.includes("output constraint") || lower.includes("constraint"),
    "should mention output constraints",
  );
  assert.ok(lower.includes("format"), "should mention output format");
  assert.ok(lower.includes("language"), "should preserve the user's language");
  assert.ok(
    lower.includes("only the enhanced prompt") || lower.includes("respond with only"),
    "should instruct to return only the prompt",
  );
});

test("buildEnhanceSystemPrompt forbids tool-call / agent protocol markup", async () => {
  const { buildEnhanceSystemPrompt } = await loadSubject();
  const lower = buildEnhanceSystemPrompt().toLowerCase();
  assert.ok(lower.includes("do not emit any tool calls"));
  assert.ok(lower.includes("tool_call") || lower.includes("tool-call"));
});

test("buildEnhanceSystemPrompt forbids executing/answering the prompt", async () => {
  const { buildEnhanceSystemPrompt } = await loadSubject();
  const lower = buildEnhanceSystemPrompt().toLowerCase();
  assert.ok(lower.includes("do not execute the prompt"));
  assert.ok(lower.includes("do not answer"));
  assert.ok(
    lower.includes("example 1 output") && lower.includes("example 2 output"),
    "should contain context-grounded few-shot examples",
  );
});

test("buildEnhanceSystemPrompt mandates grounding when context is present", async () => {
  const { buildEnhanceSystemPrompt } = await loadSubject();
  const lower = buildEnhanceSystemPrompt("Project name: pi-web").toLowerCase();
  assert.ok(lower.includes("mandatory grounding"), "should state a grounding rule");
  assert.ok(
    lower.includes("do not fall back to a generic template"),
    "should forbid generic-template fallback when context exists",
  );
});

test("buildEnhanceUserMessage wraps the raw prompt in delimiters", async () => {
  const { buildEnhanceUserMessage } = await loadSubject();
  const msg = buildEnhanceUserMessage("充分了解下当前项目");
  assert.ok(msg.includes("<<<RAW_PROMPT"));
  assert.ok(msg.includes("RAW_PROMPT>>>"));
  assert.ok(msg.includes("充分了解下当前项目"));
  assert.ok(msg.toLowerCase().includes("do not answer"));
});

test("buildEnhanceSystemPrompt is deterministic", async () => {
  const { buildEnhanceSystemPrompt } = await loadSubject();
  assert.equal(buildEnhanceSystemPrompt(), buildEnhanceSystemPrompt());
});

test("buildEnhanceSystemPrompt omits project context when none given", async () => {
  const { buildEnhanceSystemPrompt } = await loadSubject();
  assert.ok(!buildEnhanceSystemPrompt().includes("<<<PROJECT_CONTEXT"));
});

test("buildEnhanceSystemPrompt injects real project context when provided", async () => {
  const { buildEnhanceSystemPrompt } = await loadSubject();
  const ctx = "Project name: pi-web\nDependencies: react, next";
  const prompt = buildEnhanceSystemPrompt(ctx);
  assert.ok(prompt.includes("REAL PROJECT CONTEXT"), "should add a grounding section");
  assert.ok(prompt.includes("<<<PROJECT_CONTEXT"), "should delimit the context");
  assert.ok(prompt.includes(ctx), "should embed the raw context verbatim");
  assert.ok(
    prompt.toLowerCase().includes("do not invent"),
    "should forbid inventing modules not in context",
  );
});

test("buildEnhanceSystemPrompt ignores blank/whitespace context", async () => {
  const { buildEnhanceSystemPrompt } = await loadSubject();
  assert.ok(!buildEnhanceSystemPrompt("   ").includes("<<<PROJECT_CONTEXT"));
});

test("stripToolCallArtifacts removes minimax tool-call protocol suffix", async () => {
  const { stripToolCallArtifacts } = await loadSubject();
  const raw = [
    "我来帮你充分了解这个项目。让我先探索一下当前目录结构。",
    "]<]minimax[>[<tool_call><invoke name='run_command'>",
    "<invoke name='command'>pwd && ls -la</invoke></invoke></tool_call>",
  ].join("");
  assert.equal(
    stripToolCallArtifacts(raw),
    "我来帮你充分了解这个项目。让我先探索一下当前目录结构。",
  );
});

test("stripToolCallArtifacts returns empty when only protocol is present", async () => {
  const { stripToolCallArtifacts } = await loadSubject();
  const raw = "<tool_call><invoke name='x'>y</invoke></tool_call>";
  assert.equal(stripToolCallArtifacts(raw), "");
});

test("stripToolCallArtifacts leaves a plain prompt unchanged", async () => {
  const { stripToolCallArtifacts } = await loadSubject();
  const clean = "Please review the following code and list bugs as a bullet list.";
  assert.equal(stripToolCallArtifacts(clean), clean);
});

test("stripToolCallArtifacts handles openai-style blocks", async () => {
  const { stripToolCallArtifacts } = await loadSubject();
  const raw = "Summarize the file.\n<tool_call:6124c78e>\nfunction_call\nfoo";
  assert.equal(stripToolCallArtifacts(raw), "Summarize the file.");
});
