"use client";

import { useTokenUsage, formatTokenCount, formatResetIn, type TokenUsageBreakdownRow } from "@/hooks/useTokenUsage";
import { useI18n } from "@/hooks/useI18n";

export interface TokenUsageIndicatorConfig {
  /** Provider id (must be in SUPPORTED_TOKEN_USAGE_PROVIDERS). */
  provider: string;
  /** Visible display name for the indicator (e.g. "MiniMax"). Falls back to provider id. */
  displayName?: string;
}

interface Props {
  config: TokenUsageIndicatorConfig;
  /** Show a visible icon. Set false for a compact text-only pill. */
  showIcon?: boolean;
  /** Clicked when the user clicks the "configure" hint pill. */
  onConfigure?: () => void;
}

/**
 * Inline top-bar indicator that surfaces a provider's API quota / token-plan
 * usage. Three visible states:
 *
 *   1. Configured  → `[icon] <name> <used>/<total>·<pct>%` with full tooltip
 *   2. Not configured → small "[+]" configure hint, clickable to open Models
 *   3. Fetch error → muted warn icon with error tooltip
 *
 * Renders nothing during the initial fetch (so the bar doesn't flash) and
 * also returns null for unsupported providers.
 *
 * One indicator per supported provider — they're independently polled, so a
 * failing or unconfigured provider never blocks another.
 */
export function TokenUsageIndicator({ config, showIcon = true, onConfigure }: Props) {
  const { t } = useI18n();
  const usage = useTokenUsage({ provider: config.provider });
  const { info, reason, error, settled } = usage;
  const displayName = config.displayName ?? config.provider;

  // ── Configured — happy path ────────────────────────────────────────────────
  if (info) {
    const usedStr = formatTokenCount(info.used);
    const totalStr = info.total != null ? formatTokenCount(info.total) : null;
    const reset = info.resetAt ? formatResetIn(info.resetAt) : null;
    const pct = info.usedPercent;
    const pctStr = pct != null ? `${pct}%` : "";

    const pillText = totalStr
      ? `${usedStr}/${totalStr}${pctStr ? `·${pctStr}` : ""}`
      : usedStr;

    let tooltip: string;
    if (info.total != null) {
      const baseTooltip = reset
        ? t("tokenUsage.usageTooltip", {
            provider: displayName,
            used: info.used.toLocaleString(),
            total: info.total.toLocaleString(),
            pct: pctStr,
            reset,
          })
        : t("tokenUsage.usageTooltipNoReset", {
            provider: displayName,
            used: info.used.toLocaleString(),
            total: info.total.toLocaleString(),
            pct: pctStr,
          });
      tooltip = appendBreakdownTooltip(baseTooltip, info);
    } else {
      tooltip = t("tokenUsage.usageTooltipNoTotal", {
        provider: displayName,
        used: info.used.toLocaleString(),
      });
    }

    // Color: warn when usage creeps past 75% / 90% — same family as context bar.
    let color = "var(--text-muted)";
    if (pct != null && pct >= 90) color = "#ef4444";
    else if (pct != null && pct >= 75) color = "rgba(234,179,8,0.95)";

    return (
      <span
        title={tooltip}
        aria-label={tooltip}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "0 8px",
          color,
          fontSize: 11,
          cursor: "help",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {showIcon && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        )}
        <span>{displayName}</span>
        <span style={{ color: "var(--text-muted)" }}>{pillText}</span>
      </span>
    );
  }

  // ── Not configured → discoverable hint pill ───────────────────────────────
  if (settled && reason === "not_configured" && onConfigure) {
    return (
      <button
        type="button"
        title={t("tokenUsage.configureHintTitle", { provider: displayName })}
        aria-label={t("tokenUsage.configureHintTitle", { provider: displayName })}
        onClick={onConfigure}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "0 8px",
          height: 22,
          background: "transparent",
          border: "1px dashed var(--border)",
          borderRadius: 4,
          color: "var(--text-dim)",
          fontSize: 11,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {showIcon && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        )}
        <span>{displayName}</span>
      </button>
    );
  }

  // ── Error → muted warn icon with detail tooltip ───────────────────────────
  if (settled && reason === "error") {
    return (
      <span
        title={error ?? t("tokenUsage.error")}
        aria-label={t("tokenUsage.error")}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "0 8px",
          color: "var(--text-dim)",
          fontSize: 11,
          cursor: "help",
        }}
      >
        {showIcon && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        )}
      </span>
    );
  }

  // Loading / unsupported / no callback → render nothing.
  return null;
}

/**
 * If the payload carries per-model rows (e.g. MiniMax model_remains), append
 * one line per row to the tooltip so the user can see "general 37% left,
 * video 100% left" without clicking anything.
 */
function appendBreakdownTooltip(base: string, info: { breakdown?: TokenUsageBreakdownRow[] }): string {
  if (!info.breakdown || info.breakdown.length === 0) return base;
  const lines = info.breakdown.map((row) => {
    const name = row.model_name ?? "?";
    const rem = row.current_interval_remaining_percent;
    const used = row.current_interval_usage_count;
    const total = row.current_interval_total_count;
    if (typeof rem === "number") return `  ${name}: ${rem}% left`;
    if (typeof used === "number" && typeof total === "number") return `  ${name}: ${used}/${total}`;
    return `  ${name}`;
  });
  return `${base}\n${lines.join("\n")}`;
}