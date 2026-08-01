// Shared types for the unified MCP/plugin environment detection & provisioning
// feature. This module is safe to import from client code (type-only) because it
// contains no server-only imports (no child_process, no next/server).

export type RuntimeName = "node" | "uv" | "python3" | "bun" | "deno" | "docker";

export interface RuntimeStatus {
  name: RuntimeName;
  available: boolean;
  version?: string;
  error?: string;
}

/** A capability descriptor — either an MCP stdio server or a pi plugin. This is
 *  the single, unified input shape for the environment pipeline so that MCP
 *  templates and plugins share identical trigger/execution/error semantics. */
export interface CapabilityEnv {
  kind: "mcp" | "plugin";
  id: string;
  label: string;
  // mcp stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string; // for project-scoped init steps (e.g. CodeGraph index)
  // plugin
  source?: string; // npm:..., git:..., /abs/path
  // remote mcp (url transport) carries no command
  url?: string;
}

export type EnvStepStatus = "ok" | "warn" | "error" | "skip" | "info";

export interface EnvStep {
  /** i18n key, OR "raw" when `detail` already holds final text. */
  key: string;
  args?: Record<string, string | number>;
  status: EnvStepStatus;
  /** Raw, already-localized detail (used when key === "raw"). */
  detail?: string;
}

export type ProvisionStatus =
  "ready" | "provisioned" | "missing-runtime" | "incompatible" | "failed";

export interface ProvisionResult {
  ok: boolean;
  status: ProvisionStatus;
  runtime?: RuntimeStatus;
  steps: EnvStep[];
  /** Trailing raw log (capped). */
  output?: string;
}

/** Status of a single dependency discovered for a capability. */
export type DependencyStatus =
  | "ok" // present / satisfied
  | "missing" // required but not available
  | "incompatible" // present but version mismatches
  | "warn" // present but could not be fully verified
  | "skip"; // not applicable (e.g. remote server)

export interface DependencyCheck {
  /** Display name: runtime (node/uv/…), npm package, or docker image. */
  name: string;
  type: "runtime" | "package" | "image" | "other";
  installed: boolean;
  /** Resolved / installed version (e.g. npm package version). */
  version?: string;
  /** Required version/range (e.g. engines.node). */
  required?: string;
  status: DependencyStatus;
  detail?: string;
}

/** One capability (MCP server or plugin) with its full dependency breakdown. */
export interface EnvScanItem {
  kind: "mcp" | "plugin";
  id: string;
  label: string;
  command?: string;
  transport?: "stdio" | "url";
  runtime?: RuntimeStatus;
  status: ProvisionStatus;
  ok: boolean;
  /** Every dependency that was checked for this capability. */
  dependencies: DependencyCheck[];
  steps: EnvStep[];
}

/** Result of a full integrity scan across many capabilities. */
export interface EnvScanResult {
  ok: boolean;
  items: EnvScanItem[];
}
