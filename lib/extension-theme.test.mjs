import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./extension-theme.ts");
}

test("returns a Theme instance with the style helpers extensions use", async () => {
  const { createDefaultExtensionTheme } = await loadSubject();
  const theme = createDefaultExtensionTheme();
  assert.equal(typeof theme.bold, "function");
  assert.equal(typeof theme.italic, "function");
  assert.equal(typeof theme.underline, "function");
  assert.equal(typeof theme.inverse, "function");
  assert.equal(typeof theme.strikethrough, "function");
  assert.equal(typeof theme.fg, "function");
  assert.equal(typeof theme.bg, "function");
  assert.equal(typeof theme.getFgAnsi, "function");
  assert.equal(typeof theme.getBgAnsi, "function");
  assert.equal(typeof theme.getColorMode, "function");
  assert.equal(typeof theme.getThinkingBorderColor, "function");
  assert.equal(typeof theme.getBashModeBorderColor, "function");
});

test("style helpers return strings and never crash on plain input", async () => {
  const { createDefaultExtensionTheme } = await loadSubject();
  const theme = createDefaultExtensionTheme();
  assert.equal(typeof theme.bold("hello"), "string");
  assert.equal(typeof theme.italic("hello"), "string");
  assert.equal(typeof theme.underline("hello"), "string");
  // fg/bg wrap in ANSI codes — assert the text is still present
  const fgText = theme.fg("accent", "hello");
  assert.match(fgText, /hello/);
  const bgText = theme.bg("selectedBg", "hello");
  assert.match(bgText, /hello/);
});

test("fg throws a clear error for unknown colors (matches pi's behavior)", async () => {
  const { createDefaultExtensionTheme } = await loadSubject();
  const theme = createDefaultExtensionTheme();
  assert.throws(() => theme.fg("definitely-not-a-color", "x"), /Unknown theme color/);
});

test("every ThemeColor value resolves (no missing-key crash)", async () => {
  const { createDefaultExtensionTheme } = await loadSubject();
  const theme = createDefaultExtensionTheme();
  const colorNames = [
    "accent", "border", "borderAccent", "borderMuted", "success", "error",
    "warning", "muted", "dim", "text", "thinkingText", "userMessageText",
    "customMessageText", "customMessageLabel", "toolTitle", "toolOutput",
    "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock",
    "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
    "toolDiffAdded", "toolDiffRemoved", "toolDiffContext", "syntaxComment",
    "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString",
    "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
    "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium",
    "thinkingHigh", "thinkingXhigh", "bashMode",
  ];
  for (const color of colorNames) {
    assert.doesNotThrow(() => theme.fg(color, "x"), `fg(${color}) should not throw`);
    assert.doesNotThrow(() => theme.getFgAnsi(color), `getFgAnsi(${color}) should not throw`);
  }
});

test("every ThemeBg value resolves (no missing-key crash)", async () => {
  const { createDefaultExtensionTheme } = await loadSubject();
  const theme = createDefaultExtensionTheme();
  const bgNames = ["selectedBg", "userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"];
  for (const color of bgNames) {
    assert.doesNotThrow(() => theme.bg(color, "x"), `bg(${color}) should not throw`);
    assert.doesNotThrow(() => theme.getBgAnsi(color), `getBgAnsi(${color}) should not throw`);
  }
});

test("returns a fresh Theme instance each call", async () => {
  const { createDefaultExtensionTheme } = await loadSubject();
  const a = createDefaultExtensionTheme();
  const b = createDefaultExtensionTheme();
  assert.notEqual(a, b);
});

test("getColorMode reports truecolor", async () => {
  const { createDefaultExtensionTheme } = await loadSubject();
  const theme = createDefaultExtensionTheme();
  assert.equal(theme.getColorMode(), "truecolor");
});

test("getThinkingBorderColor returns a function for each level", async () => {
  const { createDefaultExtensionTheme } = await loadSubject();
  const theme = createDefaultExtensionTheme();
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh"]) {
    const fn = theme.getThinkingBorderColor(level);
    assert.equal(typeof fn, "function");
    assert.equal(typeof fn("hi"), "string");
  }
});

test("getBashModeBorderColor returns a function", async () => {
  const { createDefaultExtensionTheme } = await loadSubject();
  const theme = createDefaultExtensionTheme();
  const fn = theme.getBashModeBorderColor();
  assert.equal(typeof fn, "function");
  assert.equal(typeof fn("hi"), "string");
});