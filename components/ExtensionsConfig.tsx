"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";

interface ExtListItem {
  id: string;
  name?: string;
  source: string;
  enabled: boolean;
  canUninstall: boolean;
  dir: string;
}

interface Props {
  /** Ignored — kept for AppShell compatibility. Extensions list comes from API. */
  extensions?: unknown[];
  onClose: () => void;
}

/** Extension management modal — full list + enable/disable toggle + install/uninstall. */
export function ExtensionsConfig({ onClose }: Props) {
  const { t } = useI18n();
  const [list, setList] = useState<ExtListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInstall, setShowInstall] = useState(false);
  const [installPath, setInstallPath] = useState("");
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/extensions/list");
      const d = await res.json();
      setList(d.extensions ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const toggleEnabled = async (id: string, current: boolean) => {
    // Optimistic update
    setList(prev => prev.map(e => e.id === id ? { ...e, enabled: !current } : e));
    try {
      await fetch("/api/extensions/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled: !current }),
      });
    } catch { /* revert on error */ void reload(); }
  };

  const handleInstall = async () => {
    if (!installPath.trim()) return;
    setInstalling(true);
    setMessage("");
    try {
      const res = await fetch("/api/extensions/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: installPath.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Install failed");
      setMessage(t("extensions.installed", { id: d.id ?? "" }));
      setInstallPath("");
      setShowInstall(false);
      void reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
    setInstalling(false);
  };

  const handleUninstall = async (id: string) => {
    if (!confirm(t("extensions.uninstallConfirm", { id }))) return;
    try {
      const res = await fetch("/api/extensions/uninstall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Uninstall failed");
      void reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "min(560px, calc(100vw - 32px))", maxHeight: "calc(100dvh - 32px)",
        background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10,
        display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("extensions.title")}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px" }}>
          {message && (
            <div style={{ padding: "6px 10px", marginBottom: 8, fontSize: 12, borderRadius: 6, background: "var(--bg-hover)", color: message.startsWith(t("extensions.installed", { id: "" }).split("{")[0]) ? "var(--accent)" : "#ef4444" }}>
              {message}
            </div>
          )}

          {loading ? (
            <div style={{ padding: "24px 0", color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>Loading…</div>
          ) : list.length === 0 ? (
            <div style={{ padding: "24px 0", color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
              {t("extensions.noExtensions")}
              <br />
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("extensions.hint")}</span>
            </div>
          ) : (
            list.map((ext) => (
              <div key={ext.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
                    {ext.name ?? ext.id}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ padding: "1px 5px", borderRadius: 3, background: ext.source === "bundled" ? "var(--bg-hover)" : "rgba(37,99,235,0.1)", color: ext.source === "bundled" ? "var(--text-dim)" : "var(--accent)" }}>
                      {ext.source === "bundled" ? t("extensions.bundled") : "local"}
                    </span>
                    <span>{ext.id}</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {ext.canUninstall && (
                    <button
                      onClick={() => handleUninstall(ext.id)}
                      style={{ padding: "3px 8px", fontSize: 11, borderRadius: 5, cursor: "pointer", background: "none", border: "1px solid var(--border)", color: "#ef4444" }}
                    >
                      {t("extensions.uninstall")}
                    </button>
                  )}
                  {/* Toggle switch */}
                  <button
                    onClick={() => toggleEnabled(ext.id, ext.enabled)}
                    title={t("extensions.reloadHint")}
                    style={{
                      width: 36, height: 20, borderRadius: 10, cursor: "pointer", padding: 0, border: "none", position: "relative",
                      background: ext.enabled ? "var(--accent)" : "var(--bg-hover)", transition: "background 0.15s",
                    }}
                  >
                    <span style={{ position: "absolute", top: 2, left: ext.enabled ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.15s" }} />
                  </button>
                </div>
              </div>
            ))
          )}

          {/* Install area */}
          {showInstall && (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", marginBottom: 6 }}>
                {t("extensions.installPath")}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={installPath}
                  onChange={(e) => setInstallPath(e.target.value)}
                  placeholder="/path/to/extension"
                  style={{ flex: 1, padding: "5px 8px", fontSize: 12, borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono)", outline: "none" }}
                />
                <button
                  onClick={handleInstall}
                  disabled={installing || !installPath.trim()}
                  style={{ padding: "5px 12px", fontSize: 12, fontWeight: 500, cursor: installing || !installPath.trim() ? "default" : "pointer", borderRadius: 5, border: "1px solid var(--accent)", background: "var(--accent)", color: "#fff", opacity: installing || !installPath.trim() ? 0.5 : 1 }}
                >
                  {installing ? "…" : t("extensions.installBtn")}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                {t("extensions.installHint")}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 18px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("extensions.reloadHint")}</span>
          <button
            onClick={() => setShowInstall(v => !v)}
            style={{ padding: "4px 10px", fontSize: 12, fontWeight: 500, cursor: "pointer", borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg-hover)", color: "var(--text)" }}
          >
            {showInstall ? "−" : "+"} {t("extensions.install")}
          </button>
        </div>
      </div>
    </div>
  );
}
