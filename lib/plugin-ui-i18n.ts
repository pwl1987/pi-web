/**
 * External localization override for the `@juicesharp/rpiv-*` plugins.
 *
 * These pi-agent plugins render their interactive UIs — the structured
 * questionnaire (`rpiv-ask-user-question`) and the todo overlay
 * (`rpiv-todo`) — with English chrome by default. Their optional i18n peer
 * (`@juicesharp/rpiv-i18n`) is frequently absent, so the bridge's
 * `t(key, fallback)` returns the inline English literals and the extensions
 * stay online in English.
 *
 * Per project policy we MUST NOT modify plugin source, and the fix must
 * survive `npm upgrade` of the plugins. So instead of editing the packages we
 * intercept the `extension_ui_request` payloads at the host layer — the single
 * choke point is `useAgentSession`'s `handleExtensionUiRequest` — and translate
 * the known English chrome strings to Chinese. The maps mirror each plugin's
 * shipped `locales/zh.json` so the Chinese matches upstream exactly.
 *
 * Detection is by emitted-event signature, never by touching plugin files:
 *  - todo overlay  → `method: "setWidget"` with `widgetKey: "rpiv-todos"`
 *  - questionnaire → `method: "custom"` (the rich TUI the plugin renders)
 *
 * Translation is scoped to plugin-generated chrome (heading, overflow summary,
 * sentinel rows, hints) so it never rewrites user-authored question text or
 * todo task labels. Applying the map to already-Chinese text is a no-op, so it
 * is idempotent and safe to run on every event.
 */

import type { ExtensionUiRequest } from "./types";

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
 * Return a Chinese-localized copy of an `extension_ui_request` for the two
 * rpiv plugins, or the original request unchanged when it does not match
 * either plugin's signature. Pure — never mutates the input.
 */
export function localizeExtensionUiRequest(req: ExtensionUiRequest): ExtensionUiRequest {
  if (req.method === "setWidget" && req.widgetKey === "rpiv-todos") {
    return { ...req, widgetLines: localizeTodoWidget(req.widgetLines) };
  }
  if (req.method === "custom") {
    return { ...req, lines: localizeAskUserLines(req.lines) };
  }
  return req;
}
