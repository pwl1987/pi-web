"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { csrfFetchJson } from "@/lib/csrf-fetch";
import type { ModelEntry, ProviderEntry, ModelTestState } from "../ModelsConfig.types";
import { API_OPTIONS } from "../ModelsConfig.types";
import { Field, TextInput, NumInput, Select, Check, SectionTitle } from "../FormFields";
import { ThinkingLevelMapEditor } from "./ThinkingLevelMapEditor";
import { hasDeepseekCompat, setDeepseekCompat } from "./deepseek-compat";

export function ModelDetail({
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
