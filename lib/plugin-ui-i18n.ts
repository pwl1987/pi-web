/**
 * External localization override for pi-agent plugins that render UIs with
 * English chrome.
 *
 * Per project policy we MUST NOT modify plugin source, and the fix must
 * survive `npm upgrade` of the plugins. So instead of editing the packages we
 * intercept the `extension_ui_request` payloads at the host layer — the single
 * choke point is `useAgentSession`'s `handleExtensionUiRequest` — and translate
 * the known English chrome strings to Chinese.
 *
 * Detection is by emitted-event signature, never by touching plugin files:
 *  - todo overlay        → `method: "setWidget"` with `widgetKey: "rpiv-todos"`
 *  - questionnaire       → `method: "custom"` (the rich TUI the plugin renders)
 *  - sandbox panel       → `method: "custom"` with lines containing "Read blocked"
 *  - permission request  → `method: "confirm"` with title starting "Permission"
 *  - select dialog       → `method: "select"` (plugin config options)
 *  - input dialog        → `method: "input"` (plugin input prompts)
 *  - editor dialog       → `method: "editor"` (plugin text editors)
 *  - render error        → `method: "custom"` with lines containing "Extension custom UI render failed"
 *
 * Translation is scoped to plugin-generated chrome (heading, buttons, hints) so
 * it never rewrites user-authored text. Applying the map to already-Chinese
 * text is a no-op, so it is idempotent and safe to run on every event.
 */

import type { ExtensionUiRequest } from "./types";

// --- Common chrome strings (shared across multiple plugins) ------------------
const COMMON_TRANSLATIONS: Readonly<Record<string, string>> = {
  Cancel: "取消",
  Canceled: "已取消",
  OK: "确定",
  Submit: "提交",
  Save: "保存",
  Yes: "是",
  No: "否",
  None: "无",
  Default: "默认",
  Enabled: "已启用",
  Disabled: "已禁用",
  Settings: "设置",
  Options: "选项",
  Configuration: "配置",
  Configure: "配置",
  Select: "选择",
  Required: "必填",
  Optional: "可选",
  Help: "帮助",
  Info: "信息",
  Warning: "警告",
  Error: "错误",
  Success: "成功",
  Failure: "失败",
  Timeout: "超时",
  Expired: "已过期",
  Confirm: "确认",
  Allow: "允许",
  Deny: "拒绝",
  Permissions: "权限",
  Access: "访问",
  Read: "读取",
  Write: "写入",
  Execute: "执行",
  Session: "会话",
  Permanent: "永久",
  Temporary: "临时",
  Project: "项目",
  Global: "全局",
  All: "全部",
  This: "此",
  For: "为",
  Only: "仅",
  Enter: "输入",
  Edit: "编辑",
  Mode: "模式",
  Key: "键",
  Changes: "更改",
  Your: "你的",
  API: "API",
};

function applyCommonTranslations(text: string): string {
  let out = text;
  for (const [en, zh] of Object.entries(COMMON_TRANSLATIONS)) {
    if (out.includes(en)) out = out.split(en).join(zh);
  }
  return out;
}

// --- pi-landstrip sandbox panel chrome --------------------------------------
const SANDBOX_TRANSLATIONS: Readonly<Record<string, string>> = {
  "Read blocked:": "读取被阻止：",
  "[s] Allow for this session only": "[s] 仅允许本次会话",
  "Abort (keep blocked)": "中止（保持阻止）",
  Permanent: "永久",
  "Allow for this project": "允许此项目",
  "Allow for all projects": "允许所有项目",
  navigate: "导航",
  enter: "回车",
  select: "选择",
  dismiss: "关闭",
};

function localizeSandboxLines(lines: string[] | undefined): string[] {
  if (!lines) return [];
  return lines.map((line) => {
    let out = line;
    for (const [en, zh] of Object.entries(SANDBOX_TRANSLATIONS)) {
      if (out.includes(en)) out = out.split(en).join(zh);
    }
    return out;
  });
}

// --- @gotgenes/pi-permission-system chrome -----------------------------------
const PERMISSION_TRANSLATIONS: Readonly<Record<string, string>> = {
  "Permission Required": "需要权限",
  "Allow this read?": "允许此读取操作？",
  Yes: "是",
  "Yes, for this session": "是，仅本次会话",
  No: "否",
  "No, provide reason": "否，请提供原因",
};

function localizePermissionConfirm(request: ExtensionUiRequest): ExtensionUiRequest {
  if (request.method !== "confirm") return request;
  let title = request.title;
  let message = request.message;
  for (const [en, zh] of Object.entries(PERMISSION_TRANSLATIONS)) {
    if (title.includes(en)) title = title.split(en).join(zh);
    if (message.includes(en)) message = message.split(en).join(zh);
  }
  return { ...request, title, message };
}

// --- select / input / editor dialog chrome -----------------------------------
function localizeSelectRequest(request: ExtensionUiRequest): ExtensionUiRequest {
  if (request.method !== "select") return request;
  const title = applyCommonTranslations(request.title);
  const options = request.options.map(applyCommonTranslations);
  return { ...request, title, options };
}

