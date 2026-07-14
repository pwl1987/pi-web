"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ProviderEntry } from "../ModelsConfig.types";
import { API_OPTIONS } from "../ModelsConfig.types";
import { Field, TextInput, SecretTextInput, Select, SectionTitle } from "../FormFields";

export function ProviderDetail({
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
