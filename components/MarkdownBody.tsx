"use client";

import {
  useEffect,
  useMemo,
  useState,
  memo,
  type ComponentType,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { resolveLocalFileHref } from "@/lib/file-links";
import { markdownRehypePlugins, markdownRemarkPlugins } from "@/lib/markdown";
import { sanitizeSyntaxHighlighterTheme } from "@/lib/syntax-highlighter-theme";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

// react-syntax-highlighter (and its Prism style tables) is large and only
// needed once a fenced code block is actually rendered. Load it lazily inside
// the code-block component so it stays out of the initial client chunk.
export const MarkdownBody = memo(function MarkdownBody({
  children,
  className,
  isStreaming,
  cwd,
  onOpenFile,
}: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);

  // Recreating `components` every render forces ReactMarkdown to re-parse even
  // when the markdown text is identical. Cache it; its only dependencies are
  // the (stable) callbacks/props passed down from the chat tree.
  const components = useMemo(
    () => ({
      code({ className, children, ...props }: { className?: string; children?: ReactNode }) {
        const lang = className?.replace("language-", "").toLowerCase() ?? "";
        const raw = String(children ?? "");
        const isBlock = className?.includes("language-") || raw.includes("\n");
        if (isBlock) {
          if (lang === "mermaid") {
            return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
          }
          return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
        }
        return (
          <code className="markdown-inline-code" {...props}>
            {children}
          </code>
        );
      },
      pre({ children }: { children?: ReactNode }) {
        return <>{children}</>;
      },
      a({ href, children, ...props }: { href?: string; children?: ReactNode }) {
        const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
        const openFile = onOpenFile;
        if (!filePath || !openFile) {
          return (
            <a href={href} {...props}>
              {children}
            </a>
          );
        }

        const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
          if (event.defaultPrevented || event.button !== 0) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          const target = event.currentTarget.getAttribute("target");
          if (target && target !== "_self") return;
          event.preventDefault();
          openFile(filePath);
        };

        return (
          <a href={href} {...props} onClick={handleClick}>
            {children}
          </a>
        );
      },
      table({ children }: { children?: ReactNode }) {
        return (
          <div className="markdown-table-wrap">
            <table>{children}</table>
          </div>
        );
      },
    }),
    [cwd, onOpenFile, isStreaming],
  );

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={components}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
});

function normalizeDisplayMath(markdown: string): string {
  const lineBreak = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: string; size: number } | null = null;

  return lines
    .map((line) => {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        const size = fenceMatch[1].length;
        if (!fence) fence = { marker, size };
        else if (marker === fence.marker && size >= fence.size) fence = null;
        return line;
      }

      if (fence) return line;

      const displayMathMatch = line.match(/^([ \t]{0,3})\$\$(.+)\$\$[ \t]*$/);
      if (!displayMathMatch) return line;

      const math = displayMathMatch[2].trim();
      if (!math) return line;

      return `${displayMathMatch[1]}$$${lineBreak}${math}${lineBreak}${displayMathMatch[1]}$$`;
    })
    .join(lineBreak);
}