function localizeInputRequest(request: ExtensionUiRequest): ExtensionUiRequest {
  if (request.method !== "input") return request;
  const title = applyCommonTranslations(request.title);
  const placeholder = request.placeholder
    ? applyCommonTranslations(request.placeholder)
    : undefined;
  return { ...request, title, placeholder };
}

function localizeEditorRequest(request: ExtensionUiRequest): ExtensionUiRequest {
  if (request.method !== "editor") return request;
  const title = applyCommonTranslations(request.title);
  return { ...request, title };
}

// --- Custom panel render error chrome ----------------------------------------
const RENDER_ERROR_TRANSLATIONS: Readonly<Record<string, string>> = {
  "Extension custom UI render failed": "扩展自定义 UI 渲染失败",
  "Cannot read properties of undefined": "无法读取未定义的属性",
  "Cannot read properties of null": "无法读取 null 的属性",
  "is not a function": "不是一个函数",
  "Cannot read": "无法读取",
  undefined: "未定义",
};

function localizeRenderErrorLines(lines: string[] | undefined): string[] {
  if (!lines) return [];
  return lines.map((line) => {
    let out = line;
    for (const [en, zh] of Object.entries(RENDER_ERROR_TRANSLATIONS)) {
      if (out.includes(en)) out = out.split(en).join(zh);
    }
    return out;
  });
}

// --- @juicesharp/rpiv-ask-user-question chrome (mirrors locales/zh.json) -----
const ASK_USER_TRANSLATIONS: Readonly<Record<string, string>> = {
  "Type something.": "输入内容",
  "Chat about this": "聊聊这个",
  Next: "下一个",
  "Submit answers": "提交答案",
  Cancel: "取消",
  "Enter to select": "回车选择",
  "↑/↓ to navigate": "↑/↓ 导航",
  "Space to toggle": "空格切换",
  "n to add notes": "按 n 添加备注",
  "Tab to switch questions": "Tab 切换问题",
  "Ctrl+] to collapse": "Ctrl+] 折叠",
  "Ctrl+] to expand · Esc to cancel": "Ctrl+] 展开 · Esc 取消",
  "Esc to cancel": "Esc 取消",
  "Review your answers": "检查你的答案",
  "Ready to submit your answers?": "准备提交答案了吗？",
  "⚠ Answer remaining questions before submitting:": "⚠ 提交前请先回答以下问题：",
  "No preview available": "暂无预览",
  "Notes: press n to add notes": "备注：按 n 添加",
  "User wants to chat about this": "用户想聊聊这个话题",
  "Notes:": "备注：",
  "(Recommended)": "（推荐）",
};

function localizeAskUserLines(lines: string[] | undefined): string[] {
  if (!lines) return [];
  return lines.map((line) => {
    let out = line;
    for (const [en, zh] of Object.entries(ASK_USER_TRANSLATIONS)) {
      // Exact-phrase replace only — user-authored question/option text is left
      // untouched unless it literally contains a plugin sentinel string.
      if (out.includes(en)) out = out.split(en).join(zh);
    }
    return out;
  });
}

// --- @juicesharp/rpiv-todo overlay chrome (mirrors locales/zh.json) ---------
// Scoped to the two structural lines the plugin emits:
//  - the heading line that contains "Todos"
//  - the trailing overflow summary line that starts with "+"
// Task rows (which embed user-authored labels) are never rewritten.
function localizeTodoWidget(lines: string[] | undefined): string[] | undefined {
  if (!lines) return lines;
  return lines.map((line) => {
    if (line.includes("Todos")) return line.replace("Todos", "任务清单");
    if (line.trimStart().startsWith("+")) {
      return line
        .replace(/\bmore\b/g, "更多")
        .replace(/\bcompleted\b/g, "已完成")
        .replace(/\bpending\b/g, "待处理")
        .replace(/\bin progress\b/g, "进行中")
        .replace(/\bdeleted\b/g, "已删除");
    }
    return line;
  });
}

/**
 * Return a Chinese-localized copy of an `extension_ui_request` for supported
 * pi-agent plugins, or the original request unchanged when it does not match
 * any plugin's signature. Pure — never mutates the input.
 */
export function localizeExtensionUiRequest(req: ExtensionUiRequest): ExtensionUiRequest {
  if (req.method === "setWidget" && req.widgetKey === "rpiv-todos") {
    return { ...req, widgetLines: localizeTodoWidget(req.widgetLines) };
  }
  if (req.method === "custom") {
    const lines = req.lines ?? [];
    const isSandbox = lines.some((line) => line.includes("Read blocked"));
    if (isSandbox) {
      return { ...req, lines: localizeSandboxLines(lines) };
    }
    const isRenderError = lines.some((line) => line.includes("Extension custom UI render failed"));
    if (isRenderError) {
      return { ...req, lines: localizeRenderErrorLines(lines) };
    }
    return { ...req, lines: localizeAskUserLines(lines) };
  }
  if (req.method === "confirm") {
    if (req.title?.startsWith("Permission")) {
      return localizePermissionConfirm(req);
    }
    const title = applyCommonTranslations(req.title);
    const message = applyCommonTranslations(req.message);
    return { ...req, title, message };
  }
  if (req.method === "select") {
    return localizeSelectRequest(req);
  }
  if (req.method === "input") {
    return localizeInputRequest(req);
  }
  if (req.method === "editor") {
    return localizeEditorRequest(req);
  }
  return req;
}
