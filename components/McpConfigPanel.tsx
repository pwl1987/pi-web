"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

interface McpServerInfo {
  name: string;
  transport: "stdio" | "url";
  command?: string;
  args?: string[];
  url?: string;
  lifecycle: string;
  auth: string | boolean;
  idleTimeout?: number;
  toolCount: number;
  resourceCount: number;
}

interface McpConfigData {
  servers: McpServerInfo[];
  settings: Record<string, unknown>;
  configPath: string;
}

export function McpConfigPanel() {
  const { t } = useI18n();
  const [data, setData] = useState<McpConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newArgs, setNewArgs] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp-config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as McpConfigData;
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const handleAdd = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const servers: Record<string, unknown> = {};
      // Preserve existing
      for (const s of data?.servers ?? []) {
        const entry: Record<string, unknown> = { lifecycle: s.lifecycle };
        if (s.transport === "url") { entry.url = s.url; } else { entry.command = s.command; entry.args = s.args; }
        servers[s.name] = entry;
      }
      // Add new
      if (newUrl.trim()) {
        servers[name] = { url: newUrl.trim(), lifecycle: "lazy" };
      } else {
        servers[name] = {
          command: newCommand.trim() || "npx",
          args: newArgs.trim() ? newArgs.trim().split(/\s+/) : [],
          lifecycle: "lazy",
        };
      }
      await fetch("/api/mcp-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpServers: servers }),
      });
      setAdding(false);
      setNewName(""); setNewCommand(""); setNewUrl(""); setNewArgs("");
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [newName, newUrl, newCommand, newArgs, data, reload]);

  const handleRemove = useCallback(async (name: string) => {
    const servers: Record<string, unknown> = {};
    for (const s of data?.servers ?? []) {
      if (s.name === name) continue;
      const entry: Record<string, unknown> = { lifecycle: s.lifecycle };
      if (s.transport === "url") { entry.url = s.url; } else { entry.command = s.command; entry.args = s.args; }
      servers[s.name] = entry;
    }
    await fetch("/api/mcp-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mcpServers: servers }),
    });
    void reload();
  }, [data, reload]);

  if (loading) return <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 12 }}>{t("common.loading")}</div>;
  if (error) return <div style={{ padding: 16, color: "#f87171", fontSize: 12 }}>{error}</div>;

  return (
    <div style={{ padding: 12, fontSize: 12, height: "100%", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t("mcp.title")}</h3>
        <button onClick={() => void reload()} style={btnStyle}>{t("common.refresh")}</button>
      </div>

      {data && data.servers.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {data.servers.map((s) => (
            <div key={s.name} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)" }}>{s.name}</span>
                <span style={badgeStyle(s.transport === "url" ? "var(--accent)" : "var(--text-dim)")}>{s.transport}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
                {s.transport === "url" ? s.url : `${s.command} ${(s.args ?? []).join(" ")}`}
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
                <span>{t("mcp.lifecycle")}: {s.lifecycle}</span>
                {s.toolCount > 0 && <span>{t("mcp.tools")}: {s.toolCount}</span>}
                {s.resourceCount > 0 && <span>{t("mcp.resources")}: {s.resourceCount}</span>}
              </div>
              <button onClick={() => void handleRemove(s.name)} style={{ ...btnStyle, marginTop: 8, color: "#f87171" }}>
                {t("common.remove")}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: "var(--text-dim)", marginBottom: 12 }}>{t("mcp.noServers")}</div>
      )}

      {adding ? (
        <div style={{ ...cardStyle, borderColor: "var(--accent)" }}>
          <input placeholder={t("mcp.serverName")} value={newName} onChange={(e) => setNewName(e.target.value)} style={inputStyle} />
          <div style={{ fontSize: 11, color: "var(--text-dim)", margin: "8px 0 4px" }}>{t("mcp.stdioMode")}</div>
          <input placeholder="command (npx)" value={newCommand} onChange={(e) => setNewCommand(e.target.value)} style={inputStyle} />
          <input placeholder="args (-y server-mcp@latest)" value={newArgs} onChange={(e) => setNewArgs(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
          <div style={{ fontSize: 11, color: "var(--text-dim)", margin: "8px 0 4px" }}>{t("mcp.urlMode")}</div>
          <input placeholder="https://..." value={newUrl} onChange={(e) => setNewUrl(e.target.value)} style={inputStyle} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={() => void handleAdd()} disabled={saving || !newName.trim()} style={btnStyle}>
              {saving ? t("common.saving") : t("common.add")}
            </button>
            <button onClick={() => setAdding(false)} style={btnStyle}>{t("common.cancel")}</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={btnStyle}>{t("mcp.addServer")}</button>
      )}

      {data?.configPath && (
        <div style={{ marginTop: 12, fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          {data.configPath}
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 6,
  padding: "5px 12px", fontSize: 11, color: "var(--text)", cursor: "pointer",
};
const cardStyle: React.CSSProperties = {
  background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 10,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "5px 8px", fontSize: 11, fontFamily: "var(--font-mono)",
  background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5,
  color: "var(--text)", boxSizing: "border-box",
};
function badgeStyle(color: string): React.CSSProperties {
  return { fontSize: 10, padding: "1px 6px", borderRadius: 3, background: `${color}22`, color, fontWeight: 600 };
}
