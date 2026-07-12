"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { usePersistentState } from "@/hooks/usePersistentState";
import { csrfHeaders } from "@/lib/csrf-client";
import { BUILTIN_MCP_TEMPLATES, type McpServerEntry, type McpTemplate } from "@/lib/mcp-templates";
import { EnvProvisionButton } from "@/components/EnvProvisionButton";
import type { CapabilityEnv } from "@/lib/env-types";

interface McpServerInfo {
  name: string;
  transport: "stdio" | "url";
  command?: string;
  args?: string[];
  url?: string;
  lifecycle: string;
  auth: string | boolean;
  idleTimeout?: number;
  requestTimeoutMs?: number;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  toolCount: number;
  resourceCount: number;
}

interface McpConfigData {
  servers: McpServerInfo[];
  settings: Record<string, unknown>;
  configPath: string;
}

interface AdapterStatus {
  installed: boolean;
  installedPath?: string;
  version?: string;
  configured?: boolean;
}

interface McpFieldError {
  server?: string;
  field: string;
  message: string;
}

interface ProbeResult {
  reachable: boolean;
  detail: string;
  latencyMs?: number;
}

interface ServerDraft {
  name: string;
  transport: "stdio" | "url";
  command: string;
  argsText: string;
  url: string;
  lifecycle: string;
  envText: string;
  headersText: string;
  idleTimeout: string;
  requestTimeoutMs: string;
}

const COMMAND_SUGGESTIONS = ["npx", "node", "uvx", "python3", "python", "bun", "deno", "docker"];

const LIFECYCLES = ["lazy", "eager", "onDemand"];

function emptyDraft(): ServerDraft {
  return {
    name: "",
    transport: "stdio",
    command: "npx",
    argsText: "",
    url: "",
    lifecycle: "lazy",
    envText: "",
    headersText: "",
    idleTimeout: "",
    requestTimeoutMs: "",
  };
}

function draftFromServer(s: McpServerInfo): ServerDraft {
  return {
    name: s.name,
    transport: s.transport,
    command: s.command ?? "npx",
    argsText: (s.args ?? []).join(" "),
    url: s.url ?? "",
    lifecycle: s.lifecycle ?? "lazy",
    envText: s.env
      ? Object.entries(s.env)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      : "",
    headersText: s.headers
      ? Object.entries(s.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
      : "",
    idleTimeout: s.idleTimeout != null ? String(s.idleTimeout) : "",
    requestTimeoutMs: s.requestTimeoutMs != null ? String(s.requestTimeoutMs) : "",
  };
}

function parseArgs(t: string): string[] {
  return t.trim() ? t.trim().split(/\s+/) : [];
}

function parseEnv(t: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const line of t.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k) o[k] = v;
    }
  }
  return o;
}

function parseHeaders(t: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const line of t.split("\n")) {
    const i = line.search(/[:=]/);
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k) o[k] = v;
    }
  }
  return o;
}

