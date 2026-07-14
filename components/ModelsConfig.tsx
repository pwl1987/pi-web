"use client";

import { useState, useEffect, useCallback } from "react";
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
  Selection,
} from "./ModelsConfig.types";
import { ProviderIcon } from "./ProviderIcon";
import { ProviderDetail } from "./models-config/ProviderDetail";
import { ModelDetail } from "./models-config/ModelDetail";
import { OAuthDetail } from "./models-config/OAuthDetail";
import { ApiKeyDetail } from "./models-config/ApiKeyDetail";
import { AddProviderPicker } from "./models-config/AddProviderPicker";

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
