// ============================================================================
// Capability pluggable framework — contracts
// ============================================================================
//
// A single, unified abstraction for every pluggable building block in pi-web:
// plugins, skills, subagents and (browser-side) UI extensions. Previously these
// four were discovered/registered/loaded through four separate, scattered
// mechanisms. This module defines the common vocabulary so that *adding,
// removing or replacing* any capability implementation never touches business
// code (requirement #1 of the decoupling brief).
//
// The three roles:
//   - CapabilityDiscovery : given a context, enumerate capabilities of one kind.
//   - CapabilityProvider  : lifecycle (install / uninstall / enable / disable).
//   - CapabilityRegistry  : process-wide, queryable store (useSyncExternalStore
//                           compatible for the UI).

export type CapabilityKind = "plugin" | "skill" | "subagent" | "extension";

export type CapabilitySourceType = "bundled" | "local" | "package" | "project" | "global";

export interface CapabilitySource {
  type: CapabilitySourceType;
  /** Source identifier (package name, extension dir, skill path, …). */
  id: string;
}

export interface Capability {
  kind: CapabilityKind;
  /** Globally unique id (e.g. "extension:git-status", "skill:review"). */
  id: string;
  name: string;
  source: CapabilitySource;
  enabled: boolean;
  /** Kind-specific metadata (dir, canUninstall, diagnostics, …). */
  meta?: Record<string, unknown>;
}

export interface CapabilityContext {
  cwd?: string;
  agentDir: string;
}

export interface CapabilityDiscovery {
  readonly kind: CapabilityKind;
  discover(ctx: CapabilityContext): Promise<Capability[]>;
}

export interface CapabilityProvider {
  readonly kind: CapabilityKind;
  list(ctx: CapabilityContext): Promise<Capability[]>;
  install?(source: string, opts?: Record<string, unknown>): Promise<Capability>;
  uninstall?(id: string): Promise<void>;
  setEnabled?(id: string, enabled: boolean): Promise<void>;
}