function parseTimeout(t: string): number | undefined {
  const s = t.trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function draftToEntry(d: ServerDraft): McpServerEntry {
  const entry: McpServerEntry = {};
  if (d.transport === "url") {
    entry.url = d.url.trim();
  } else {
    entry.command = d.command.trim() || "npx";
    const args = parseArgs(d.argsText);
    if (args.length) entry.args = args;
  }
  entry.lifecycle = d.lifecycle || "lazy";
  const env = parseEnv(d.envText);
  if (Object.keys(env).length) entry.env = env;
  if (d.transport === "url") {
    const headers = parseHeaders(d.headersText);
    if (Object.keys(headers).length) entry.headers = headers;
  }
  const idle = parseTimeout(d.idleTimeout);
  if (idle !== undefined) entry.idleTimeout = idle;
  const rt = parseTimeout(d.requestTimeoutMs);
  if (rt !== undefined) entry.requestTimeoutMs = rt;
  return entry;
}

function serverInfoToEntry(s: McpServerInfo): McpServerEntry {
  const e: McpServerEntry = {};
  if (s.transport === "url") e.url = s.url;
  else {
    e.command = s.command;
    if (s.args) e.args = s.args;
  }
  if (s.lifecycle) e.lifecycle = s.lifecycle;
  if (s.env) e.env = s.env;
  if (s.headers) e.headers = s.headers;
  if (s.idleTimeout !== undefined) e.idleTimeout = s.idleTimeout;
  if (s.requestTimeoutMs !== undefined) e.requestTimeoutMs = s.requestTimeoutMs;
  return e;
}

function validateDraft(
  d: ServerDraft,
  occupiedNames: string[],
  editingName: string | null,
): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.name.trim()) e.name = "mcp.err.nameEmpty";
  else if (!/^[a-zA-Z0-9_-]+$/.test(d.name)) e.name = "mcp.err.nameInvalid";
  else if (d.name !== editingName && occupiedNames.includes(d.name))
    e.name = "mcp.err.nameDuplicate";

  if (d.transport === "url") {
    if (!d.url.trim()) e.url = "mcp.err.urlEmpty";
    else {
      try {
        const u = new URL(d.url);
        if (u.protocol !== "http:" && u.protocol !== "https:") e.url = "mcp.err.urlInvalid";
      } catch {
        e.url = "mcp.err.urlInvalid";
      }
    }
  } else if (!d.command.trim()) {
    e.command = "mcp.err.commandEmpty";
  }

  if (d.idleTimeout.trim() && (Number.isNaN(Number(d.idleTimeout)) || Number(d.idleTimeout) < 0))
    e.idleTimeout = "mcp.err.timeoutPositive";
  if (
    d.requestTimeoutMs.trim() &&
    (Number.isNaN(Number(d.requestTimeoutMs)) || Number(d.requestTimeoutMs) < 0)
  )
    e.requestTimeoutMs = "mcp.err.timeoutPositive";
  return e;
}

