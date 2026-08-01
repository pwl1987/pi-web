/**
 * TDD tests for components/MarkdownBody.tsx — P2 性能落地：
 * 相同 markdown 文本只解析一次（模块级渲染缓存），重复渲染命中缓存复用节点。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

// --- Mocks ----------------------------------------------------------------
// 主题/I18n 返回稳定值，避免副作用；useTheme 提供 isDark=false。
vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ isDark: false }),
}));
vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

// 用 spy 包裹 react-markdown 的解析入口，统计真实解析次数。
// react-markdown 默认导出是组件；我们拦截其首次渲染时的 parse 行为较困难，
// 因此改为：在 MarkdownBody 暴露的缓存统计钩子上断言命中。
import { MarkdownBody, __markdownCacheStats } from "./MarkdownBody";

describe("P2: MarkdownBody 渲染缓存", () => {
  beforeEach(() => {
    cleanup();
    // 重置缓存统计（含测试钩子）
    __markdownCacheStats.reset();
  });

  it("相同 markdown 首次渲染记为 miss，再次渲染记为 hit（不重复解析）", () => {
    const md = "# Title\n\nSome **bold** text and a list:\n- a\n- b\n";
    const { unmount } = render(<MarkdownBody>{md}</MarkdownBody>);
    // 首次：miss=1
    expect(__markdownCacheStats.misses).toBe(1);
    expect(__markdownCacheStats.hits).toBe(0);
    unmount();

    // 同样内容第二次：应命中缓存，misses 不变，hits+1
    const { unmount: unmount2 } = render(<MarkdownBody>{md}</MarkdownBody>);
    expect(__markdownCacheStats.misses).toBe(1);
    expect(__markdownCacheStats.hits).toBe(1);
    expect(__markdownCacheStats.size).toBe(1);
    unmount2();
  });

  it("不同 markdown 内容产生独立的缓存条目", () => {
    render(<MarkdownBody>{"alpha"}</MarkdownBody>);
    render(<MarkdownBody>{"beta"}</MarkdownBody>);
    expect(__markdownCacheStats.misses).toBe(2);
    expect(__markdownCacheStats.size).toBe(2);
  });

  it("isStreaming 变化视为不同键（流式态与完成态分开缓存）", () => {
    const md = "streaming content";
    render(<MarkdownBody isStreaming={true}>{md}</MarkdownBody>);
    render(<MarkdownBody isStreaming={false}>{md}</MarkdownBody>);
    expect(__markdownCacheStats.misses).toBe(2);
    expect(__markdownCacheStats.size).toBe(2);
  });

  it("缓存命中时仍正确渲染内容", () => {
    const md = "## Hello\n\nworld";
    const first = render(<MarkdownBody>{md}</MarkdownBody>);
    cleanup();
    const second = render(<MarkdownBody>{md}</MarkdownBody>);
    // 命中缓存，但 DOM 内容一致
    expect(second.container.querySelector("h2")?.textContent).toBe("Hello");
    expect(second.container.textContent).toContain("world");
    first.unmount();
    second.unmount();
  });

  it("外部链接渲染为 target=_blank 且带 rel=noopener noreferrer", () => {
    const { container } = render(<MarkdownBody>{"[example](https://example.com)"}</MarkdownBody>);
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
