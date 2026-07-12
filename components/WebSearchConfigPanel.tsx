"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { csrfHeaders } from "@/lib/csrf-client";

interface WebSearchData {
  providers: Record<string, boolean>;
  provider: string;
  workflow: string;
  curatorTimeoutSeconds: number;
  webSearchEnabled: boolean;
  configPath: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  brave: "Brave",
  tavily: "Tavily",
  exa: "Exa",
  perplexity: "Perplexity",
  parallel: "Parallel",
  gemini: "Gemini",
};

export function WebSearchConfigPanel() {
  const { t } = useI18n();
  const [data, setData] = useState<WebSearchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/web-search-config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as WebSearchData;
      setData(d);
      setKeyInputs({});
      setShowKeys({});
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleSave = useCallback(async () => {
    if (!data) return;
    setSaving(true);
    setSaved(false);
    try {
      const apiKeys: Record<string, string> = {};
      for (const [provider, key] of Object.entries(keyInputs)) {
        if (key.trim()) apiKeys[`${provider}ApiKey`] = key.trim();
      }
      await fetch("/api/web-search-config", {
        method: "PUT",
        headers: csrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          provider: data.provider,
          workflow: data.workflow,
          curatorTimeoutSeconds: data.curatorTimeoutSeconds,
          webSearchEnabled: data.webSearchEnabled,
          apiKeys,
        }),
      });
      setSaved(true);
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [data, keyInputs, reload]);

  if (loading)
    return (
      <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 12 }}>
        {t("common.loading")}
      </div>
    );
  if (error) return <div style={{ padding: 16, color: "#f87171", fontSize: 12 }}>{error}</div>;
  if (!data) return null;

  return (
    <div style={{ padding: 12, fontSize: 12, height: "100%" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t("webSearch.title")}</h3>
        <button onClick={() => void reload()} style={btnStyle}>
          {t("common.refresh")}
        </button>
      </div>

      {/* Default provider */}
      <div style={{ marginBottom: 16 }}>
        <label
          style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}
        >
          {t("webSearch.defaultProvider")}
        </label>
        <select
          value={data.provider}
          onChange={(e) => setData({ ...data, provider: e.target.value })}
          style={selectStyle}
        >
          <option value="auto">auto</option>
          {Object.entries(PROVIDER_LABELS).map(([key, label]) => (
            <option key={key} value={key} disabled={!data.providers[key]}>
              {label}
              {data.providers[key] ? "" : ` (${t("webSearch.notConfigured")})`}
            </option>
          ))}
        </select>
      </div>

      {/* Workflow */}
      <div style={{ marginBottom: 16 }}>
        <label
          style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}
        >
          {t("webSearch.workflow")}
        </label>
        <select
          value={data.workflow}
          onChange={(e) => setData({ ...data, workflow: e.target.value })}
          style={selectStyle}
        >
          <option value="none">{t("webSearch.workflowNone")}</option>
          <option value="summary-review">{t("webSearch.workflowSummary")}</option>
          <option value="auto-summary">{t("webSearch.workflowAuto")}</option>
        </select>
      </div>

      {/* Toggle */}
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={data.webSearchEnabled}
          onChange={(e) => setData({ ...data, webSearchEnabled: e.target.checked })}
        />
        <span>{t("webSearch.enabled")}</span>
      </div>

      {/* Provider API keys */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>
          {t("webSearch.apiKeys")}
        </div>
        {Object.entries(PROVIDER_LABELS).map(([key, label]) => {
          const configured = data.providers[key];
          return (
            <div key={key} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>{label}</span>
                {configured && <span style={badgeStyle("var(--accent)")}>✓</span>}
                {key === "parallel" && (
                  <span style={{ fontSize: 10, color: "var(--text-dim)" }}>(env)</span>
                )}
              </div>
              {key !== "parallel" && (
                <div style={{ display: "flex", gap: 4 }}>
                  <input
                    type={showKeys[key] ? "text" : "password"}
                    placeholder={configured ? "••••••••" : t("webSearch.enterKey")}
                    value={keyInputs[key] ?? ""}
                    onChange={(e) => setKeyInputs({ ...keyInputs, [key]: e.target.value })}
                    style={inputStyle}
                  />
                  <button
                    onClick={() => setShowKeys({ ...showKeys, [key]: !showKeys[key] })}
                    style={{ ...btnStyle, padding: "5px 8px" }}
                  >
                    {showKeys[key] ? "🙈" : "👁"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={() => void handleSave()} disabled={saving} style={btnStyle}>
          {saving ? t("common.saving") : t("common.save")}
        </button>
        {saved && (
          <span style={{ fontSize: 11, color: "var(--accent)" }}>✓ {t("common.saved")}</span>
        )}
      </div>

      {data.configPath && (
        <div
          style={{
            marginTop: 12,
            fontSize: 10,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {data.configPath}
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "var(--bg-hover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "5px 12px",
  fontSize: 11,
  color: "var(--text)",
  cursor: "pointer",
};
const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "5px 8px",
  fontSize: 11,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  color: "var(--text)",
};
const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  fontSize: 11,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  color: "var(--text)",
};
function badgeStyle(color: string): React.CSSProperties {
  return { fontSize: 10, fontWeight: 700, color };
}
