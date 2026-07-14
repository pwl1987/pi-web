"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { csrfFetchJson } from "@/lib/csrf-fetch";
import type { OAuthProvider, OAuthLoginState } from "../ModelsConfig.types";
import { SectionTitle } from "../FormFields";

export function OAuthDetail({
  provider,
  onRefresh,
}: {
  provider: OAuthProvider;
  onRefresh: () => void;
}) {
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
