"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { csrfFetchJson } from "@/lib/csrf-fetch";
import type {
  CapabilityEnv,
  DependencyCheck,
  DependencyStatus,
  EnvScanItem,
  EnvScanResult,
  ProvisionResult,
} from "@/lib/env-types";

const STATUS_LABEL: Record<ProvisionResult["status"], { key: string }> = {
  ready: { key: "env.status.ready" },
  provisioned: { key: "env.status.provisioned" },
  "missing-runtime": { key: "env.status.missingRuntime" },
  incompatible: { key: "env.status.incompatible" },
  failed: { key: "env.status.failed" },
};

const STEP_ICON: Record<string, string> = { ok: "✓", warn: "⚠", error: "✗", skip: "–", info: "›" };
const STEP_COLOR: Record<string, string> = {
  ok: "#16a34a",
  warn: "#d97706",
  error: "#f87171",
  skip: "var(--text-dim)",
  info: "var(--text-dim)",
};

const DEP_ICON: Record<DependencyStatus, string> = {
  ok: "✓",
  missing: "✗",
  incompatible: "✗",
  warn: "⚠",
  skip: "–",
};
const DEP_COLOR: Record<DependencyStatus, string> = {
  ok: "#16a34a",
  missing: "#f87171",
  incompatible: "#f87171",
  warn: "#d97706",
  skip: "var(--text-dim)",
};
const DEP_LABEL: Record<DependencyStatus, string> = {
  ok: "env.dep.ok",
  missing: "env.dep.missing",
  incompatible: "env.dep.incompatible",
  warn: "env.dep.warn",
  skip: "env.dep.skip",
};

/** Build the full capability inventory (all MCP servers + all plugins) by
 *  reading the live config/plugin APIs. Used by the "scan everything" mode so
 *  that no associated dependency is ever omitted from the integrity check. */
async function buildFullInventory(cwd?: string): Promise<CapabilityEnv[]> {
  const [mcp, plug] = await Promise.all([
    fetch("/api/mcp-config").then((r) => r.json().catch(() => ({}))),
    fetch(`/api/plugins?cwd=${encodeURIComponent(cwd ?? "")}`).then((r) =>
      r.json().catch(() => ({})),
    ),
  ]);
  const caps: CapabilityEnv[] = [];
  for (const s of (mcp?.servers ?? []) as Array<Record<string, unknown>>) {
    const name = String(s.name ?? "");
    if (s.url) {
      caps.push({ kind: "mcp", id: name, label: name, url: String(s.url) });
    } else {
      caps.push({
        kind: "mcp",
        id: name,
        label: name,
        command: s.command ? String(s.command) : undefined,
        args: (s.args as string[] | undefined) ?? undefined,
        env: (s.env as Record<string, string> | undefined) ?? undefined,
        cwd,
      });
    }
  }
  for (const p of (plug?.packages ?? []) as Array<Record<string, unknown>>) {
    const source = String(p.source ?? "");
    caps.push({ kind: "plugin", id: source, label: source, source, cwd });
  }
  return caps;
}

/** Unified "detect + install environment" control. Used identically by the MCP
 *  server cards and the plugin detail view. With `fullScan` it performs a
 *  comprehensive integrity scan across every MCP service and plugin and renders
 *  a per-item dependency breakdown; without it, only the given capability is
 *  checked (and the result mirrors the legacy single-server view). */
export function EnvProvisionButton({
  capability,
  cwd,
  disabled,
  runToken,
  compact,
  fullScan,
}: {
  capability?: CapabilityEnv;
  cwd?: string;
  disabled?: boolean;
  /** Increment to auto-trigger a run (e.g. right after saving). Always single. */
  runToken?: number;
  compact?: boolean;
  /** When true, the manual click scans the whole inventory (MCP + plugins). */
  fullScan?: boolean;
}) {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EnvScanResult | null>(null);
  const lastToken = useRef<number>(runToken ?? 0);

  const run = useCallback(
    async (scanAll: boolean) => {
      setRunning(true);
      setResult(null);
      try {
        const capabilities = scanAll
          ? await buildFullInventory(cwd)
          : capability
            ? [{ ...capability, cwd }]
            : [];
        const { data: d } = await csrfFetchJson<EnvScanResult>("/api/mcp-config/env/scan", {
          method: "POST",
          body: { capabilities, install: true },
        });
        setResult(d);
      } catch (e) {
        setResult({
          ok: false,
          items: [
            {
              kind: capability?.kind ?? "mcp",
              id: capability?.id ?? "error",
              label: capability?.label ?? "error",
              status: "failed",
              ok: false,
              dependencies: [],
              steps: [
                { key: "raw", status: "error", detail: e instanceof Error ? e.message : String(e) },
              ],
            },
          ],
        });
      } finally {
        setRunning(false);
      }
    },
    [capability, cwd],
  );

  // Auto-trigger when runToken increases (single capability only).
  useEffect(() => {
    if (runToken != null && runToken > lastToken.current) {
      lastToken.current = runToken;
      if (capability) void run(false);
    }
  }, [runToken, run, capability]);

  const showReport = !!result && (fullScan || result.items.length > 1);
  const btnDisabled = disabled || running;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => void run(!!fullScan)}
          disabled={btnDisabled}
          style={{ ...btnStyle, opacity: btnDisabled ? 0.4 : 1 }}
        >
          {running ? t("env.running") : t("env.runButton")}
        </button>
        {result && !showReport && (
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              color: result.ok ? "#16a34a" : "#f87171",
            }}
          >
            {t(STATUS_LABEL[result.items[0].status].key)}
          </span>
        )}
        {result && showReport && (
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              color: result.ok ? "#16a34a" : "#f87171",
            }}
          >
            {result.ok
              ? t("env.scan.allOk")
              : t("env.scan.hasIssues", { count: result.items.filter((i) => !i.ok).length })}
          </span>
        )}
        {!cwd && capability?.kind === "mcp" && capability.command && (
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{t("env.needCwd")}</span>
        )}
      </div>

      {result && showReport && <ScanReport result={result} t={t} compact={compact} />}
      {result && !showReport && <SingleResult item={result.items[0]} t={t} compact={compact} />}
    </div>
  );
}