export function McpConfigPanel({ cwd }: { cwd?: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<McpConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // npm:pi-mcp-adapter install status. When not installed, MCP functionality
  // is disabled and the user is offered an install action.
  const [adapterStatus, setAdapterStatus] = useState<AdapterStatus | null>(null);
  const [adapterChecking, setAdapterChecking] = useState(false);
  const [adapterInstalling, setAdapterInstalling] = useState(false);
  const [adapterError, setAdapterError] = useState<string | null>(null);

  const mcpDisabled = adapterStatus !== null && !adapterStatus.installed;

  const [adding, setAdding] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const formOpen = adding || editingName !== null;
  const [draft, setDraft] = useState<ServerDraft>(emptyDraft);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);

  const [myTemplates, setMyTemplates] = usePersistentState<McpTemplate[]>("mcp-templates", []);
  const [showTemplates, setShowTemplates] = useState(false);
  const [serverErrors, setServerErrors] = useState<McpFieldError[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Per-server environment provision run tokens (incremented to auto-trigger
  // a detect+install run right after saving a server).
  const [envRunTokens, setEnvRunTokens] = useState<Record<string, number>>({});

  const checkAdapter = useCallback(async () => {
    if (!cwd) return;
    setAdapterChecking(true);
    setAdapterError(null);
    try {
      const res = await fetch(`/api/mcp-adapter?cwd=${encodeURIComponent(cwd)}`);
      const d = (await res.json()) as AdapterStatus & { error?: string };
      if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
      setAdapterStatus(d);
    } catch (e) {
      setAdapterError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdapterChecking(false);
    }
  }, [cwd]);

  useEffect(() => {
    void checkAdapter();
  }, [checkAdapter]);

  const handleInstallAdapter = useCallback(async () => {
    if (!cwd) return;
    setAdapterInstalling(true);
    setAdapterError(null);
    try {
      const res = await fetch("/api/mcp-adapter", {
        method: "POST",
        headers: csrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "install",
          source: "npm:pi-mcp-adapter",
          cwd,
          scope: "global",
        }),
      });
      const d = (await res.json()) as AdapterStatus & { error?: string };
      if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
      setAdapterStatus(d);
    } catch (e) {
      setAdapterError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdapterInstalling(false);
    }
  }, [cwd]);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp-config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as McpConfigData;
      setData(d);
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

  const occupiedNames = useMemo(() => (data?.servers ?? []).map((s) => s.name), [data]);

  const openAdd = useCallback(() => {
    setDraft(emptyDraft());
    setDraftErrors({});
    setProbe(null);
    setShowAdvanced(false);
    setEditingName(null);
    setAdding(true);
    setServerErrors([]);
  }, []);

  const openEdit = useCallback((s: McpServerInfo) => {
    setDraft(draftFromServer(s));
    setDraftErrors({});
    setProbe(null);
    setShowAdvanced(
      !!s.env || !!s.headers || s.idleTimeout !== undefined || s.requestTimeoutMs !== undefined,
    );
    setAdding(false);
    setEditingName(s.name);
    setServerErrors([]);
  }, []);

  const closeForm = useCallback(() => {
    setAdding(false);
    setEditingName(null);
    setProbe(null);
    setDraftErrors({});
  }, []);

  const updateDraft = useCallback(
    (patch: Partial<ServerDraft>) => {
      setDraft((prev) => {
        const next = { ...prev, ...patch };
        setDraftErrors(validateDraft(next, occupiedNames, editingName));
        return next;
      });
    },
    [occupiedNames, editingName],
  );

  const handleTest = useCallback(async () => {
    setTesting(true);
    setProbe(null);
    try {
      const res = await fetch("/api/mcp-config/test", {
        method: "POST",
        headers: csrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          transport: draft.transport,
          command: draft.command,
          args: parseArgs(draft.argsText),
          url: draft.url,
        }),
      });
      const d = (await res.json()) as ProbeResult;
      setProbe(d);
    } catch (e) {
      setProbe({
        reachable: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTesting(false);
    }
  }, [draft]);

  const handleSave = useCallback(async () => {
    const errs = validateDraft(draft, occupiedNames, editingName);
    if (Object.keys(errs).length > 0) {
      setDraftErrors(errs);
      return;
    }
    setSaving(true);
    setServerErrors([]);
    try {
      const servers: Record<string, McpServerEntry> = {};
      for (const s of data?.servers ?? []) {
        if (editingName && s.name === editingName) continue;
        servers[s.name] = serverInfoToEntry(s);
      }
      servers[draft.name.trim()] = draftToEntry(draft);
      const res = await fetch("/api/mcp-config", {
        method: "PUT",
        headers: csrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ mcpServers: servers }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { errors?: McpFieldError[]; error?: string };
        if (d.errors) setServerErrors(d.errors);
        else setError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      closeForm();
      void reload();
      const savedName = draft.name.trim();
      setEnvRunTokens((prev) => ({ ...prev, [savedName]: (prev[savedName] ?? 0) + 1 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [draft, occupiedNames, editingName, data, closeForm, reload]);

  const handleRemove = useCallback(
    async (name: string) => {
      const servers: Record<string, McpServerEntry> = {};
      for (const s of data?.servers ?? []) {
        if (s.name === name) continue;
        servers[s.name] = serverInfoToEntry(s);
      }
      await fetch("/api/mcp-config", {
        method: "PUT",
        headers: csrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ mcpServers: servers }),
      });
      if (editingName === name) closeForm();
      void reload();
    },
    [data, editingName, closeForm, reload],
  );

  const applyTemplate = useCallback((tpl: McpTemplate) => {
    const s = tpl.server;
    setDraft({
      name: tpl.defaultName,
      transport: s.url ? "url" : "stdio",
      command: s.command ?? "npx",
      argsText: (s.args ?? []).join(" "),
      url: s.url ?? "",
      lifecycle: s.lifecycle ?? "lazy",
      envText: s.env
        ? Object.entries(s.env)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")
        : "",
      headersText: s.headers
        ? Object.entries(s.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")
        : "",
      idleTimeout: s.idleTimeout != null ? String(s.idleTimeout) : "",
      requestTimeoutMs: s.requestTimeoutMs != null ? String(s.requestTimeoutMs) : "",
    });
    setDraftErrors({});
    setProbe(null);
    setShowAdvanced(
      !!s.env || !!s.headers || s.idleTimeout !== undefined || s.requestTimeoutMs !== undefined,
    );
    setEditingName(null);
    setAdding(true);
    setShowTemplates(false);
  }, []);

  const saveAsTemplate = useCallback(() => {
    if (!formOpen) return;
    const label = window.prompt(t("mcp.templateNamePrompt"), draft.name.trim() || "my-server");
    if (!label) return;
    const tpl: McpTemplate = {
      id: `user-${Date.now()}`,
      label: label.trim(),
      description: draft.name.trim(),
      builtin: false,
      defaultName: draft.name.trim() || label.trim(),
      server: draftToEntry(draft),
    };
    setMyTemplates((prev) => [...prev, tpl]);
  }, [formOpen, draft, setMyTemplates, t]);

  const deleteTemplate = useCallback(
    (id: string) => {
      setMyTemplates((prev) => prev.filter((tpl) => tpl.id !== id));
    },
    [setMyTemplates],
  );

  const exportConfig = useCallback(async () => {
    try {
      const map: Record<string, McpServerEntry> = {};
      for (const s of data?.servers ?? []) map[s.name] = serverInfoToEntry(s);
      const blob = new Blob(
        [JSON.stringify({ mcpServers: map, settings: data?.settings ?? {} }, null, 2)],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mcp.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [data]);

  const importConfig = useCallback(
    async (file: File) => {
      setImportError(null);
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as { mcpServers?: unknown };
        if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
          setImportError(t("mcp.importError"));
          return;
        }
        const res = await fetch("/api/mcp-config", {
          method: "PUT",
          headers: csrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ mcpServers: parsed.mcpServers }),
        });
        if (!res.ok) {
          const d = (await res.json()) as { errors?: McpFieldError[]; error?: string };
          if (d.errors) {
            setServerErrors(d.errors);
            setImportError(t("mcp.importError"));
          } else setImportError(d.error ?? `HTTP ${res.status}`);
          return;
        }
        void reload();
      } catch {
        setImportError(t("mcp.importError"));
      }
    },
    [reload, t],
  );

  if (loading)
    return (
      <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 12 }}>
        {t("common.loading")}
      </div>
    );
  if (error) return <div style={{ padding: 16, color: "#f87171", fontSize: 12 }}>{error}</div>;

  return (
    <div style={{ padding: 12, fontSize: 12, height: "100%" }}>
      {/* Header row: title + adapter status pill + refresh */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t("mcp.title")}</h3>
          {adapterStatus?.installed && (
            <div style={readyPillStyle}>
              <span style={readyDotStyle} />
              {t("mcp.adapterReady")}
              {adapterStatus.version ? (
                <span style={{ fontFamily: "var(--font-mono)", opacity: 0.7 }}>
                  {" "}
                  v{adapterStatus.version}
                </span>
              ) : null}
            </div>
          )}
        </div>
        <button onClick={() => void reload()} style={btnStyle}>
          {t("common.refresh")}
        </button>
      </div>

      {/* Adapter install status / errors */}
      {adapterChecking && (
        <div
          style={{ ...statusBannerStyle, borderColor: "var(--border)", color: "var(--text-dim)" }}
        >
          {t("mcp.adapterChecking")}
        </div>
      )}
      {adapterStatus && !adapterStatus.installed ? (
        <div
          style={{
            ...statusBannerStyle,
            borderColor: "rgba(245,158,11,0.5)",
            color: "#f59e0b",
            background: "rgba(245,158,11,0.1)",
          }}
        >
          <div>⚠ {t("mcp.adapterMissing")}</div>
          <button
            onClick={() => void handleInstallAdapter()}
            disabled={adapterInstalling}
            style={{ ...btnStyle, marginTop: 8, borderColor: "#f59e0b", color: "#f59e0b" }}
          >
            {adapterInstalling ? t("mcp.installing") : t("mcp.installPlugin")}
          </button>
        </div>
      ) : null}
      {adapterError && (
        <div
          style={{
            ...statusBannerStyle,
            borderColor: "#ef4444",
            color: "#f87171",
            background: "rgba(239,68,68,0.1)",
          }}
        >
          {t("mcp.installError")}
          {adapterError}
        </div>
      )}

      {/* Toolbar: templates / save-as-template / import / export */}
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 12,
          flexWrap: "wrap",
          position: "relative",
        }}
      >
        <button onClick={() => setShowTemplates((v) => !v)} style={btnStyle}>
          {t("mcp.templates")} ▾
        </button>
        <button
          onClick={() => void saveAsTemplate()}
          disabled={!formOpen}
          style={{ ...btnStyle, opacity: formOpen ? 1 : 0.4 }}
        >
          {t("mcp.saveAsTemplate")}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={mcpDisabled}
          style={{ ...btnStyle, opacity: mcpDisabled ? 0.4 : 1 }}
        >
          {t("mcp.import")}
        </button>
        <button
          onClick={() => void exportConfig()}
          disabled={mcpDisabled}
          style={{ ...btnStyle, opacity: mcpDisabled ? 0.4 : 1 }}
        >
          {t("mcp.export")}
        </button>
        <input
          ref={(el) => {
            fileInputRef.current = el;
          }}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importConfig(f);
            e.target.value = "";
          }}
        />
        {showTemplates && (
          <div style={templatePanelStyle}>
            <div
              style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", marginBottom: 6 }}
            >
              {t("mcp.templates")}
            </div>
            {BUILTIN_MCP_TEMPLATES.map((tpl) => (
              <TemplateRow
                key={tpl.id}
                tpl={tpl}
                onApply={() => applyTemplate(tpl)}
                onDelete={null}
              />
            ))}
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-dim)",
                margin: "10px 0 6px",
              }}
            >
              {t("mcp.myTemplates")}
            </div>
            {myTemplates.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {t("mcp.noMyTemplates")}
              </div>
            ) : (
              myTemplates.map((tpl) => (
                <TemplateRow
                  key={tpl.id}
                  tpl={tpl}
                  onApply={() => applyTemplate(tpl)}
                  onDelete={() => deleteTemplate(tpl.id)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {importError && (
        <div
          style={{
            ...statusBannerStyle,
            borderColor: "#ef4444",
            color: "#f87171",
            background: "rgba(239,68,68,0.1)",
            marginBottom: 12,
          }}
        >
          {importError}
        </div>
      )}
      {serverErrors.length > 0 && (
        <div
          style={{
            ...statusBannerStyle,
            borderColor: "#ef4444",
            color: "#f87171",
            background: "rgba(239,68,68,0.1)",
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("mcp.serverErrors")}</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {serverErrors.map((e, i) => (
              <li key={i}>
                {e.server ? <b>{e.server}</b> : "—"}
                {`: ${t(e.message)}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Server list */}
      {data && data.servers.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {data.servers.map((s) => (
            <div key={s.name} style={cardStyle}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    fontFamily: "var(--font-mono)",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.name}
                </span>
                <span
                  style={badgeStyle(s.transport === "url" ? "var(--accent)" : "var(--text-dim)")}
                >
                  {s.transport}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 4,
                  fontFamily: "var(--font-mono)",
                  wordBreak: "break-all",
                }}
              >
                {s.transport === "url" ? s.url : `${s.command} ${(s.args ?? []).join(" ")}`}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginTop: 6,
                  fontSize: 11,
                  color: "var(--text-dim)",
                  flexWrap: "wrap",
                }}
              >
                <span>
                  {t("mcp.lifecycle")}: {s.lifecycle}
                </span>
                {s.toolCount > 0 && (
                  <span>
                    {t("mcp.tools")}: {s.toolCount}
                  </span>
                )}
                {s.resourceCount > 0 && (
                  <span>
                    {t("mcp.resources")}: {s.resourceCount}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => openEdit(s)}
                  disabled={mcpDisabled}
                  style={{ ...btnStyle, opacity: mcpDisabled ? 0.4 : 1 }}
                >
                  {t("mcp.editServer")}
                </button>
                <button
                  onClick={() => void handleRemove(s.name)}
                  disabled={mcpDisabled}
                  style={{ ...btnStyle, color: "#f87171", opacity: mcpDisabled ? 0.4 : 1 }}
                >
                  {t("common.remove")}
                </button>
              </div>
              {s.transport === "stdio" ? (
                <EnvProvisionButton
                  capability={{
                    kind: "mcp",
                    id: s.name,
                    label: s.name,
                    command: s.command,
                    args: s.args,
                    env: s.env,
                    cwd,
                  }}
                  cwd={cwd}
                  disabled={mcpDisabled}
                  runToken={envRunTokens[s.name]}
                  fullScan
                />
              ) : (
                <EnvProvisionButton
                  capability={{
                    kind: "mcp",
                    id: s.name,
                    label: s.name,
                    url: s.url,
                  }}
                  cwd={cwd}
                  disabled={mcpDisabled}
                  runToken={envRunTokens[s.name]}
                  fullScan
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: "var(--text-dim)", marginBottom: 12 }}>{t("mcp.noServers")}</div>
      )}

      {/* Add button */}
      {!formOpen && (
        <button
          onClick={() => openAdd()}
          disabled={mcpDisabled}
          style={{ ...btnStyle, opacity: mcpDisabled ? 0.4 : 1 }}
        >
          {t("mcp.addServer")}
        </button>
      )}

      {/* Add / Edit form */}
      {formOpen && (
        <div style={{ ...cardStyle, borderColor: "var(--accent)" }}>
          <input
            placeholder={t("mcp.serverName")}
            value={draft.name}
            onChange={(e) => updateDraft({ name: e.target.value })}
            style={{ ...inputStyle, borderColor: draftErrors.name ? "#ef4444" : "var(--border)" }}
          />
          {draftErrors.name && <div style={errTextStyle}>{t(draftErrors.name)}</div>}

          {/* Transport segmented control */}
          <div style={{ display: "flex", gap: 6, margin: "10px 0 8px" }}>
            {(["stdio", "url"] as const).map((tp) => (
              <button
                key={tp}
                onClick={() => updateDraft({ transport: tp })}
                style={{
                  ...btnStyle,
                  flex: 1,
                  borderColor: draft.transport === tp ? "var(--accent)" : "var(--border)",
                  color: draft.transport === tp ? "var(--accent)" : "var(--text)",
                  background: draft.transport === tp ? "var(--bg-hover)" : "var(--bg)",
                  fontWeight: 600,
                }}
              >
                {tp === "stdio" ? t("mcp.stdio") : t("mcp.url")}
              </button>
            ))}
          </div>

          {/* Basic group */}
          {draft.transport === "url" ? (
            <>
              <div style={labelStyle}>{t("mcp.url")}</div>
              <input
                placeholder="https://..."
                value={draft.url}
                onChange={(e) => updateDraft({ url: e.target.value })}
                style={{
                  ...inputStyle,
                  borderColor: draftErrors.url ? "#ef4444" : "var(--border)",
                }}
              />
              {draftErrors.url && <div style={errTextStyle}>{t(draftErrors.url)}</div>}
            </>
          ) : (
            <>
              <div style={labelStyle}>{t("mcp.command")}</div>
              <input
                list="mcp-cmd-suggestions"
                placeholder="npx"
                value={draft.command}
                onChange={(e) => updateDraft({ command: e.target.value })}
                style={{
                  ...inputStyle,
                  borderColor: draftErrors.command ? "#ef4444" : "var(--border)",
                }}
              />
              {draftErrors.command && <div style={errTextStyle}>{t(draftErrors.command)}</div>}
              <datalist id="mcp-cmd-suggestions">
                {COMMAND_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <div style={labelStyle}>{t("mcp.args")}</div>
              <input
                placeholder="-y @modelcontextprotocol/server-filesystem ."
                value={draft.argsText}
                onChange={(e) => updateDraft({ argsText: e.target.value })}
                style={inputStyle}
              />
            </>
          )}

          {/* Test connection */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => void handleTest()}
              disabled={testing || mcpDisabled}
              style={{ ...btnStyle, opacity: testing || mcpDisabled ? 0.4 : 1 }}
            >
              {testing ? t("mcp.testing") : t("mcp.testConnection")}
            </button>
            {probe && (
              <span style={probe.reachable ? probeOkStyle : probeErrStyle}>
                {probe.reachable ? "✓ " : "✗ "}
                {t(probe.detail)}
                {probe.latencyMs != null ? ` · ${probe.latencyMs}ms` : ""}
              </span>
            )}
          </div>

          {/* Advanced group (collapsible) */}
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            style={{ ...btnStyle, marginTop: 12, width: "100%", textAlign: "left" }}
          >
            {showAdvanced ? "▾ " : "▸ "}
            {t("mcp.advanced")}
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 8 }}>
              <div style={labelStyle}>{t("mcp.lifecycle")}</div>
              <select
                value={draft.lifecycle}
                onChange={(e) => updateDraft({ lifecycle: e.target.value })}
                style={selectStyle}
              >
                {LIFECYCLES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>

              <div style={labelStyle}>{t("mcp.idleTimeout")}</div>
              <input
                placeholder="0"
                value={draft.idleTimeout}
                onChange={(e) => updateDraft({ idleTimeout: e.target.value })}
                style={{
                  ...inputStyle,
                  borderColor: draftErrors.idleTimeout ? "#ef4444" : "var(--border)",
                }}
              />
              {draftErrors.idleTimeout && (
                <div style={errTextStyle}>{t(draftErrors.idleTimeout)}</div>
              )}

              <div style={labelStyle}>{t("mcp.requestTimeoutMs")}</div>
              <input
                placeholder="0"
                value={draft.requestTimeoutMs}
                onChange={(e) => updateDraft({ requestTimeoutMs: e.target.value })}
                style={{
                  ...inputStyle,
                  borderColor: draftErrors.requestTimeoutMs ? "#ef4444" : "var(--border)",
                }}
              />
              {draftErrors.requestTimeoutMs && (
                <div style={errTextStyle}>{t(draftErrors.requestTimeoutMs)}</div>
              )}

              <div style={labelStyle}>{t("mcp.env")}</div>
              <textarea
                placeholder={"KEY=VALUE\nTOKEN=abc"}
                value={draft.envText}
                onChange={(e) => updateDraft({ envText: e.target.value })}
                rows={3}
                style={textareaStyle}
              />

              {draft.transport === "url" && (
                <>
                  <div style={labelStyle}>{t("mcp.headers")}</div>
                  <textarea
                    placeholder={"Authorization: Bearer …\nX-Key: …"}
                    value={draft.headersText}
                    onChange={(e) => updateDraft({ headersText: e.target.value })}
                    rows={3}
                    style={textareaStyle}
                  />
                </>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={() => void handleSave()}
              disabled={saving || mcpDisabled}
              style={{ ...btnStyle, opacity: saving || mcpDisabled ? 0.4 : 1 }}
            >
              {saving ? t("common.saving") : t("mcp.save")}
            </button>
            <button onClick={() => closeForm()} style={btnStyle}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {data?.configPath && (
        <div
          style={{
            marginTop: 12,
            fontSize: 10,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            wordBreak: "break-all",
          }}
        >
          {data.configPath}
        </div>
      )}
    </div>
  );
}

function TemplateRow({
  tpl,
  onApply,
  onDelete,
}: {
  tpl: McpTemplate;
  onApply: () => void;
  onDelete: (() => void) | null;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 0",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{tpl.label}</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{tpl.description}</div>
      </div>
      <button onClick={onApply} style={btnStyle}>
        {t("mcp.applyTemplate")}
      </button>
      {onDelete && (
        <button onClick={onDelete} style={{ ...btnStyle, color: "#f87171" }}>
          {t("mcp.deleteTemplate")}
        </button>
      )}
    </div>
  );
}

const statusBannerStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 10,
  marginBottom: 12,
  fontSize: 12,
};
const readyPillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "2px 9px",
  borderRadius: 999,
  fontSize: 11,
  lineHeight: 1,
  fontWeight: 500,
  color: "#16a34a",
  background: "rgba(16,163,74,0.1)",
  border: "1px solid rgba(16,163,74,0.28)",
  fontFamily: "var(--font-mono)",
};
const readyDotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: "#16a34a",
  boxShadow: "0 0 0 3px rgba(16,163,74,0.18)",
};
const btnStyle: React.CSSProperties = {
  background: "var(--bg-hover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "5px 12px",
  fontSize: 11,
  color: "var(--text)",
  cursor: "pointer",
};
const cardStyle: React.CSSProperties = {
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 10,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  color: "var(--text)",
  boxSizing: "border-box",
};
const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  fontSize: 11,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  color: "var(--text)",
  boxSizing: "border-box",
};
const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  color: "var(--text)",
  boxSizing: "border-box",
  resize: "vertical",
};
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-dim)",
  margin: "8px 0 4px",
};
const errTextStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#f87171",
  marginTop: 3,
};
const templatePanelStyle: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  zIndex: 20,
  marginTop: 4,
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 10,
  boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
  maxHeight: 320,
  overflowY: "auto",
};
const probeOkStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#16a34a",
  fontFamily: "var(--font-mono)",
};
const probeErrStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#f87171",
  fontFamily: "var(--font-mono)",
};
function badgeStyle(color: string): React.CSSProperties {
  return {
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 3,
    background: `${color}22`,
    color,
    fontWeight: 600,
  };
}
