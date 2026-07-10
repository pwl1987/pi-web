"use client";

import { useState, useEffect, useCallback } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  cwd: string;
  onClose: () => void;
}

type Level = "user" | "project";
type Mode = "edit" | "preview" | "compare";

/** AGENTS.md management modal — user-level + project-level, with AI optimization. */
export function AgentsConfig({ cwd, onClose }: Props) {
  const { t } = useI18n();
  const [level, setLevel] = useState<Level>("project");
  const [mode, setMode] = useState<Mode>("edit");
  const [content, setContent] = useState("");
  const [exists, setExists] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizedContent, setOptimizedContent] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  // Load AGENTS.md when level changes.
  useEffect(() => {
    setLoading(true);
    setError("");
    setDirty(false);
    const params = new URLSearchParams({ level });
    if (level === "project") params.set("cwd", cwd);
    fetch(`/api/agents-md?${params}`)
      .then(r => r.json())
      .then(d => {
        setContent(d.content ?? "");
        setExists(d.exists ?? false);
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, [level, cwd]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/agents-md", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, cwd: level === "project" ? cwd : undefined, content }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Save failed");
      }
      setExists(true);
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSaving(false);
  }, [level, cwd, content]);

  const handleOptimize = useCallback(async () => {
    setOptimizing(true);
    setError("");
    try {
      const res = await fetch("/api/agents-md/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, cwd: level === "project" ? cwd : undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Optimization failed");
      setOptimizedContent(d.optimized);
      setMode("compare");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setOptimizing(false);
  }, [content, cwd, level]);

  const applyOptimized = () => {
    setContent(optimizedContent);
    setDirty(true);
    setMode("edit");
    setOptimizedContent("");
  };

  const discardOptimized = () => {
    setMode("edit");
    setOptimizedContent("");
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "min(900px, calc(100vw - 32px))", height: "min(80vh, 800px)",
        background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10,
        display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("agents.title")}</span>
            {/* Level tabs */}
            <div style={{ display: "flex", borderRadius: 6, border: "1px solid var(--border)", overflow: "hidden" }}>
              <button onClick={() => setLevel("user")} style={tabBtn(level === "user")}>{t("agents.userLevel")}</button>
              <button onClick={() => setLevel("project")} style={tabBtn(level === "project")}>{t("agents.projectLevel")}</button>
            </div>
            {/* Edit/Preview tabs (hidden in compare mode) */}
            {mode !== "compare" && (
              <div style={{ display: "flex", borderRadius: 6, border: "1px solid var(--border)", overflow: "hidden" }}>
                <button onClick={() => setMode("edit")} style={tabBtn(mode === "edit")}>{t("agents.edit")}</button>
                <button onClick={() => setMode("preview")} style={tabBtn(mode === "preview")}>{t("agents.preview")}</button>
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {saving && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("agents.saving")}</span>}
            {savedFlash && <span style={{ fontSize: 11, color: "var(--accent)" }}>✓ {t("agents.saved")}</span>}
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
          </div>
        </div>

        {/* Not-exists hint */}
        {!loading && !exists && mode === "edit" && (
          <div style={{ padding: "6px 18px", fontSize: 11, color: "var(--text-dim)", background: "var(--bg-subtle)", borderBottom: "1px solid var(--border)" }}>
            {t("agents.notExists")}
          </div>
        )}
        {error && (
          <div style={{ padding: "6px 18px", fontSize: 12, color: "#ef4444", borderBottom: "1px solid var(--border)" }}>{error}</div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {loading ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 13 }}>Loading…</div>
          ) : mode === "edit" ? (
            <textarea
              value={content}
              onChange={(e) => { setContent(e.target.value); setDirty(true); }}
              style={{
                flex: 1, width: "100%", border: "none", outline: "none", resize: "none",
                padding: "16px 18px", background: "var(--bg)", color: "var(--text)",
                fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.6,
                overflowY: "auto",
              }}
              spellCheck={false}
            />
          ) : mode === "preview" ? (
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
              <MarkdownBody cwd={cwd}>{content}</MarkdownBody>
            </div>
          ) : (
            /* Compare mode: side-by-side */
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", borderRight: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", marginBottom: 8 }}>{t("agents.original")}</div>
                <MarkdownBody cwd={cwd}>{content}</MarkdownBody>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", marginBottom: 8 }}>{t("agents.optimized")}</div>
                {optimizing ? (
                  <div style={{ color: "var(--text-dim)", fontSize: 13 }}>{t("agents.optimizing")}</div>
                ) : (
                  <MarkdownBody cwd={cwd}>{optimizedContent}</MarkdownBody>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 18px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {level === "user" ? "~/.pi/agent/AGENTS.md" : `${cwd}/AGENTS.md`}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {mode === "compare" ? (
              <>
                <button onClick={discardOptimized} style={btnSecondary}>{t("agents.discard")}</button>
                <button onClick={applyOptimized} style={btnPrimary}>{t("agents.apply")}</button>
              </>
            ) : (
              <>
                <button
                  onClick={handleOptimize}
                  disabled={optimizing || !content.trim()}
                  style={optimizing || !content.trim() ? btnDisabled : btnSecondary}
                >
                  {optimizing ? t("agents.optimizing") : `✨ ${t("agents.optimize")}`}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  style={saving || !dirty ? btnDisabled : btnPrimary}
                >
                  {t("agents.save")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Style helpers
function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "3px 10px", fontSize: 11, fontWeight: 500, cursor: "pointer",
    background: active ? "var(--bg-selected)" : "none",
    border: "none", borderRight: "1px solid var(--border)",
    color: active ? "var(--text)" : "var(--text-muted)",
  };
}

const btnPrimary: React.CSSProperties = {
  padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
  borderRadius: 6, border: "1px solid var(--accent)",
  background: "var(--accent)", color: "#fff",
};

const btnSecondary: React.CSSProperties = {
  padding: "6px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer",
  borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--bg-hover)", color: "var(--text)",
};

const btnDisabled: React.CSSProperties = {
  ...btnSecondary, opacity: 0.4, cursor: "default",
};
