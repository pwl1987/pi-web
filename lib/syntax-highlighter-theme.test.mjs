import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./syntax-highlighter-theme.ts");
}

test("promotes plain-color background shorthand to backgroundColor in pre style", async () => {
  const { sanitizeSyntaxHighlighterTheme } = await loadSubject();
  const theme = {
    'pre[class*="language-"]': {
      color: "#d4d4d4",
      padding: "1em",
      background: "#1e1e1e",
    },
  };
  const result = sanitizeSyntaxHighlighterTheme(theme);
  assert.deepEqual(result['pre[class*="language-"]'], {
    color: "#d4d4d4",
    padding: "1em",
    backgroundColor: "#1e1e1e",
  });
  // Source object must not be mutated
  assert.deepEqual(theme['pre[class*="language-"]'], {
    color: "#d4d4d4",
    padding: "1em",
    background: "#1e1e1e",
  });
});

test("preserves gradient / image backgrounds (non-color values)", async () => {
  const { sanitizeSyntaxHighlighterTheme } = await loadSubject();
  const gradientTheme = {
    'pre[class*="language-"]': {
      background: "linear-gradient(to right, red, blue)",
    },
  };
  assert.deepEqual(
    sanitizeSyntaxHighlighterTheme(gradientTheme),
    gradientTheme,
  );

  const urlTheme = {
    'pre[class*="language-"]': {
      background: "url('foo.png') repeat",
    },
  };
  assert.deepEqual(sanitizeSyntaxHighlighterTheme(urlTheme), urlTheme);
});

test("leaves non-pre selectors untouched even if they use background", async () => {
  const { sanitizeSyntaxHighlighterTheme } = await loadSubject();
  const theme = {
    'pre[class*="language-"]': { background: "#fff" },
    comment: { background: "yellow" },
    'pre[class*="language-"]::selection': { background: "#C1DEF1" },
  };
  const result = sanitizeSyntaxHighlighterTheme(theme);
  assert.equal(result['pre[class*="language-"]'].backgroundColor, "#fff");
  assert.ok(!("background" in result['pre[class*="language-"]']));
  // Other selectors keep their background shorthand verbatim
  assert.deepEqual(result.comment, { background: "yellow" });
  assert.deepEqual(result['pre[class*="language-"]::selection'], {
    background: "#C1DEF1",
  });
});

test("is a no-op when pre style has no background shorthand", async () => {
  const { sanitizeSyntaxHighlighterTheme } = await loadSubject();
  const theme = {
    'pre[class*="language-"]': {
      color: "#393A34",
      backgroundColor: "white",
    },
  };
  const result = sanitizeSyntaxHighlighterTheme(theme);
  assert.deepEqual(result, theme);
  // And the input reference must be preserved (no extra clones when nothing changed)
  assert.equal(result['pre[class*="language-"]'], theme['pre[class*="language-"]']);
});

test("preserves other CSS properties on the pre style", async () => {
  const { sanitizeSyntaxHighlighterTheme } = await loadSubject();
  const theme = {
    'pre[class*="language-"]': {
      color: "#d4d4d4",
      fontSize: "13px",
      padding: "1em",
      margin: ".5em 0",
      overflow: "auto",
      background: "#1e1e1e",
    },
  };
  const result = sanitizeSyntaxHighlighterTheme(theme);
  const pre = result['pre[class*="language-"]'];
  assert.equal(pre.color, "#d4d4d4");
  assert.equal(pre.fontSize, "13px");
  assert.equal(pre.padding, "1em");
  assert.equal(pre.margin, ".5em 0");
  assert.equal(pre.overflow, "auto");
  assert.equal(pre.backgroundColor, "#1e1e1e");
  assert.ok(!("background" in pre));
});

test("handles malformed input (non-object style) without crashing", async () => {
  const { sanitizeSyntaxHighlighterTheme } = await loadSubject();
  const theme = {
    'pre[class*="language-"]': null,
    'code[class*="language-"]': "not-an-object",
  };
  const result = sanitizeSyntaxHighlighterTheme(theme);
  assert.equal(result['pre[class*="language-"]'], null);
  assert.equal(result['code[class*="language-"]'], "not-an-object");
});