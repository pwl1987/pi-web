"use client";

import type React from "react";

export function ConfirmDialog({
  isOpen,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  confirmIcon,
  style,
}: {
  isOpen: boolean;
  confirmText: string;
  cancelText: string;
  onConfirm: (e: React.MouseEvent) => void;
  onCancel: (e: React.MouseEvent) => void;
  confirmIcon?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  if (!isOpen) return null;

  return (
    <div style={{ display: "flex", gap: 5, flexShrink: 0, ...style }}>
      <button
        onClick={onConfirm}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          height: 30,
          padding: "0 11px",
          background: "var(--color-error-border)",
          border: "none",
          borderRadius: 6,
          color: "var(--bg)",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        {confirmIcon}
        {confirmText}
      </button>
      <button
        onClick={onCancel}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 30,
          padding: "0 11px",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 500,
          whiteSpace: "nowrap",
        }}
      >
        {cancelText}
      </button>
    </div>
  );
}
