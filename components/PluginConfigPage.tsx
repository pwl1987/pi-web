"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useAsync } from "@/hooks/useAsync";
import { useSave } from "@/hooks/useSave";
import {
  PLUGIN_CONFIG_DESCRIPTORS,
  type PluginConfigDescriptor,
  type PluginConfigField,
} from "@/lib/plugin-config-descriptors";
import { csrfFetchJson } from "@/lib/csrf-fetch";
import { errorBoxStylePre } from "@/lib/styles";

type ConfigValue = string | number | boolean | string[];
type ConfigState = Record<string, ConfigValue>;

// ---------------------------------------------------------------------------
// Field renderers
// ---------------------------------------------------------------------------

function ToggleField({
  field,
  value,
  onChange,
}: {
  field: PluginConfigField;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      style={{
        width: 40,
        height: 22,
        borderRadius: 11,
        border: "none",
        padding: 0,
        cursor: "pointer",
        background: value ? "var(--accent)" : "var(--border)",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: value ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--bg)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
          transition: "left 0.18s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
}

function SelectField({
  field,
  value,
  onChange,
  multiple,
}: {
  field: PluginConfigField;
  value: string | string[];
  onChange: (v: string | string[]) => void;
  multiple?: boolean;
}) {
  if (multiple) {
    const selected = Array.isArray(value) ? value : [];
    const toggle = (v: string) =>
      onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {field.options?.map((opt) => {
          const on = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              title={opt.description}
              style={{
                padding: "5px 10px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                cursor: "pointer",
                fontSize: 12,
                background: on ? "var(--accent)" : "none",
                color: on ? "var(--bg)" : "var(--text-muted)",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <select
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "6px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg)",
        color: "var(--text)",
        fontSize: 13,
        minWidth: 180,
      }}
    >
      {field.options?.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function ListField({
  field,
  value,
  onChange,
}: {
  field: PluginConfigField;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <textarea
      value={value.join("\n")}
      placeholder={field.placeholder}
      onChange={(e) =>
        onChange(
          e.target.value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        )
      }
      rows={3}
      style={{
        width: "100%",
        padding: "6px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg)",
        color: "var(--text)",
        fontSize: 13,
        fontFamily: "var(--font-mono)",
        resize: "vertical",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function PluginConfigPage({
  source,
  name,
  onClose,
}: {
  source: string;
  name: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const descriptor: PluginConfigDescriptor | undefined =
    PLUGIN_CONFIG_DESCRIPTORS[source] ??
    PLUGIN_CONFIG_DESCRIPTORS[`npm:${source.replace(/^npm:/, "")}`];

  const [values, setValues] = useState<ConfigState | null>(null);
  const { saving, startSave, endSave } = useSave();
  const [message, setMessage] = useState<string | null>(null);
  const { loading, error, setError, run } = useAsync(undefined, { initialLoading: true });

  const load = useCallback(async () => {
    try {
      const { ok, status, data } = await csrfFetchJson<{
        values: ConfigState;
        error?: string;
      }>(`/api/plugins/config?source=${encodeURIComponent(source)}`, { method: "GET" });
      if (!ok) throw new Error(data.error ?? `HTTP ${status}`);
      setValues(data.values);
    } catch (e) {
      throw e;
    }
  }, [source]);

  useEffect(() => {
    void run(load);
  }, [load, run]);

  const setField = (key: string, v: ConfigValue) =>
    setValues((prev) => (prev ? { ...prev, [key]: v } : prev));

  const save = async () => {
    if (!values) return;
    startSave();
    setError(null);
    setMessage(null);
    try {
      const { ok, status, data } = await csrfFetchJson<{ error?: string }>(
        `/api/plugins/config?source=${encodeURIComponent(source)}`,
        { method: "PUT", body: { values } },
      );
      if (!ok) throw new Error(data.error ?? `HTTP ${status}`);
      setMessage(t("plugins.configSaved"));
      endSave(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      endSave(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 680 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onClose} style={linkBtn} aria-label={t("plugins.close")}>
          ← {t("plugins.back")}
        </button>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-dim)" }}>
          {source}
        </span>
      </div>

      <div>
        <h3 style={{ margin: 0, fontSize: 18 }}>{name}</h3>
        {descriptor?.summary && (
          <p
            style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}
          >
            {descriptor.summary}
          </p>
        )}
      </div>

      {loading && (
        <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{t("plugins.loading")}</div>
      )}

      {!loading && error && <div style={errorBoxStylePre}>{error}</div>}

      {!loading && values && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {descriptor?.fields.map((field) => (
            <div
              key={field.key}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(180px, 220px) minmax(0, 1fr)",
                gap: "8px 16px",
                alignItems: "start",
                borderTop: "1px solid var(--border)",
                paddingTop: 16,
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{field.label}</div>
                {field.help && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-dim)",
                      marginTop: 4,
                      lineHeight: 1.4,
                    }}
                  >
                    {field.help}
                  </div>
                )}
              </div>
              <div>
                {field.type === "toggle" && (
                  <ToggleField
                    field={field}
                    value={Boolean(values[field.key])}
                    onChange={(v) => setField(field.key, v)}
                  />
                )}
                {(field.type === "select" || field.type === "multiselect") && (
                  <SelectField
                    field={field}
                    value={
                      field.type === "multiselect"
                        ? ((values[field.key] as string[]) ?? [])
                        : String(values[field.key] ?? "")
                    }
                    multiple={field.type === "multiselect"}
                    onChange={(v) => setField(field.key, v as ConfigValue)}
                  />
                )}
                {field.type === "text" && (
                  <input
                    value={String(values[field.key] ?? "")}
                    placeholder={field.placeholder}
                    onChange={(e) => setField(field.key, e.target.value)}
                    style={textInput}
                  />
                )}
                {field.type === "number" && (
                  <input
                    type="number"
                    value={Number(values[field.key] ?? 0)}
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 1}
                    onChange={(e) => setField(field.key, Number(e.target.value))}
                    style={{ ...textInput, maxWidth: 140 }}
                  />
                )}
                {field.type === "list" && (
                  <ListField
                    field={field}
                    value={(values[field.key] as string[]) ?? []}
                    onChange={(v) => setField(field.key, v)}
                  />
                )}
              </div>
            </div>
          ))}

          {!descriptor && (
            <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
              {t("plugins.configNoOptions")}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 8 }}>
            <button
              onClick={save}
              disabled={saving || !descriptor}
              style={{
                padding: "7px 16px",
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "var(--bg)",
                cursor: saving || !descriptor ? "not-allowed" : "pointer",
                fontSize: 13,
                opacity: saving || !descriptor ? 0.6 : 1,
              }}
            >
              {saving ? t("plugins.configSaving") : t("plugins.configSave")}
            </button>
            {message && <span style={{ fontSize: 12, color: "#16a34a" }}>{message}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 13,
  padding: 0,
};

const textInput: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 13,
};
