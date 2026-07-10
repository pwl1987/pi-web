"use client";

import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { useAudio } from "@/hooks/useAudio";

interface Props {
  onClose: () => void;
  onOpenModels: () => void;
}

/** Unified settings modal — consolidates theme, language, sound, and Models entry. */
export function SettingsPanel({ onClose, onOpenModels }: Props) {
  const { isDark, toggleTheme } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const { soundEnabled, onSoundToggle } = useAudio();

  return (
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
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "min(480px, calc(100vw - 32px))",
          maxHeight: "calc(100dvh - 32px)",
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
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0,
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            {t("settings.title")}
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>

          {/* --- Theme --- */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 18px" }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
              {t("settings.theme")}
            </span>
            <div style={{ display: "flex", gap: 0, borderRadius: 7, border: "1px solid var(--border)", overflow: "hidden" }}>
              <button
                onClick={() => { if (isDark) toggleTheme(); }}
                style={{
                  padding: "4px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer",
                  background: !isDark ? "var(--bg-selected)" : "none",
                  border: "none", borderRight: "1px solid var(--border)",
                  color: !isDark ? "var(--text)" : "var(--text-muted)",
                }}
              >
                {t("settings.themeLight")}
              </button>
              <button
                onClick={() => { if (!isDark) toggleTheme(); }}
                style={{
                  padding: "4px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer",
                  background: isDark ? "var(--bg-selected)" : "none",
                  border: "none",
                  color: isDark ? "var(--text)" : "var(--text-muted)",
                }}
              >
                {t("settings.themeDark")}
              </button>
            </div>
          </div>

          {/* --- Language --- */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 18px", borderTop: "1px solid var(--border)" }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
              {t("settings.language")}
            </span>
            <div style={{ display: "flex", gap: 0, borderRadius: 7, border: "1px solid var(--border)", overflow: "hidden" }}>
              <button
                onClick={() => setLocale("en")}
                style={{
                  padding: "4px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer",
                  background: locale === "en" ? "var(--bg-selected)" : "none",
                  border: "none", borderRight: "1px solid var(--border)",
                  color: locale === "en" ? "var(--text)" : "var(--text-muted)",
                }}
              >
                {t("settings.languageEn")}
              </button>
              <button
                onClick={() => setLocale("zh")}
                style={{
                  padding: "4px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer",
                  background: locale === "zh" ? "var(--bg-selected)" : "none",
                  border: "none",
                  color: locale === "zh" ? "var(--text)" : "var(--text-muted)",
                }}
              >
                {t("settings.languageZh")}
              </button>
            </div>
          </div>

          {/* --- Sound --- */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 18px", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
                {t("settings.sound")}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                {t("settings.soundHint")}
              </span>
            </div>
            {/* Toggle switch */}
            <button
              onClick={onSoundToggle}
              style={{
                width: 36, height: 20, borderRadius: 10, cursor: "pointer", padding: 0,
                border: "none", position: "relative",
                background: soundEnabled ? "var(--accent)" : "var(--bg-hover)",
                transition: "background 0.15s",
              }}
            >
              <span style={{
                position: "absolute", top: 2, left: soundEnabled ? 18 : 2,
                width: 16, height: 16, borderRadius: "50%", background: "#fff",
                transition: "left 0.15s",
              }} />
            </button>
          </div>

          {/* --- Models entry --- */}
          <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border)" }}>
            <button
              onClick={() => { onClose(); onOpenModels(); }}
              style={{
                width: "100%", padding: "8px 12px", fontSize: 13, fontWeight: 500,
                cursor: "pointer", borderRadius: 7,
                background: "var(--bg-hover)", border: "1px solid var(--border)",
                color: "var(--text)", textAlign: "left",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}
            >
              {t("settings.openModels")}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
