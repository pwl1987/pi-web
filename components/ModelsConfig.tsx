"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { useAsync } from "@/hooks/useAsync";
import { useSave } from "@/hooks/useSave";
import { ConfigListRow, ModalButton, SaveButton } from "@/components/ui/ConfigModal";
import { csrfFetchJson } from "@/lib/csrf-fetch";
import type {
  ModelEntry,
  ProviderEntry,
  ModelsJson,
  OAuthProvider,
  ApiKeyProvider,
  OAuthLoginState,
  ModelTestState,
  Selection,
  AddProviderPickerProps,
} from "./ModelsConfig.types";
import { API_OPTIONS } from "./ModelsConfig.types";
import { ProviderIcon } from "./ProviderIcon";
import {
  Field,
  TextInput,
  SecretTextInput,
  NumInput,
  Select,
  Check,
  SectionTitle,
} from "./FormFields";

// ── Provider detail ───────────────────────────────────────────────────────────

function ProviderDetail({
  name,
  provider,
  onChange,
  onRename,
  onDelete,
}: {
  name: string;
  provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void;
  onRename: (n: string) => void;
  onDelete: () => void;
}) {
  const [editingName, setEditingName] = useState(name);
  useEffect(() => setEditingName(name), [name]);
  const { t } = useI18n();
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) =>
    onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.api]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("models.provider")}</SectionTitle>
        <button
          onClick={onDelete}
          style={{
            padding: "3px 8px",
            background: "none",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 4,
            color: "#ef4444",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          {t("models.delete")}
        </button>
      </div>

      <Field label={t("models.providerName")}>
        <TextInput value={editingName} onChange={setEditingName} placeholder="provider-name" mono />
        {editingName !== name && editingName.trim() && (
          <button
            onClick={() => onRename(editingName.trim())}
            style={{
              marginTop: 4,
              padding: "3px 10px",
              background: "var(--accent)",
              border: "none",
              borderRadius: 4,
              color: "#fff",
              cursor: "pointer",
              fontSize: 11,
              alignSelf: "flex-start",
            }}
          >
            {t("models.rename")}
          </button>
        )}
      </Field>

      <Field label={t("models.baseUrl")}>
        <TextInput
          value={provider.baseUrl ?? ""}
          onChange={(v) => set("baseUrl", v || undefined)}
          placeholder="https://api.example.com/v1"
          mono
        />
      </Field>

      <Field label={t("models.apiKey")}>
        <SecretTextInput
          value={provider.apiKey ?? ""}
          onChange={(v) => set("apiKey", v || undefined)}
          placeholder="ENV_VAR_NAME, !shell-command, or literal key"
          mono
        />
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          {t("models.apiKeyHintBefore")}
          <code style={{ fontFamily: "var(--font-mono)" }}>!</code>
          {t("models.apiKeyHintAfter")}
        </span>
      </Field>

      <Field label={t("models.api")}>
        <Select
          value={provider.api ?? "openai-completions"}
          onChange={(v) => set("api", v)}
          options={API_OPTIONS}
          required
        />
      </Field>
    </div>
  );
}

// ── ThinkingLevelMap editor ───────────────────────────────────────────────────

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const LEVEL_COLORS: Record<ThinkingLevel, string> = {
  off: "var(--text-dim)",
  minimal: "#6b7280",
  low: "#60a5fa",
  medium: "#a78bfa",
  high: "#f472b6",
  xhigh: "#fb923c",
};

