"use client";

// Reusable building blocks for the configuration panels (Models, Skills,
// Plugins, MCP, Extensions, Agents, Settings, WebSearch).
//
// These extract the boilerplate that was previously copy-pasted across every
// *Config.tsx / *Panel.tsx: the centered modal overlay, the header with a
// title + mono subtitle + close (×) button, the left sidebar (selectable
// list) + right detail split, the footer action row, the selectable list row
// with its hover/selection background logic, and the save button with its
// saving/saved checkmark animation.
//
// They are pure UI primitives — no domain logic — so they can be adopted one
// component at a time without changing behavior.

import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";

type CSS = React.CSSProperties;

// ── Modal shell ──────────────────────────────────────────────────────────────

export interface ConfigModalProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  /** Override the default modal width (860px desktop). Accepts any CSS length. */
  width?: number | string;
  /** Override the default modal height (78vh desktop). Accepts any CSS length. */
  height?: number | string;
  /** Scrollable content of the left sidebar. Omit to render detail-only. */
  left?: React.ReactNode;
  /** Pinned action area at the bottom of the left sidebar (e.g. "Add" button). */
  leftFooter?: React.ReactNode;
  /** Content of the right detail area. */
  right?: React.ReactNode;
  /** Action row rendered at the bottom of the modal. Omit for no footer. */
  footer?: React.ReactNode;
}

export function ConfigModal({
  title,
  subtitle,
  onClose,
  width,
  height,
  left,
  leftFooter,
  right,
  footer,
}: ConfigModalProps) {
  const isMobile = useIsMobile();
  const containerWidth = isMobile ? "calc(100vw - 16px)" : (width ?? 860);
  const containerHeight = isMobile ? "calc(100dvh - 16px)" : (height ?? "78vh");
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: containerWidth,
          maxWidth: "calc(100vw - 16px)",
          height: containerHeight,
          maxHeight: "calc(100dvh - 16px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{title}</span>
            {subtitle != null && (
              <code
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                  maxWidth: 320,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {subtitle}
              </code>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
              flexShrink: 0,
            }}
            aria-label="close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            overflow: "hidden",
          }}
        >
          {left != null && <ConfigSidebar footer={leftFooter}>{left}</ConfigSidebar>}
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>{right}</div>
        </div>

        {/* Footer */}
        {footer != null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 10,
              padding: "10px 18px",
              borderTop: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Left sidebar (scrollable list + pinned footer) ────────────────────────────

export function ConfigSidebar({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  return (
    <div
      style={{
        width: isMobile ? "100%" : 210,
        maxHeight: isMobile ? "40vh" : undefined,
        borderRight: isMobile ? "none" : "1px solid var(--border)",
        borderBottom: isMobile ? "1px solid var(--border)" : "none",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        background: "var(--bg-panel)",
      }}
    >
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>{children}</div>
      {footer != null && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "8px 6px", flexShrink: 0 }}>
          {footer}
        </div>
      )}
    </div>
  );
}

// ── Selectable list row (selection + hover background) ────────────────────────

export function ConfigListRow({
  selected,
  onClick,
  children,
  leading,
  hoverable = true,
  className,
  style,
}: {
  selected: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  /** Optional node rendered before the row content (icon / status dot). */
  leading?: React.ReactNode;
  /** Set false for rows that should not react to hover (e.g. group headers). */
  hoverable?: boolean;
  className?: string;
  style?: CSS;
}) {
  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 8px",
        borderRadius: 5,
        cursor: hoverable ? "pointer" : "default",
        background: selected ? "var(--bg-selected)" : "none",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (hoverable && !selected) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (hoverable && !selected) e.currentTarget.style.background = "none";
      }}
    >
      {leading}
      {children}
    </div>
  );
}

// ── Footer buttons ────────────────────────────────────────────────────────────

type ModalButtonVariant = "primary" | "secondary" | "danger";

export function ModalButton({
  variant = "secondary",
  onClick,
  children,
  disabled,
  title,
  type = "button",
}: {
  variant?: ModalButtonVariant;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const variants: Record<ModalButtonVariant, CSS> = {
    primary: { background: "var(--accent)", color: "#fff", border: "none" },
    secondary: {
      background: "none",
      border: "1px solid var(--border)",
      color: "var(--text-muted)",
    },
    danger: {
      background: "none",
      border: "1px solid rgba(239,68,68,0.3)",
      color: "#ef4444",
    },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: "6px 14px",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...variants[variant],
      }}
    >
      {children}
    </button>
  );
}

// ── Save button (saving / savedOk states + checkmark animation) ───────────────

export function SaveButton({
  onSave,
  saving,
  savedOk,
  disabled,
  idleLabel,
  savingLabel,
  savedLabel,
}: {
  onSave: () => void;
  saving: boolean;
  savedOk: boolean;
  disabled?: boolean;
  /** Labels default to the shared common.* i18n keys. */
  idleLabel?: string;
  savingLabel?: string;
  savedLabel?: string;
}) {
  const { t } = useI18n();
  const idle = idleLabel ?? t("common.save");
  const savingL = savingLabel ?? t("common.saving");
  const savedL = savedLabel ?? t("common.saved");
  return (
    <button
      onClick={onSave}
      disabled={saving || savedOk || disabled}
      style={{
        position: "relative",
        padding: "6px 16px",
        minWidth: 92,
        background: savedOk ? "#16a34a" : saving ? "var(--bg-panel)" : "var(--accent)",
        border: "none",
        borderRadius: 6,
        color: savedOk ? "#fff" : saving ? "var(--text-muted)" : "#fff",
        cursor: saving || savedOk || disabled ? "default" : "pointer",
        fontSize: 13,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        transition: "background-color 0.2s ease, color 0.2s ease",
        animation: savedOk ? "saved-pop 0.45s ease" : undefined,
      }}
    >
      {savedOk && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 18,
            animation: "saved-check-draw 0.35s ease forwards",
            flexShrink: 0,
          }}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      <span>{savedOk ? savedL : saving ? savingL : idle}</span>
    </button>
  );
}
