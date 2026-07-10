/**
 * react-syntax-highlighter merges each theme's
 * `pre[class*="language-"]` style with the `customStyle` we pass in,
 * into a single inline `style` object on the rendered `<pre>` element.
 *
 * Some themes (e.g. `vsc-dark-plus`) set `background` (shorthand) there,
 * while we typically set `backgroundColor` (longhand) in `customStyle`.
 * When both end up in the same style object React warns that mixing
 * shorthand and longhand for the same value is unsafe — both end up
 * applied to the element on every rerender.
 *
 * Fix: for the `pre[class*="language-"]` selector, promote a plain-color
 * `background` shorthand to `backgroundColor` longhand so the consumer's
 * `backgroundColor` override lands on a single property. Non-color
 * backgrounds (gradients, images, …) are left untouched so we don't
 * silently drop visual styling.
 */
export function sanitizeSyntaxHighlighterTheme<T>(theme: T): T {
  if (!theme || typeof theme !== "object") return theme;
  const result: Record<string, unknown> = {};
  const source = theme as unknown as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    const style = source[key];
    if (!style || typeof style !== "object") {
      result[key] = style;
      continue;
    }
    if (key === 'pre[class*="language-"]' && "background" in style) {
      const value = (style as Record<string, unknown>).background;
      if (typeof value === "string" && !isNonColorBackground(value)) {
        const rest = { ...(style as Record<string, unknown>) };
        delete rest.background;
        result[key] = { ...rest, backgroundColor: value };
        continue;
      }
    }
    result[key] = style;
  }
  return result as unknown as T;
}

function isNonColorBackground(value: string): boolean {
  // `background` shorthand can hold gradients, images, position/repeat
  // tokens, etc. Anything other than a plain color value is not safely
  // promotable to `backgroundColor` without changing the rendered look.
  return /gradient|url\(/i.test(value);
}