function MermaidBlock({ code, isStreaming }: { code: string; isStreaming?: boolean }) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [showPreview, setShowPreview] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [renderedKey, setRenderedKey] = useState("");
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const currentKey = `${isDark ? "dark" : "light"}\n${code}`;

  useEffect(() => {
    if (!showPreview || isStreaming) return;

    let cancelled = false;
    setFailedKey(null);

    const render = async () => {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: isDark ? "dark" : "default",
      });

      const parsed = await mermaid.parse(code, { suppressErrors: true });
      if (!parsed) throw new Error(t("md.invalidMermaidDiagram"));

      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `mermaid-${crypto.randomUUID()}`
          : `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await mermaid.render(id, code);
      if (!cancelled) {
        setSvg(result.svg);
        setRenderedKey(currentKey);
      }
    };

    render().catch(() => {
      if (!cancelled) setFailedKey(currentKey);
    });

    return () => {
      cancelled = true;
    };
  }, [code, currentKey, isDark, isStreaming, showPreview, t]);

  const previewButton = (
    <button
      onClick={() => setShowPreview((v) => !v)}
      disabled={isStreaming}
      title={
        isStreaming
          ? t("md.previewAvailableAfterStreaming")
          : showPreview
            ? t("md.showMermaidSource")
            : t("md.previewMermaidDiagram")
      }
      className={["markdown-code-action", showPreview ? "is-active" : ""].filter(Boolean).join(" ")}
    >
      {showPreview ? t("md.source") : t("md.preview")}
    </button>
  );

  if (!showPreview || isStreaming) {
    return <CodeBlock code={code} lang="mermaid" headerAction={previewButton} />;
  }

  const body =
    failedKey === currentKey ? (
      <div className="mermaid-block mermaid-block-error">{t("md.invalidMermaidDiagram")}</div>
    ) : !svg || renderedKey !== currentKey ? (
      <div
        className="mermaid-block mermaid-block-loading"
        aria-label={t("md.renderingMermaidDiagram")}
      />
    ) : (
      <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: svg }} />
    );

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">mermaid</span>
        {previewButton}
      </div>
      {body}
    </div>
  );
}

const SyntaxHighlighterFallback = memo(function SyntaxHighlighterFallback({
  code,
}: {
  code: string;
}) {
  return (
    <pre
      className="markdown-code-fallback"
      style={{
        margin: 0,
        padding: "11px 13px",
        fontSize: 12.5,
        lineHeight: 1.62,
        fontFamily: "var(--font-mono)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        color: "var(--text)",
        backgroundColor: "color-mix(in srgb, var(--bg) 92%, var(--bg-panel))",
        overflowX: "auto",
      }}
    >
      {code}
    </pre>
  );
});

export const CodeBlock = memo(function CodeBlock({
  code,
  lang,
  headerAction,
}: {
  code: string;
  lang: string;
  headerAction?: ReactNode;
}) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [Highlighter, setHighlighter] = useState<ComponentType<Record<string, unknown>> | null>(
    null,
  );
  const [highlighterStyle, setHighlighterStyle] = useState<Record<string, CSSProperties> | null>(
    null,
  );

  // Lazy-load the heavy syntax highlighter + its Prism style table only when a
  // code block mounts. Keeps these out of the initial client bundle.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("react-syntax-highlighter"),
      import("react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus"),
      import("react-syntax-highlighter/dist/esm/styles/prism/vs"),
    ])
      .then(([mod, darkStyleMod, lightStyleMod]) => {
        if (cancelled) return;
        const rawStyle = isDark ? darkStyleMod : lightStyleMod;
        const style =
          (rawStyle as { default?: Record<string, CSSProperties> }).default ??
          (rawStyle as unknown as Record<string, CSSProperties>);
        setHighlighter(() => mod.Prism as unknown as ComponentType<Record<string, unknown>>);
        setHighlighterStyle(sanitizeSyntaxHighlighterTheme(style));
      })
      .catch(() => {
        /* leave fallback in place if the highlighter fails to load */
      });
    return () => {
      cancelled = true;
    };
  }, [isDark]);

  const copy = () => {
    copyText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{lang || t("md.codeLangFallback")}</span>
        <div className="markdown-code-actions">
          {headerAction}
          <button onClick={copy} className="markdown-code-action">
            {copied ? t("md.copied") : t("md.copy")}
          </button>
        </div>
      </div>
      {Highlighter && highlighterStyle ? (
        <Highlighter
          language={lang || "text"}
          style={highlighterStyle}
          showLineNumbers
          lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal" }}
          customStyle={{
            margin: 0,
            padding: "11px 13px",
            fontSize: 12.5,
            lineHeight: 1.62,
            borderRadius: 0,
            backgroundColor: "color-mix(in srgb, var(--bg) 92%, var(--bg-panel))",
          }}
          codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
        >
          {code}
        </Highlighter>
      ) : (
        <SyntaxHighlighterFallback code={code} />
      )}
    </div>
  );
});
