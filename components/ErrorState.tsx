"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";

interface ErrorStateProps {
  /** Override the default heading. */
  title?: string;
  /** Short human-readable message shown under the title. */
  message?: string | null;
  /** Rendered inside a collapsible <details> region for verbose error text. */
  details?: ReactNode;
  /** When provided, a retry button is shown wired to this callback. */
  onRetry?: () => void;
  /** Override the retry button label. */
  retryLabel?: string;
  /** Extra class for the outer wrapper. */
  className?: string;
}

/**
 * Reusable structured error state with an optional retry button and a
 * collapsible details region. Replaces raw `String(error)` dumps scattered
 * across chat / sidebar with a consistent, accessible presentation.
 */
export function ErrorState({
  title,
  message,
  details,
  onRetry,
  retryLabel,
  className,
}: ErrorStateProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const hasDetails =
    details != null && (typeof details === "string" ? details.trim().length > 0 : true);

  return (
    <div
      role="alert"
      className={["error-state", className].filter(Boolean).join(" ")}
      style={{
        display: "flex",
        gap: 12,
        padding: "16px 18px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        borderLeft: "3px solid var(--func-error, #ef4444)",
        background: "color-mix(in srgb, var(--func-error, #ef4444) 7%, var(--bg-panel, var(--bg)))",
        color: "var(--text)",
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 18,
          height: 18,
          marginTop: 1,
          borderRadius: "50%",
          background: "var(--func-error, #ef4444)",
          color: "#fff",
          fontSize: 12,
          lineHeight: "18px",
          textAlign: "center",
          fontWeight: 700,
        }}
      >
        !
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>
          {title ?? t("error.title")}
        </div>
        {message ? (
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {message}
          </div>
        ) : null}

        {hasDetails ? (
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--accent, #2563eb)",
                fontSize: 12,
              }}
            >
              {open ? t("error.hideDetails") : t("error.showDetails")}
            </button>
            {open ? (
              <pre
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  maxHeight: 200,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {details}
              </pre>
            ) : null}
          </div>
        ) : null}

        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            style={{
              marginTop: 10,
              padding: "5px 14px",
              borderRadius: 6,
              border: "1px solid var(--accent, #2563eb)",
              background: "var(--accent, #2563eb)",
              color: "#fff",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {retryLabel ?? t("error.retry")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
