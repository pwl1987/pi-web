"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useSave } from "@/hooks/useSave";
import { csrfFetchJson } from "@/lib/csrf-fetch";
import type { ApiKeyProvider } from "../ModelsConfig.types";
import { SectionTitle, Field, SecretTextInput } from "../FormFields";
import { SaveButton } from "@/components/ui/ConfigModal";

export function ApiKeyDetail({
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
