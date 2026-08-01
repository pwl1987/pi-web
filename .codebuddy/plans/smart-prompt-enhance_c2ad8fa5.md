---
name: smart-prompt-enhance
overview: 在聊天输入区新增「智能增强提示词」按钮：点击后用当前会话所选模型（completeSimple）对输入框原始提示词做语义分析与优化，按钮显示加载态并防重复点击，增强后自动回写输入框替换原文，并提供「撤销」还原原始提示词。
todos:
  - id: create-prompt-enhancer-helper
    content: 新增 lib/prompt-enhance.ts 系统提示词纯函数及 node 单测
    status: completed
  - id: create-enhance-endpoint
    content: 新增 app/api/agent/enhance/route.ts 端点，复用 completeSimple 与鉴权链路
    status: completed
    dependencies:
      - create-prompt-enhancer-helper
  - id: add-i18n-keys
    content: 在 lib/i18n/en.ts 与 zh.ts 新增增强相关翻译键
    status: completed
  - id: wire-chatinput-enhance
    content: 在 ChatInput 工具栏加增强按钮，实现 loading/防重/回写/撤销逻辑
    status: completed
    dependencies:
      - create-enhance-endpoint
      - add-i18n-keys
  - id: verify-build
    content: 运行 lint、tsc 类型检查与测试验证改动
    status: completed
    dependencies:
      - wire-chatinput-enhance
---

## 用户需求

在聊天输入区域附近新增一个「智能增强提示词」按钮，对用户输入的原始提示词进行后台 LLM 语义优化并回写。

## 产品概述

点击按钮后，系统提取当前输入框内的原始提示词，调用当前会话所选模型进行语义分析与改写，补全缺失的上下文、明确输出约束与格式要求，将优化结果自动替换回输入框，并提供一键撤回还原原文的能力。

## 核心功能

- 在输入区工具栏（附件按钮之后）新增与现有风格一致的「智能增强」幽灵按钮，流式进行中、空内容或处理中时禁用，不干扰发送等核心操作。
- 点击后提取 `value` 中的原始提示词，POST 到新增服务端端点，由 LLM 在后台完成语义增强。
- 处理期间按钮显示「增强中…」加载态并阻止重复点击。
- 增强成功后自动将优化文本写回输入框替换原文，用户可直接发送。
- 增强完成后短暂显示「撤销」按钮，点击可还原到增强前的原始提示词；用户再次编辑或发送后撤回提示自动消失。
- 失败时显示简明的错误提示，保留原文不覆盖。

## 技术栈

- 框架：Next.js 16 App Router、React 19、TypeScript（strict）
- 复用既有能力：`completeSimple`（@earendil-works/pi-ai/compat）、`ModelRegistry`/`AuthStorage`/`SettingsManager`/`getAgentDir`（@earendil-works/pi-coding-agent）、`validateCsrf`（@/lib/csrf）、`getAssistantText`（@/lib/api-shared）、客户端 `csrfHeaders`（@/lib/csrf-client）
- 不引入任何新依赖

## 实现方案

### 总体策略

复刻 `app/api/agents-md/optimize/route.ts` 的「读取模型 → 解析 API Key → completeSimple → getAssistantText」范式，新增一个独立的无状态端点 `app/api/agent/enhance`，专门做提示词增强；前端在 `ChatInput` 内增加局部状态与处理函数，复用 `value`/`setValue` 完成回写与撤回。

### 服务端端点（`app/api/agent/enhance/route.ts`）

- 仅允许 `POST`，首行 `validateCsrf(req)`（与 optimize 完全一致）。
- 请求体：`{ prompt: string, provider?: string, modelId?: string, cwd?: string }`。空 `prompt` 返回 400。
- 模型解析优先级：若传入 `provider`+`modelId` 则 `registry.find(provider, modelId)`（即当前会话所选模型）；否则 `SettingsManager` 回退默认模型。二者皆无则 400 返回可读错误（与 optimize 一致）。
- `registry.getApiKeyAndHeaders(model)` 解析鉴权；缺失则 400。
- 系统提示词由纯函数 `buildEnhanceSystemPrompt()` 生成（见 `lib/prompt-enhance.ts`），要求模型以「提示词工程师」身份补全缺失背景/意图、设定明确输出约束（格式、长度、语气、结构）与格式要求，且仅返回增强后的提示词本身（不带解释与代码围栏），保留用户原语言与既有硬性要求。
- 调用 `completeSimple(model, {messages:[{role:"user",content:prompt,timestamp:Date.now()}]}, {apiKey, headers, maxTokens:4096, timeoutMs:60000, maxRetries:0, systemPrompt})`。空返回按 500 处理。
- 成功返回 `{ enhanced: string }`。

### 前端（`components/ChatInput.tsx`）

