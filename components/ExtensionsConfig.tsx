"use client";

import { useI18n } from "@/hooks/useI18n";
import type { LoadedExtensionInfo } from "@/lib/extensions/types";

interface Props {
  extensions: LoadedExtensionInfo[];
  onClose: () => void;
}

/** Modal for viewing and toggling browser-side UI extensions. */
export function ExtensionsConfig({ extensions, onClose }: Props) {
  const { t } = useI18n();

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
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "min(640px, calc(100vw - 32px))",
          maxHeight: "calc(100dvh - 32px)",
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
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0,
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            {t("extensions.title")}
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px" }}>
          {extensions.length === 0 ? (
            <div style={{ padding: "24px 0", color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
              {t("extensions.noExtensions")}
              <br />
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                {t("extensions.hint")}
              </span>
            </div>
          ) : (
            extensions.map((ext) => (
              <div
                key={ext.id}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 0", borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{ext.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    {ext.source} · {ext.actionCount + ext.panelCount + ext.labelCount} contributions
                  </div>
                </div>
                <button
                  onClick={async () => {
                    // Toggling writes config server-side; user must reload for it to take effect.
                    await fetch("/api/extensions/config", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: ext.id, enabled: false }),
                    });
                  }}
                  style={{
                    padding: "4px 10px", fontSize: 11, borderRadius: 5, cursor: "pointer",
                    background: "var(--bg-hover)", border: "1px solid var(--border)", color: "var(--text-muted)",
                  }}
                  title={t("extensions.disableHint")}
                >
                  {t("extensions.disable")}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "8px 18px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-dim)" }}>
          {t("extensions.reloadHint")}
        </div>
      </div>
    </div>
  );
}
