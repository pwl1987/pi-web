// 方案生成与解析模块
// 共识达成后，由方案合成者（synthesizer 角色）产出多个相互独立、各具见解的
// 推荐方案。本模块负责：(1) 构造合成提示的用户消息；(2) 把模型输出稳健解析为
// RecommendationPlan[]（优先 JSON，失败回退启发式分段）。

import type { RecommendationPlan } from "./orchestrator-types.ts";
import { formatTranscript } from "./runner.ts";

let planSeq = 0;
function nextPlanId(): string {
  planSeq += 1;
  return `plan_${Date.now().toString(36)}_${planSeq}`;
}

/** 构造合成者本轮的用户消息（含需求与全部讨论上下文）。 */
export function buildSynthesisUserMessage(
  requirement: string,
  transcript: string,
  planCount: number,
): string {
  return (
    `用户原始需求：\n${requirement}\n\n` +
    `至此达成的讨论共识（来自多角色讨论记录）：\n${transcript}\n\n` +
    `请基于上述共识，产出 ${planCount} 个相互独立、各有鲜明侧重点的推荐方案。` +
    "每个方案需包含：标题、整体描述、优点、缺点/风险、适用场景、置信度。"
  );
}

// 去掉可能的 ```json 代码围栏。
function stripFences(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  return s;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function toStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

/** 从模型原始输出解析出推荐方案列表。 */
export function parseRecommendationPlans(raw: string, planCount: number): RecommendationPlan[] {
  const cleaned = stripFences(raw);
  const plans: RecommendationPlan[] = [];

  try {
    const parsed = JSON.parse(cleaned);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      plans.push({
        id: nextPlanId(),
        title: typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : "未命名方案",
        summary: typeof obj.summary === "string" ? obj.summary.trim() : "",
        pros: toStrArray(obj.pros),
        cons: toStrArray(obj.cons),
        scenarios: toStrArray(obj.scenarios),
        confidence: clamp01(Number(obj.confidence)),
      });
    }
    if (plans.length > 0) return plans;
  } catch {
    // 非 JSON，走启发式回退。
  }

  return heuristicParse(cleaned, planCount);
}

// 启发式回退：按「方案 N / ## 方案 / 数字. 」切分，再从各段抽取优缺点/场景。
function heuristicParse(text: string, planCount: number): RecommendationPlan[] {
  const blocks = text
    .split(/^\s*(?:#{1,3}\s*)?(?:方案\s*\d+|计划\s*\d+|\d+[.、])\s*/m)
    .map((b) => b.trim())
    .filter(Boolean);

  const out: RecommendationPlan[] = [];
  for (const block of blocks.slice(0, Math.max(planCount, blocks.length))) {
    const lines = block.split(/\n+/);
    const title = lines[0].replace(/^[:：-]\s*/, "").slice(0, 80) || "未命名方案";
    const pros: string[] = [];
    const cons: string[] = [];
    const scenarios: string[] = [];
    let summary = "";
    for (const line of lines.slice(1)) {
      const l = line.trim();
      if (/优点|优势|pros/i.test(l)) pros.push(l.replace(/^.*?[:：]/, "").trim());
      else if (/缺点|风险|劣势|cons/i.test(l)) cons.push(l.replace(/^.*?[:：]/, "").trim());
      else if (/场景|适用|scenario/i.test(l)) scenarios.push(l.replace(/^.*?[:：]/, "").trim());
      else if (!l.startsWith("-") && !/^[0-9]+[.、]/.test(l)) summary += l;
    }
    out.push({
      id: nextPlanId(),
      title,
      summary: summary.trim().slice(0, 500),
      pros,
      cons,
      scenarios,
      confidence: 0.6,
    });
  }
  return out;
}

/** 把选中的方案序列化为交给自主编程引擎的变更描述（含需求与共识上下文）。 */
export function planToChangeDescription(
  requirement: string,
  plan: RecommendationPlan,
  transcript: string,
): string {
  return [
    `## 用户需求`,
    requirement,
    ``,
    `## 确认方案：${plan.title}`,
    plan.summary,
    ``,
    `### 优点`,
    ...plan.pros.map((p) => `- ${p}`),
    `### 缺点 / 风险`,
    ...plan.cons.map((c) => `- ${c}`),
    `### 适用场景`,
    ...plan.scenarios.map((s) => `- ${s}`),
    ``,
    `## 讨论共识摘要`,
    formatTranscript([]) && transcript.slice(0, 2000),
  ].join("\n");
}