- 新增局部状态：`enhancing: boolean`、`enhanceError: string`、`showUndo: boolean`、`originalBeforeEnhance: string`。
- `handleEnhance`：`enhancing` 或 `!value.trim()` 时直接返回（防重复点击/空内容）；保存 `originalBeforeEnhance = value`；`fetch("/api/agent/enhance", {method:"POST", headers: csrfHeaders({...}), body: JSON.stringify({prompt:value, provider:model?.provider, modelId:model?.modelId})})`；成功则 `setValue(d.enhanced)` 并 `setShowUndo(true)`；失败设置 `enhanceError`；finally 关闭 `enhancing`。
- `setValue` 后不触发 `onChange`（沿用现有注释约定的「setValue 不触发 onChange」写法），故 `showUndo` 不会因回写而误清。
- 在 `onChange`（textarea）中：若 `showUndo` 为真，说明用户已开始自行编辑，立即 `setShowUndo(false)`。
- 按钮放置：在 LEFT 工具栏组（附件按钮之后，模型选择器之前）新增幽灵风格按钮，风格对齐附件按钮（`width:32 / color:var(--text-muted) / hover:var(--bg-hover)`），带 SVG 图标 + 文案；`disabled = isStreaming || enhancing || !value.trim()`。
- 加载态：显示「增强中…」并禁用；`showUndo` 为真时将该按钮替换为「撤销」幽灵按钮，点击 `setValue(originalBeforeEnhance); setShowUndo(false)`。
- 错误：渲染一行 `enhanceError` 小字提示（使用错误色），出现错误不覆盖原文。

### 关键决策与权衡

- 复用 optimize 的 CSRF + 鉴权 + completeSimple 链路，零新依赖、零新架构，风险最低。
- 模型优先用当前会话所选模型（用户已确认），缺失回退默认，保证「所见即所用」。
- 纯函数 `buildEnhanceSystemPrompt` 抽离到 `lib/prompt-enhance.ts`，便于 node:test 单测，符合 `lib/api-shared.ts` 既有「抽出纯函数」实践。
- 端点位于 `app/api/**`，SDK 导入合规；不触碰客户端 bundle。

## 实现注意事项

- SDK 导入仅出现在 `app/api/agent/enhance/route.ts`，严禁在 `components/` 或 `hooks/` 引入 `@earendil-works/*`。
- 按钮 `disabled` 必须包含 `enhancing`，从 UI 与请求两个层面双重防重复点击。
- 错误响应仅透出用户可读信息，不泄露 API Key。
- 仅新增按钮与状态，不改动 `handleSend`/fork/SSE/分支等既有逻辑，向后兼容。
- 遵循现有 i18n 规范：新增键同时写入 `lib/i18n/en.ts` 与 `lib/i18n/zh.ts`。

## 架构设计

无新增架构模式，沿用既有「客户端 fetch + csrfHeaders → 服务端路由（validateCsrf → 模型/鉴权 → completeSimple）→ getAssistantText」单向数据流，与 `agents-md/optimize` 完全同构。

## 目录结构与文件清单

```
pi-web/
├── app/api/agent/enhance/
│   └── route.ts              # [NEW] POST 端点。校验 CSRF，解析当前会话模型（回退默认），completeSimple 增强，返回 { enhanced }。复用 validateCsrf/getAssistantText/ModelRegistry。
├── lib/
│   ├── prompt-enhance.ts     # [NEW] 纯函数 buildEnhanceSystemPrompt()，生成增强系统提示词，便于单测。
│   └── prompt-enhance.test.mjs # [NEW] node:test 校验系统提示词包含关键约束指令且不依赖网络。
├── components/
│   └── ChatInput.tsx         # [MODIFY] 在 LEFT 工具栏新增「智能增强」幽灵按钮 + loading/undo/error 状态，实现 handleEnhance 与撤销逻辑，复用 value/setValue/isStreaming/model。
└── lib/i18n/
    ├── en.ts                 # [MODIFY] 新增 input.enhance / input.enhancing / input.enhanceUndo / input.enhanceError 键。
    └── zh.ts                 # [MODIFY] 同上对应中文键。
```

## 关键代码结构

```ts
// app/api/agent/enhance/route.ts
export async function POST(req: NextRequest): Promise<NextResponse>;
// 请求体
type EnhanceRequest = { prompt?: string; provider?: string; modelId?: string; cwd?: string };
// 响应体
type EnhanceResponse = { enhanced: string } | { error: string };

// lib/prompt-enhance.ts
export function buildEnhanceSystemPrompt(): string;

// components/ChatInput.tsx 新增局部状态与回调（示意）
const [enhancing, setEnhancing] = useState(false);
const [enhanceError, setEnhanceError] = useState("");
const [showUndo, setShowUndo] = useState(false);
const [originalBeforeEnhance, setOriginalBeforeEnhance] = useState("");
const handleEnhance: () => Promise<void>;
```
