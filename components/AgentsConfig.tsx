"use client";

import { useState, useEffect, useCallback } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import { csrfFetchJson } from "@/lib/csrf-fetch";
import { useAsync } from "@/hooks/useAsync";
import { useSave } from "@/hooks/useSave";

interface Props {
  cwd: string;
  onClose: () => void;
}

type FileType = "agents" | "system" | "append";
type Level = "user" | "project";
type Mode = "edit" | "preview" | "compare";

const FILE_META: Record<FileType, { name: string; descKey: string }> = {
  agents: { name: "AGENTS.md", descKey: "prompts.agentsDesc" },
  system: { name: "SYSTEM.md", descKey: "prompts.systemDesc" },
  append: { name: "APPEND_SYSTEM.md", descKey: "prompts.appendDesc" },
};

/** Prompt file management — AGENTS.md / SYSTEM.md / APPEND_SYSTEM.md. */
export function AgentsConfig({ cwd, onClose }: Props) {
  const { t } = useI18n();
  const [fileType, setFileType] = useState<FileType>("agents");
  const [level, setLevel] = useState<Level>("project");
  const [mode, setMode] = useState<Mode>("edit");
  const [content, setContent] = useState("");
  const [exists, setExists] = useState(true);
  const { loading, error, setError, run } = useAsync(undefined, { initialLoading: true });
  const { saving, savedOk: savedFlash, startSave, endSave } = useSave({ savedTimeoutMs: 1500 });
  const [optimizing, setOptimizing] = useState(false);
  const [optimizedContent, setOptimizedContent] = useState("");
  const [dirty, setDirty] = useState(false);

  const loadFile = useCallback(async () => {
    setDirty(false);
    setMode("edit");
    const params = new URLSearchParams({ file: fileType, level });
    if (level === "project") params.set("cwd", cwd);
    const { data } = await csrfFetchJson<{ content?: string; exists?: boolean }>(
      `/api/agents-md?${params}`,
      { method: "GET" },
    );
    setContent(data.content ?? "");
    setExists(data.exists ?? false);
  }, [fileType, level, cwd]);

  useEffect(() => {
    void run(loadFile);
  }, [loadFile, run]);

  const handleSave = useCallback(async () => {
    startSave();
    setError("");
    try {
      const r = await csrfFetchJson("/api/agents-md", {
        method: "PUT",
        body: {
          file: fileType,
          level,
          cwd: level === "project" ? cwd : undefined,
          content,
        },
      });
      if (!r.ok) {
        const d = r.data as { error?: string };
        throw new Error(d.error ?? "Save failed");
      }
      setExists(true);
      setDirty(false);
      endSave(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      endSave(false);
    }
  }, [fileType, level, cwd, content, startSave, endSave]);

  const handleOptimize = useCallback(async () => {
    setOptimizing(true);
    setError("");
    try {
      const { ok, data: d } = await csrfFetchJson<{ optimized?: string; error?: string }>(
        "/api/agents-md/optimize",
        {
          method: "POST",
          body: {
            content,
            file: fileType,
            cwd: level === "project" ? cwd : undefined,
          },
        },
      );
      if (!ok) throw new Error(d.error ?? "Optimization failed");
      setOptimizedContent(d.optimized ?? "");
      setMode("compare");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setOptimizing(false);
  }, [content, fileType, cwd, level]);

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
          width: "min(900px, calc(100vw - 32px))",
          height: "min(80vh, 800px)",
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
            padding: "10px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {t("prompts.title")}
            </span>
            {/* File type tabs */}
            <div
              style={{
                display: "flex",
                borderRadius: 6,
                border: "1px solid var(--border)",
                overflow: "hidden",
              }}
            >
              {(["agents", "system", "append"] as FileType[]).map((ft) => (
                <button key={ft} onClick={() => setFileType(ft)} style={tabBtn(fileType === ft)}>
                  {FILE_META[ft].name}
                </button>
              ))}
            </div>
            {/* Level tabs */}
            <div
              style={{
                display: "flex",
                borderRadius: 6,
                border: "1px solid var(--border)",
                overflow: "hidden",
              }}
            >
              <button onClick={() => setLevel("user")} style={tabBtn(level === "user")}>
                {t("prompts.userLevel")}
              </button>
              <button onClick={() => setLevel("project")} style={tabBtn(level === "project")}>
                {t("prompts.projectLevel")}
              </button>
            </div>
            {/* Edit/Preview tabs */}
            {mode !== "compare" && (
              <div
                style={{
                  display: "flex",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  overflow: "hidden",
                }}
              >
                <button onClick={() => setMode("edit")} style={tabBtn(mode === "edit")}>
                  {t("prompts.edit")}
                </button>
                <button onClick={() => setMode("preview")} style={tabBtn(mode === "preview")}>
                  {t("prompts.preview")}
                </button>
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {saving && (
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("prompts.saving")}</span>
            )}
            {savedFlash && (
              <span style={{ fontSize: 11, color: "var(--accent)" }}>✓ {t("prompts.saved")}</span>
            )}
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
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Description + not-exists hint */}
        {!loading && (
          <div
            style={{
              padding: "4px 18px",
              fontSize: 11,
              color: "var(--text-dim)",
              background: "var(--bg-subtle)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {t(FILE_META[fileType].descKey)}
            {!exists && (
              <span style={{ color: "var(--accent)", marginLeft: 8 }}>
                · {t("prompts.notExists")}
              </span>
            )}
          </div>
        )}
        {error && (
          <div
            style={{
              padding: "6px 18px",
              fontSize: 12,
              color: "#ef4444",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {error}
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {loading ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-dim)",
                fontSize: 13,
              }}
            >
              Loading…
            </div>
          ) : mode === "edit" ? (
            <textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
              }}
              style={{
                flex: 1,
                width: "100%",
                border: "none",
                outline: "none",
                resize: "none",
                padding: "16px 18px",
                background: "var(--bg)",
                color: "var(--text)",
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                lineHeight: 1.6,
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
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "12px 16px",
                  borderRight: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-dim)",
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  {t("prompts.original")}
                </div>
                <MarkdownBody cwd={cwd}>{content}</MarkdownBody>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--accent)",
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  {t("prompts.optimized")}
                </div>
                {optimizing ? (
                  <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
                    {t("prompts.optimizing")}
                  </div>
                ) : (
                  <MarkdownBody cwd={cwd}>{optimizedContent}</MarkdownBody>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {level === "user"
              ? fileType === "agents"
                ? "~/.pi/agent/AGENTS.md"
                : `~/.pi/agent/${FILE_META[fileType].name}`
              : fileType === "agents"
                ? `${cwd}/AGENTS.md`
                : `${cwd}/.pi/${FILE_META[fileType].name}`}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {mode === "compare" ? (
              <>
                <button onClick={discardOptimized} style={btnSecondary}>
                  {t("prompts.discard")}
                </button>
                <button onClick={applyOptimized} style={btnPrimary}>
                  {t("prompts.apply")}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleOptimize}
                  disabled={optimizing || !content.trim()}
                  style={optimizing || !content.trim() ? btnDisabled : btnSecondary}
                >
                  {optimizing ? t("prompts.optimizing") : `✨ ${t("prompts.optimize")}`}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  style={saving || !dirty ? btnDisabled : btnPrimary}
                >
                  {t("prompts.save")}
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
    padding: "3px 10px",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    background: active ? "var(--bg-selected)" : "none",
    border: "none",
    borderRight: "1px solid var(--border)",
    color: active ? "var(--text)" : "var(--text-muted)",
  };
}

const btnPrimary: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  borderRadius: 6,
  border: "1px solid var(--accent)",
  background: "var(--accent)",
  color: "#fff",
};

const btnSecondary: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-hover)",
  color: "var(--text)",
};

const btnDisabled: React.CSSProperties = {
  ...btnSecondary,
  opacity: 0.4,
  cursor: "default",
};