function ThinkingLevelMapEditor({
  value,
  onChange,
}: {
  value: Record<string, string | null> | undefined;
  onChange: (v: Record<string, string | null> | undefined) => void;
}) {
  const { t } = useI18n();
  const map = value ?? {};

  const setLevel = (level: ThinkingLevel, entry: string | null | "omit") => {
    const next = { ...map };
    if (entry === "omit") {
      delete next[level];
    } else {
      next[level] = entry;
    }
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const state: "omit" | "null" | "string" = !(level in map)
          ? "omit"
          : raw === null
            ? "null"
            : "string";
        const strVal = typeof raw === "string" ? raw : "";
        const color = LEVEL_COLORS[level];

        const btnBase: React.CSSProperties = {
          padding: "4px 10px",
          fontSize: 10,
          border: "none",
          cursor: "pointer",
          fontWeight: 400,
          transition: "background 0.1s, color 0.1s",
          whiteSpace: "nowrap",
          background: "var(--bg-panel)",
          color: "var(--text-dim)",
        };
        const btnActive: React.CSSProperties = {
          background: "var(--accent)",
          color: "#fff",
          fontWeight: 600,
        };
        const btnActiveDisabled: React.CSSProperties = {
          background: "#ef4444",
          color: "#fff",
          fontWeight: 600,
        };

        return (
          <div
            key={level}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 4px",
              borderRadius: 6,
              background: "transparent",
              border: "1px solid transparent",
            }}
          >
            {/* Level badge */}
            <div
              style={{ display: "flex", alignItems: "center", gap: 5, width: 68, flexShrink: 0 }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: color,
                  flexShrink: 0,
                  opacity: state === "null" ? 0.3 : 1,
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  color: state === "null" ? "var(--text-dim)" : "var(--text-muted)",
                  textDecoration: state === "null" ? "line-through" : "none",
                }}
              >
                {level}
              </span>
            </div>

            {/* Default + Disabled buttons */}
            <div
              style={{
                display: "flex",
                borderRadius: 5,
                border: "1px solid var(--border)",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              <button
                onClick={() => setLevel(level, "omit")}
                style={{ ...btnBase, ...(state === "omit" ? btnActive : {}) }}
              >
                {t("models.default")}
              </button>
              <button
                onClick={() => setLevel(level, null)}
                style={{
                  ...btnBase,
                  borderLeft: "1px solid var(--border)",
                  ...(state === "null" ? btnActiveDisabled : {}),
                }}
              >
                {t("models.disabled")}
              </button>
            </div>

            {/* Custom button + input fused */}
            <div
              style={{
                display: "flex",
                borderRadius: 5,
                border: `1px solid ${state === "string" ? "var(--accent)" : "var(--border)"}`,
                overflow: "hidden",
                transition: "border-color 0.1s",
              }}
            >
              <button
                onClick={() => setLevel(level, strVal || level)}
                style={{
                  ...btnBase,
                  ...(state === "string" ? btnActive : {}),
                  borderRight: "1px solid var(--border)",
                  flexShrink: 0,
                }}
              >
                {t("models.custom")}
              </button>
              <input
                value={strVal}
                onChange={(e) => setLevel(level, e.target.value)}
                onFocus={() => {
                  if (state !== "string") setLevel(level, strVal || level);
                }}
                placeholder={level}
                maxLength={10}
                style={{
                  width: "12ch",
                  background: state === "string" ? "var(--bg)" : "var(--bg-panel)",
                  border: "none",
                  outline: "none",
                  color: state === "string" ? "var(--text)" : "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  padding: "4px 7px",
                  transition: "background 0.1s, color 0.1s",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Model detail ──────────────────────────────────────────────────────────────

const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

function ModelDetail({
  providerName,
  provider,
  model,
  onChange,
  onDelete,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  onChange: (m: ModelEntry) => void;
  onDelete: () => void;
}) {
  const [testState, setTestState] = useState<ModelTestState>({ phase: "idle" });
  const { t } = useI18n();
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) =>
    onChange({ ...model, [k]: v });
  const costVal = (k: keyof NonNullable<ModelEntry["cost"]>) =>
    model.cost?.[k] !== undefined ? String(model.cost[k]) : "";
  const setCost = (k: keyof NonNullable<ModelEntry["cost"]>, v: string) => {
    const n = parseFloat(v);
    onChange({ ...model, cost: { ...(model.cost ?? {}), [k]: isNaN(n) ? undefined : n } });
  };
  const testSummary = (() => {
    if (testState.phase === "idle") return null;
    if (testState.phase === "testing") return t("models.testingConnection");
    const meta = [
      testState.latencyMs !== undefined ? `${testState.latencyMs}ms` : null,
      testState.status !== undefined ? `HTTP ${testState.status}` : null,
    ].filter(Boolean);
    if (testState.phase === "success") {
      return [t("models.connected"), ...meta, testState.responseText || null]
        .filter(Boolean)
        .join(" · ");
    }
    return [t("models.failed"), ...meta, testState.message].filter(Boolean).join(" · ");
  })();

  useEffect(() => {
    setTestState({ phase: "idle" });
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey, model.id, model.api]);

  const handleTest = useCallback(async () => {
    if (!model.id.trim() || testState.phase === "testing") return;
    setTestState({ phase: "testing" });
    try {
      const {
        ok,
        status,
        data: d,
      } = await csrfFetchJson<{
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      }>("/api/models-config/test", {
        method: "POST",
        body: { providerName, provider, model },
      });
      if (!ok || !d.ok) {
        setTestState({
          phase: "error",
          message: d.error ?? `HTTP ${status}`,
          latencyMs: d.latencyMs,
          status: d.status,
        });
        return;
      }
      setTestState({
        phase: "success",
        latencyMs: d.latencyMs,
        status: d.status,
        responseText: d.responseText,
      });
    } catch (e) {
      setTestState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [model, provider, providerName, testState.phase]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("models.model")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {testSummary && (
            <span
              title={testSummary}
              style={{
                maxWidth: 260,
                height: 24,
                padding: "0 8px",
                border: `1px solid ${testState.phase === "error" ? "#fecaca" : testState.phase === "success" ? "#bbf7d0" : "var(--border)"}`,
                borderRadius: 4,
                background:
                  testState.phase === "error"
                    ? "#fee2e2"
                    : testState.phase === "success"
                      ? "#dcfce7"
                      : "#e5e7eb",
                color: "#111827",
                fontSize: 11,
                display: "inline-flex",
                alignItems: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                boxSizing: "border-box",
              }}
            >
              {testSummary}
            </span>
          )}
          <button
            onClick={handleTest}
            disabled={!model.id.trim() || testState.phase === "testing"}
            title={t("models.testConnection")}
            style={{
              height: 24,
              padding: "0 8px",
              background: testState.phase === "success" ? "#16a34a" : "none",
              border: `1px solid ${testState.phase === "success" ? "#16a34a" : "var(--border)"}`,
              borderRadius: 4,
              color:
                testState.phase === "success"
                  ? "#fff"
                  : !model.id.trim() || testState.phase === "testing"
                    ? "var(--text-dim)"
                    : "var(--text-muted)",
              cursor: !model.id.trim() || testState.phase === "testing" ? "not-allowed" : "pointer",
              fontSize: 11,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              gap: 5,
            }}
          >
            {testState.phase === "success" && (
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {testState.phase === "testing"
              ? t("models.testing")
              : testState.phase === "success"
                ? t("models.ok")
                : t("models.test")}
          </button>
          <button
            onClick={onDelete}
            style={{
              height: 24,
              padding: "0 8px",
              background: "none",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 4,
              color: "#ef4444",
              cursor: "pointer",
              fontSize: 11,
              boxSizing: "border-box",
            }}
          >
            {t("models.remove")}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("models.idRequired")}>
          <TextInput value={model.id} onChange={(v) => set("id", v)} placeholder="model-id" mono />
        </Field>
        <Field label={t("models.name")}>
          <TextInput
            value={model.name ?? ""}
            onChange={(v) => set("name", v || undefined)}
            placeholder={t("models.displayName")}
          />
        </Field>
      </div>

      <Field label={t("models.apiOverride")}>
        <Select
          value={model.api ?? ""}
          onChange={(v) => set("api", v || undefined)}
          options={API_OPTIONS}
        />
      </Field>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Check
          label={t("models.reasoningThinking")}
          checked={model.reasoning ?? false}
          onChange={(v) => set("reasoning", v || undefined)}
        />
        <Check
          label={t("models.imageInput")}
          checked={model.input?.includes("image") ?? false}
          onChange={(v) => set("input", v ? ["text", "image"] : undefined)}
        />
      </div>

      {model.reasoning && (
        <>
          <Check
            label={t("models.deepseekCompat")}
            checked={hasDeepseekCompat(model)}
            onChange={(v) => onChange(setDeepseekCompat(model, v))}
          />
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <SectionTitle>{t("models.thinkingLevelMap")}</SectionTitle>
              {model.thinkingLevelMap && (
                <button
                  onClick={() => set("thinkingLevelMap", undefined)}
                  style={{
                    fontSize: 10,
                    padding: "2px 7px",
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    color: "var(--text-dim)",
                    cursor: "pointer",
                  }}
                >
                  {t("models.clearAll")}
                </button>
              )}
            </div>
            <ThinkingLevelMapEditor
              value={model.thinkingLevelMap}
              onChange={(v) => set("thinkingLevelMap", v)}
            />
          </div>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("models.contextWindow")}>
          <NumInput
            value={model.contextWindow !== undefined ? String(model.contextWindow) : ""}
            onChange={(v) => set("contextWindow", v ? parseInt(v) : undefined)}
            placeholder="128000"
          />
        </Field>
        <Field label={t("models.maxOutputTokens")}>
          <NumInput
            value={model.maxTokens !== undefined ? String(model.maxTokens) : ""}
            onChange={(v) => set("maxTokens", v ? parseInt(v) : undefined)}
            placeholder="16384"
          />
        </Field>
      </div>

      <div>
        <SectionTitle>{t("models.costPerMillion")}</SectionTitle>
        <div
          style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}
        >
          {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => (
            <Field key={k} label={k}>
              <NumInput value={costVal(k)} onChange={(v) => setCost(k, v)} placeholder="0" />
            </Field>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── OAuth detail ──────────────────────────────────────────────────────────────

function OAuthDetail({ provider, onRefresh }: { provider: OAuthProvider; onRefresh: () => void }) {
  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const [inputValue, setInputValue] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loginState.phase]);

  // Reset state when provider changes
  useEffect(() => {
    setLoginState({ phase: "idle" });
    setInputValue("");
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, [provider.id]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const handleLogin = useCallback(() => {
    eventSourceRef.current?.close();
    setLoginState({ phase: "connecting" });
    setInputValue("");

    const es = new EventSource(`/api/auth/login/${encodeURIComponent(provider.id)}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        type: string;
        url?: string;
        instructions?: string | null;
        token?: string;
        message?: string;
        placeholder?: string | null;
        userCode?: string;
        verificationUri?: string;
        intervalSeconds?: number | null;
        expiresInSeconds?: number | null;
        options?: Array<{ id: string; label: string }>;
      };
      if (data.type === "auth") {
        setLoginState({
          phase: "auth",
          url: data.url!,
          instructions: data.instructions ?? null,
          token: data.token!,
        });
        window.open(data.url!, "_blank", "noopener,noreferrer");
      } else if (data.type === "device_code") {
        setLoginState({
          phase: "device_code",
          userCode: data.userCode!,
          verificationUri: data.verificationUri!,
          intervalSeconds: data.intervalSeconds ?? null,
          expiresInSeconds: data.expiresInSeconds ?? null,
        });
        window.open(data.verificationUri!, "_blank", "noopener,noreferrer");
      } else if (data.type === "prompt_request") {
        setLoginState({
          phase: "prompt",
          message: data.message!,
          placeholder: data.placeholder ?? null,
          token: data.token!,
        });
      } else if (data.type === "select_request") {
        setLoginState({
          phase: "select",
          message: data.message!,
          options: data.options ?? [],
          token: data.token!,
        });
      } else if (data.type === "progress") {
        setLoginState({ phase: "progress", message: data.message! });
      } else if (data.type === "success") {
        es.close();
        setLoginState({ phase: "success" });
        onRefresh();
      } else if (data.type === "error") {
        es.close();
        setLoginState({ phase: "error", message: data.message! });
      } else if (data.type === "cancelled") {
        es.close();
        setLoginState({ phase: "idle" });
      }
    };
    es.onerror = () => {
      es.close();
      setLoginState((prev) =>
        prev.phase === "success" ? prev : { phase: "error", message: t("models.connectionLost") },
      );
    };
  }, [provider.id, onRefresh, t]);

  const handleLogout = useCallback(async () => {
    await csrfFetchJson(`/api/auth/logout/${encodeURIComponent(provider.id)}`, {
      method: "POST",
    });
    setLoginState({ phase: "idle" });
    onRefresh();
  }, [provider.id, onRefresh]);

  const submitCode = useCallback(
    async (token: string, code: string) => {
      if (!code.trim()) return;
      setLoginState({ phase: "progress", message: t("models.verifying") });
      try {
        const {
          ok,
          status,
          data: d,
        } = await csrfFetchJson<{ error?: string }>(
          `/api/auth/login/${encodeURIComponent(provider.id)}`,
          { method: "POST", body: { token, code: code.trim() } },
        );
        if (!ok) {
          setLoginState({ phase: "error", message: d.error ?? `Server error ${status}` });
          return;
        }
        setInputValue("");
        // Success path: SSE stream will emit "success" and update state
      } catch (e) {
        setLoginState({
          phase: "error",
          message: e instanceof Error ? e.message : t("models.networkError"),
        });
      }
    },
    [provider.id, t],
  );

  const submitSelection = useCallback(
    async (token: string, value: string) => {
      setLoginState({ phase: "progress", message: t("models.continuing") });
      try {
        const {
          ok,
          status,
          data: d,
        } = await csrfFetchJson<{ error?: string }>(
          `/api/auth/login/${encodeURIComponent(provider.id)}`,
          { method: "POST", body: { token, code: value } },
        );
        if (!ok) {
          setLoginState({ phase: "error", message: d.error ?? `Server error ${status}` });
        }
      } catch (e) {
        setLoginState({
          phase: "error",
          message: e instanceof Error ? e.message : t("models.networkError"),
        });
      }
    },
    [provider.id, t],
  );

  const isWorking =
    loginState.phase === "connecting" ||
    loginState.phase === "progress" ||
    loginState.phase === "auth" ||
    loginState.phase === "device_code" ||
    loginState.phase === "prompt" ||
    loginState.phase === "select";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("models.subscription")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: provider.loggedIn ? "#4ade80" : "var(--border)",
              display: "inline-block",
            }}
          />
          <span style={{ fontSize: 11, color: provider.loggedIn ? "#4ade80" : "var(--text-dim)" }}>
            {provider.loggedIn ? t("models.statusConnected") : t("models.notConnected")}
          </span>
        </div>
      </div>

      {/* Status */}
      <div style={{ minHeight: 48 }}>
        {loginState.phase === "idle" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {provider.loggedIn
              ? t("models.alreadyConnected")
              : t("models.connectAccount", { name: provider.name })}
          </p>
        )}
        {loginState.phase === "connecting" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
            {t("models.openingBrowser")}
          </p>
        )}
        {loginState.phase === "select" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.message}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {loginState.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => submitSelection(loginState.token, option.id)}
                  style={{
                    padding: "6px 9px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    color: "var(--text)",
                    cursor: "pointer",
                    fontSize: 12,
                    textAlign: "left",
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {(loginState.phase === "auth" || loginState.phase === "prompt") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.phase === "auth" ? t("models.completeSignIn") : loginState.message}
            </p>
            {loginState.phase === "auth" && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
                {t("models.browserDidNotOpenBefore")}{" "}
                <a
                  href={loginState.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", wordBreak: "break-all" }}
                >
                  {t("models.clickToOpenLogin")}
                </a>
                {t("models.browserDidNotOpenAfter")}
              </p>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitCode(loginState.token, inputValue);
                }}
                placeholder={
                  loginState.phase === "auth"
                    ? "http://localhost:1455/auth/callback?code=…"
                    : (loginState.placeholder ?? t("models.enterValue"))
                }
                style={{
                  flex: 1,
                  padding: "6px 9px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  color: "var(--text)",
                  fontSize: 12,
                  outline: "none",
                  fontFamily: "var(--font-mono)",
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={() => submitCode(loginState.token, inputValue)}
                disabled={!inputValue.trim()}
                style={{
                  padding: "6px 12px",
                  background: inputValue.trim() ? "var(--accent)" : "var(--bg-panel)",
                  border: "none",
                  borderRadius: 5,
                  color: inputValue.trim() ? "#fff" : "var(--text-dim)",
                  cursor: inputValue.trim() ? "pointer" : "not-allowed",
                  fontSize: 12,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {t("models.submit")}
              </button>
            </div>
          </div>
        )}
        {loginState.phase === "device_code" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {t("models.openVerificationPage")}
            </p>
            <div
              style={{
                padding: "8px 10px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 5,
                color: "var(--text)",
                fontSize: 16,
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                letterSpacing: 0,
              }}
            >
              {loginState.userCode}
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              <a
                href={loginState.verificationUri}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)", wordBreak: "break-all" }}
              >
                {loginState.verificationUri}
              </a>
              {loginState.expiresInSeconds
                ? ` ${t("models.expiresInMinutes", { count: Math.ceil(loginState.expiresInSeconds / 60) })}`
                : ""}
            </p>
          </div>
        )}
        {loginState.phase === "progress" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
            {loginState.message}
          </p>
        )}
        {loginState.phase === "success" && (
          <p style={{ margin: 0, fontSize: 12, color: "#4ade80" }}>
            {t("models.connectedSuccessfully")}
          </p>
        )}
        {loginState.phase === "error" && (
          <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>{loginState.message}</p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        {isWorking ? (
          <button
            onClick={() => {
              eventSourceRef.current?.close();
              setLoginState({ phase: "idle" });
            }}
            style={{
              padding: "5px 12px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 5,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {t("models.cancel")}
          </button>
        ) : (
          <>
            <button
              onClick={handleLogin}
              style={{
                padding: "5px 14px",
                background: "var(--accent)",
                border: "none",
                borderRadius: 5,
                color: "#fff",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {provider.loggedIn ? t("models.relogin") : t("models.login")}
            </button>
            {provider.loggedIn && (
              <button
                onClick={handleLogout}
                style={{
                  padding: "5px 12px",
                  background: "none",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 5,
                  color: "#ef4444",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {t("models.disconnect")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── API Key detail ────────────────────────────────────────────────────────────

function ApiKeyDetail({
  provider,
  onRefresh,
}: {
  provider: ApiKeyProvider;
  onRefresh: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { saving, savedOk, startSave, endSave } = useSave();
  const { t } = useI18n();

  // Reset state when provider changes
  useEffect(() => {
    setApiKey("");
    setError(null);
    endSave(false);
  }, [provider.id, endSave]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    startSave();
    setError(null);
    try {
      const {
        ok,
        status,
        data: d,
      } = await csrfFetchJson<{ success?: boolean; error?: string }>(
        `/api/auth/api-key/${encodeURIComponent(provider.id)}`,
        { method: "POST", body: { apiKey: apiKey.trim() } },
      );
      if (!ok || d.error) {
        setError(d.error ?? `HTTP ${status}`);
        endSave(false);
      } else {
        setApiKey("");
        endSave(true);
        onRefresh();
      }
    } catch (e) {
      setError(String(e));
      endSave(false);
    }
  }, [apiKey, provider.id, onRefresh, startSave, endSave]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      const {
        ok,
        status,
        data: d,
      } = await csrfFetchJson<{ success?: boolean; error?: string }>(
        `/api/auth/api-key/${encodeURIComponent(provider.id)}`,
        { method: "DELETE" },
      );
      if (!ok || d.error) setError(d.error ?? `HTTP ${status}`);
      else onRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setRemoving(false);
    }
  }, [provider.id, onRefresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("models.apiKey")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: provider.configured ? "#4ade80" : "var(--border)",
              display: "inline-block",
            }}
          />
          <span
            style={{ fontSize: 11, color: provider.configured ? "#4ade80" : "var(--text-dim)" }}
          >
            {provider.configured ? t("models.configured") : t("models.notConfigured")}
          </span>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {provider.configured
          ? t("models.apiKeyStored")
          : t("models.enterApiKey", { name: provider.displayName, count: provider.modelCount })}
      </p>

      <Field label={t("models.apiKey")}>
        <div style={{ display: "flex", gap: 6 }}>
          <SecretTextInput
            value={apiKey}
            onChange={setApiKey}
            onKeyDown={(e) => {
              if (e.key === "Enter" && apiKey.trim()) handleSave();
            }}
            placeholder={provider.configured ? t("models.enterNewKey") : "sk-…"}
            style={{ flex: 1 }}
            autoComplete="off"
            spellCheck={false}
            mono
          />
          <SaveButton
            onSave={handleSave}
            saving={saving}
            savedOk={savedOk}
            disabled={!apiKey.trim()}
            idleLabel={t("models.save")}
            savingLabel={t("models.saving")}
            savedLabel={t("models.saved")}
          />
        </div>
      </Field>

      {error && <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>{error}</p>}

      {provider.configured && (
        <button
          onClick={handleRemove}
          disabled={removing}
          style={{
            alignSelf: "flex-start",
            padding: "5px 12px",
            background: "none",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 5,
            color: "#ef4444",
            cursor: removing ? "not-allowed" : "pointer",
            fontSize: 12,
          }}
        >
          {removing ? t("models.removing") : t("models.disconnect")}
        </button>
      )}
    </div>
  );
}

// ── Add provider picker ───────────────────────────────────────────────────────

function AddProviderPicker({
  oauthProviders,
  apiKeyProviders,
  onSelectOAuth,
  onSelectApiKey,
  onAddCustom,
  onClose,
}: AddProviderPickerProps) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  const q = search.trim().toLowerCase();

  const availableOAuth = oauthProviders.filter(
    (p) => !p.loggedIn && (!q || p.name.toLowerCase().includes(q)),
  );
  const availableApiKey = apiKeyProviders.filter(
    (p) =>
      !p.configured &&
      (!q || p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)),
  );
  const showCustom =
    !q ||
    "custom".includes(q) ||
    "openai-compatible".includes(q) ||
    "anthropic-compatible".includes(q);

  const totalCount = availableOAuth.length + availableApiKey.length + (showCustom ? 1 : 0);

  const cardStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    boxSizing: "border-box",
    cursor: "pointer",
    minWidth: 0,
    textAlign: "left",
    transition: "border-color 0.12s, background 0.12s",
    width: "100%",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(0,0,0,0.4)",
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
          width: 820,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "min(72vh, calc(100vh - 32px))",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
          overflow: "hidden",
        }}
      >
        {/* Search */}
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--text-dim)", flexShrink: 0 }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
            placeholder={t("models.searchProviders")}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Card grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {totalCount === 0 ? (
            <div
              style={{
                padding: "20px 0",
                fontSize: 12,
                color: "var(--text-dim)",
                textAlign: "center",
              }}
            >
              {t("models.noProvidersMatch")}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
                gap: 8,
              }}
            >
              {showCustom && (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--text-dim)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }}
                >
                  {t("models.custom")}
                </div>
              )}
              {showCustom && (
                <button
                  onClick={() => {
                    onAddCustom();
                    onClose();
                  }}
                  style={cardStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "var(--bg-panel)";
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--text)",
                        lineHeight: 1.3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t("models.openaiAnthropicCompatible")}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
                      {t("models.customEndpointFormat")}
                    </div>
                  </div>
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 5,
                      background: "var(--bg-hover)",
                      border: "1px dashed var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: "var(--text-dim)" }}
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </span>
                </button>
              )}

              {availableOAuth.length > 0 && (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    paddingTop: showCustom ? 6 : 0,
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--text-dim)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }}
                >
                  {t("models.subscriptions")}
                </div>
              )}
              {availableOAuth.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onSelectOAuth(p.id);
                    onClose();
                  }}
                  style={cardStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "var(--bg-panel)";
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--text)",
                        lineHeight: 1.3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.name}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
                      {t("models.oauth")}
                    </div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

              {availableApiKey.length > 0 && (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    paddingTop: availableOAuth.length > 0 ? 6 : 0,
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--text-dim)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }}
                >
                  {t("models.apiKey")}
                </div>
              )}
              {availableApiKey.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onSelectApiKey(p.id);
                    onClose();
                  }}
                  style={cardStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "var(--bg-panel)";
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--text)",
                        lineHeight: 1.3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.displayName}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
                      {t("models.modelCount", { count: p.modelCount })}
                    </div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ModelsConfig({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const { loading, run } = useAsync(undefined, { initialLoading: true });
  const { saving, savedOk, startSave, endSave } = useSave();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const loadOAuthProviders = useCallback(async () => {
    try {
      const { ok, status, data } = await csrfFetchJson<{ providers: OAuthProvider[] }>(
        "/api/auth/providers",
        { method: "GET" },
      );
      if (!ok) throw new Error(`Auth providers load failed: ${status}`);
      setOauthProviders(data.providers);
    } catch (err) {
      console.error("Failed to load OAuth providers:", err);
    }
  }, []);

  const loadApiKeyProviders = useCallback(async () => {
    try {
      const { ok, status, data } = await csrfFetchJson<{ providers: ApiKeyProvider[] }>(
        "/api/auth/all-providers",
        { method: "GET" },
      );
      if (!ok) throw new Error(`API key providers load failed: ${status}`);
      setApiKeyProviders(data.providers);
    } catch (err) {
      console.error("Failed to load API key providers:", err);
    }
  }, []);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const { data } = await csrfFetchJson<ModelsJson>("/api/models-config", { method: "GET" });
        const normalized = data.providers ? data : { ...data, providers: {} };
        setConfig(normalized);
        const keys = Object.keys(normalized.providers ?? {});
        if (keys.length > 0) setSelection({ type: "provider", name: keys[0] });
      } catch {
        setConfig({ providers: {} });
      }
    };
    void run(loadConfig);
    void loadOAuthProviders();
    void loadApiKeyProviders();
  }, [loadOAuthProviders, loadApiKeyProviders, run]);

  const addCustomProvider = useCallback(() => {
    let finalName = "new-provider";
    let n = 1;
    while (config.providers?.[finalName]) finalName = `new-provider-${n++}`;
    setConfig((prev) => ({
      ...prev,
      providers: { ...(prev.providers ?? {}), [finalName]: { api: "openai-completions" } },
    }));
    setSelection({ type: "provider", name: finalName });
  }, [config.providers]);

  const updateProvider = useCallback((name: string, p: ProviderEntry) => {
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: p } }));
  }, []);

  const renameProvider = useCallback((oldName: string, newName: string) => {
    setConfig((prev) => {
      const entries = Object.entries(prev.providers ?? {});
      const idx = entries.findIndex(([k]) => k === oldName);
      if (idx === -1) return prev;
      entries[idx] = [newName, entries[idx][1]];
      return { ...prev, providers: Object.fromEntries(entries) };
    });
    setSelection((prev) => {
      if (!prev) return prev;
      if (prev.type === "provider" && prev.name === oldName)
        return { type: "provider", name: newName };
      if (prev.type === "model" && prev.providerName === oldName)
        return { ...prev, providerName: newName };
      return prev;
    });
  }, []);

  const deleteProvider = useCallback((name: string) => {
    setConfig((prev) => {
      const providers = { ...(prev.providers ?? {}) };
      delete providers[name];
      return { ...prev, providers };
    });
    setConfig((prev) => {
      const remaining = Object.keys(prev.providers ?? {});
      setSelection(remaining.length > 0 ? { type: "provider", name: remaining[0] } : null);
      return prev;
    });
  }, []);

  const addModel = useCallback((providerName: string) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? []), { id: "" }];
      return {
        ...prev,
        providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } },
      };
    });
    setConfig((prev) => {
      const idx = (prev.providers?.[providerName]?.models?.length ?? 1) - 1;
      setSelection({ type: "model", providerName, index: idx });
      return prev;
    });
  }, []);

  const updateModel = useCallback((providerName: string, index: number, m: ModelEntry) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models[index] = m;
      return {
        ...prev,
        providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } },
      };
    });
  }, []);

  const removeModel = useCallback((providerName: string, index: number) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models.splice(index, 1);
      return {
        ...prev,
        providers: {
          ...(prev.providers ?? {}),
          [providerName]: { ...provider, models: models.length ? models : undefined },
        },
      };
    });
    setSelection({ type: "provider", name: providerName });
  }, []);

  const handleSave = useCallback(async () => {
    startSave();
    setSaveError(null);
    try {
      const {
        ok,
        status,
        data: d,
      } = await csrfFetchJson<{ success?: boolean; error?: string }>("/api/models-config", {
        method: "PUT",
        body: config,
      });
      if (!ok || d.error) {
        setSaveError(d.error ?? `HTTP ${status}`);
        endSave(false);
      } else {
        endSave(true);
      }
    } catch (e) {
      setSaveError(String(e));
      endSave(false);
    }
  }, [config, startSave, endSave]);

  const providers = Object.entries(config.providers ?? {});
  const activeOAuth = oauthProviders.filter((p) => p.loggedIn);
  const activeApiKey = apiKeyProviders.filter((p) => p.configured);

  // Resolve current detail
  const detailContent = (() => {
    if (!selection) return null;
    if (selection.type === "oauth") {
      const p = oauthProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return <OAuthDetail key={p.id} provider={p} onRefresh={loadOAuthProviders} />;
    }
    if (selection.type === "apikey") {
      const p = apiKeyProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return <ApiKeyDetail key={p.id} provider={p} onRefresh={loadApiKeyProviders} />;
    }
    if (selection.type === "provider") {
      const provider = config.providers?.[selection.name];
      if (!provider) return null;
      return (
        <ProviderDetail
          key={selection.name}
          name={selection.name}
          provider={provider}
          onChange={(p) => updateProvider(selection.name, p)}
          onRename={(n) => renameProvider(selection.name, n)}
          onDelete={() => deleteProvider(selection.name)}
        />
      );
    }
    const provider = config.providers?.[selection.providerName];
    const model = provider?.models?.[selection.index];
    if (!model) return null;
    return (
      <ModelDetail
        key={`${selection.providerName}-${selection.index}`}
        providerName={selection.providerName}
        provider={provider}
        model={model}
        onChange={(m) => updateModel(selection.providerName, selection.index, m)}
        onDelete={() => removeModel(selection.providerName, selection.index)}
      />
    );
  })();

  return (
    <>
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
            width: isMobile ? "calc(100vw - 16px)" : 860,
            maxWidth: "calc(100vw - 16px)",
            height: isMobile ? "calc(100dvh - 16px)" : "78vh",
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
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                {t("models.models")}
              </span>
              <code
                style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
              >
                ~/.pi/agent/models.json
              </code>
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
              }}
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
            {/* Left: tree */}
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
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
                {/* Active OAuth subscriptions */}
                {activeOAuth.map((p) => {
                  const isSelected = selection?.type === "oauth" && selection.providerId === p.id;
                  return (
                    <ConfigListRow
                      key={p.id}
                      selected={isSelected}
                      onClick={() => setSelection({ type: "oauth", providerId: p.id })}
                      leading={<ProviderIcon id={p.id} size={16} />}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--text)",
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.name}
                      </span>
                    </ConfigListRow>
                  );
                })}

                {/* Active API key providers */}
                {activeApiKey.map((p) => {
                  const isSelected = selection?.type === "apikey" && selection.providerId === p.id;
                  return (
                    <ConfigListRow
                      key={p.id}
                      selected={isSelected}
                      onClick={() => setSelection({ type: "apikey", providerId: p.id })}
                      leading={<ProviderIcon id={p.id} size={16} />}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--text)",
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.displayName}
                      </span>
                    </ConfigListRow>
                  );
                })}

                {/* Divider before custom providers, only when there are active managed providers */}
                {(activeOAuth.length > 0 || activeApiKey.length > 0) && providers.length > 0 && (
                  <div style={{ margin: "4px 8px", borderTop: "1px solid var(--border)" }} />
                )}

                {/* Custom providers */}
                {loading ? (
                  <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>
                    {t("models.loading")}
                  </div>
                ) : (
                  providers.map(([pName, pData]) => {
                    const isProviderSelected =
                      selection?.type === "provider" && selection.name === pName;
                    const models = pData.models ?? [];
                    return (
                      <div key={pName} style={{ marginBottom: 2 }}>
                        <ConfigListRow
                          selected={isProviderSelected}
                          onClick={() => setSelection({ type: "provider", name: pName })}
                          style={{ padding: "7px 8px", gap: 6 }}
                          leading={
                            <svg
                              width="11"
                              height="11"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={{ color: "var(--text-dim)", flexShrink: 0 }}
                            >
                              <rect x="4" y="4" width="16" height="16" rx="2" />
                              <rect x="9" y="9" width="6" height="6" />
                              <line x1="9" y1="1" x2="9" y2="4" />
                              <line x1="15" y1="1" x2="15" y2="4" />
                              <line x1="9" y1="20" x2="9" y2="23" />
                              <line x1="15" y1="20" x2="15" y2="23" />
                              <line x1="20" y1="9" x2="23" y2="9" />
                              <line x1="20" y1="14" x2="23" y2="14" />
                              <line x1="1" y1="9" x2="4" y2="9" />
                              <line x1="1" y1="14" x2="4" y2="14" />
                            </svg>
                          }
                        >
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: isProviderSelected ? 600 : 400,
                              color: "var(--text)",
                              fontFamily: "var(--font-mono)",
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {pName}
                          </span>
                        </ConfigListRow>

                        {/* Model rows */}
                        {models.map((m, i) => {
                          const isModelSelected =
                            selection?.type === "model" &&
                            selection.providerName === pName &&
                            selection.index === i;
                          return (
                            <ConfigListRow
                              key={i}
                              selected={isModelSelected}
                              onClick={() =>
                                setSelection({ type: "model", providerName: pName, index: i })
                              }
                              style={{ padding: "5px 8px 5px 26px", gap: 6 }}
                            >
                              <span
                                style={{
                                  fontSize: 11,
                                  fontFamily: "var(--font-mono)",
                                  color: m.id ? "var(--text-muted)" : "var(--text-dim)",
                                  flex: 1,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {m.id || t("models.newModel")}
                              </span>
                              {m.reasoning && (
                                <span
                                  style={{
                                    fontSize: 9,
                                    padding: "1px 4px",
                                    background: "rgba(99,102,241,0.12)",
                                    color: "rgba(99,102,241,0.8)",
                                    borderRadius: 3,
                                    flexShrink: 0,
                                  }}
                                >
                                  T
                                </span>
                              )}
                            </ConfigListRow>
                          );
                        })}

                        {/* Add model button */}
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            addModel(pName);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "4px 8px 4px 26px",
                            borderRadius: 5,
                            cursor: "pointer",
                            color: "var(--text-dim)",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--accent)";
                            e.currentTarget.style.background = "var(--bg-hover)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = "var(--text-dim)";
                            e.currentTarget.style.background = "none";
                          }}
                        >
                          <span style={{ fontSize: 11 }}>+ {t("models.model")}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Add provider */}
              <div style={{ borderTop: "1px solid var(--border)", padding: "8px 6px" }}>
                <button
                  onClick={() => setPickerOpen(true)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    width: "100%",
                    padding: "6px 0",
                    background: "none",
                    border: "1px dashed var(--border)",
                    borderRadius: 5,
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  + {t("models.addProvider")}
                </button>
              </div>
            </div>

            {/* Right: detail */}
            <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              {loading
                ? null
                : (detailContent ?? (
                    <div
                      style={{
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--text-dim)",
                        fontSize: 13,
                      }}
                    >
                      {t("models.selectProviderOrModel")}
                    </div>
                  ))}
            </div>
          </div>

          {/* Footer */}
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
            {saveError && (
              <span style={{ fontSize: 12, color: "#f87171", flex: 1 }}>{saveError}</span>
            )}
            <ModalButton variant="secondary" onClick={onClose}>
              {t("models.cancel")}
            </ModalButton>
            <SaveButton
              onSave={handleSave}
              saving={saving}
              savedOk={savedOk}
              idleLabel={t("models.save")}
              savingLabel={t("models.saving")}
              savedLabel={t("models.saved")}
            />
          </div>
        </div>
      </div>
      {pickerOpen && (
        <AddProviderPicker
          oauthProviders={oauthProviders}
          apiKeyProviders={apiKeyProviders}
          onSelectOAuth={(id) => setSelection({ type: "oauth", providerId: id })}
          onSelectApiKey={(id) => setSelection({ type: "apikey", providerId: id })}
          onAddCustom={addCustomProvider}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