/** Legacy single-capability view: just the step list. */
function SingleResult({
  item,
  t,
  compact,
}: {
  item: EnvScanItem;
  t: (k: string, v?: Record<string, string | number>) => string;
  compact?: boolean;
}) {
  if (item.steps.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: compact ? "6px 8px" : "8px 10px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        fontSize: 11,
      }}
    >
      {item.steps.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
          <span style={{ color: STEP_COLOR[s.status], fontWeight: 700, flexShrink: 0 }}>
            {STEP_ICON[s.status]}
          </span>
          <span style={{ color: s.status === "error" ? "#f87171" : "var(--text-dim)" }}>
            {s.key === "raw" ? (s.detail ?? "") : t(s.key, s.args)}
            {s.detail && s.key !== "raw" ? ` — ${s.detail}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Comprehensive grouped report: every MCP server and plugin with its own
 *  dependency breakdown (runtime, package, image, status + version). */
function ScanReport({
  result,
  t,
  compact,
}: {
  result: EnvScanResult;
  t: (k: string, v?: Record<string, string | number>) => string;
  compact?: boolean;
}) {
  const mcp = result.items.filter((i) => i.kind === "mcp");
  const plugins = result.items.filter((i) => i.kind === "plugin");
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: compact ? "6px 8px" : "8px 10px",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        fontSize: 11,
      }}
    >
      {mcp.length > 0 && <ScanGroup title={t("env.scan.mcp")} items={mcp} t={t} />}
      {plugins.length > 0 && <ScanGroup title={t("env.scan.plugins")} items={plugins} t={t} />}
      {mcp.length === 0 && plugins.length === 0 && (
        <div style={{ color: "var(--text-dim)" }}>{t("env.scan.noItems")}</div>
      )}
    </div>
  );
}

function ScanGroup({
  title,
  items,
  t,
}: {
  title: string;
  items: EnvScanItem[];
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--text-dim)",
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      {items.map((item) => (
        <ItemRow key={`${item.kind}:${item.id}`} item={item} t={t} />
      ))}
    </div>
  );
}

function ItemRow({
  item,
  t,
}: {
  item: EnvScanItem;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  return (
    <div
      style={{
        borderLeft: `2px solid ${item.ok ? "#16a34a" : "#f87171"}`,
        paddingLeft: 6,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--text)" }}>
          {item.label}
        </span>
        <span style={{ fontSize: 10, color: item.ok ? "#16a34a" : "#f87171" }}>
          {t(STATUS_LABEL[item.status].key)}
        </span>
      </div>
      {item.dependencies.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {item.dependencies.map((dep, i) => (
            <DependencyLine key={i} dep={dep} t={t} />
          ))}
        </div>
      ) : (
        <div style={{ color: "var(--text-dim)" }}>{t("env.scan.noDeps")}</div>
      )}
    </div>
  );
}

function DependencyLine({
  dep,
  t,
}: {
  dep: DependencyCheck;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const meta = [
    dep.version ? `v${dep.version}` : "",
    dep.required && dep.status === "incompatible"
      ? t("env.dep.requires", { required: dep.required })
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
        <span style={{ color: DEP_COLOR[dep.status], fontWeight: 700, flexShrink: 0 }}>
          {DEP_ICON[dep.status]}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{dep.name}</span>
        {meta && <span style={{ color: "var(--text-dim)" }}>{meta}</span>}
        <span style={{ marginLeft: "auto", color: DEP_COLOR[dep.status] }}>
          {t(DEP_LABEL[dep.status])}
        </span>
      </div>
      {dep.detail && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: dep.status === "missing" ? "#f87171" : "var(--text-muted)",
            paddingLeft: 14,
            wordBreak: "break-all",
          }}
        >
          {dep.detail}
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "var(--bg-hover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "5px 12px",
  fontSize: 11,
  color: "var(--text)",
  cursor: "pointer",
};
