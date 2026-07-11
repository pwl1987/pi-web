// ============================================================================
// Capability pluggable framework — providers (lifecycle)
// ============================================================================
//
// A registry of CapabilityProvider instances keyed by CapabilityKind. Each
// provider owns the install / uninstall / enable / disable lifecycle for one
// kind. The `extension` provider reuses the existing
// `lib/extensions/discovery` module (behavior-preserving). Skill / plugin /
// subagent providers delegate to the Pi SDK adapter (see lib/pi) so they keep
// working while the SDK boundary stays in one place.
//
// Adding a new capability kind = implement a provider + discovery strategy and
// register both. Nothing else changes.

import { getPiAdapter } from "../pi";
import type { Capability, CapabilityContext, CapabilityProvider } from "./types";
import type { ExtensionListEntry } from "../extensions/discovery";
import {
  installLocalExtension,
  listExtensionsWithState,
  setExtensionEnabled,
  uninstallExtension,
} from "../extensions/discovery";

// --- Extension provider (fully wired to existing discovery) -----------------

class ExtensionProvider implements CapabilityProvider {
  readonly kind = "extension" as const;

  async list(_ctx: CapabilityContext): Promise<Capability[]> {
    return listExtensionsWithState().map((e: ExtensionListEntry) => ({
      kind: "extension",
      id: `extension:${e.id}`,
      name: e.name ?? e.id,
      source: { type: e.source === "local" ? "local" : "bundled", id: e.id },
      enabled: e.enabled,
      meta: { canUninstall: e.canUninstall, dir: e.dir },
    }));
  }

  async install(source: string): Promise<Capability> {
    const result = installLocalExtension(source);
    return {
      kind: "extension",
      id: `extension:${result.id}`,
      name: result.name ?? result.id,
      source: { type: "local", id: result.id },
      enabled: true,
      meta: {},
    };
  }

  async uninstall(id: string): Promise<void> {
    // `id` is "extension:<dir>"; strip the prefix.
    uninstallExtension(id.replace(/^extension:/, ""));
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    setExtensionEnabled(id.replace(/^extension:/, ""), enabled);
  }
}

// --- Skill / plugin / subagent providers (delegate to the Pi SDK ACL) -------
// These reuse the SDK through `getPiAdapter()` so no business module imports the
// SDK directly. Lifecycle methods are optional on the contract; where the SDK
// has no first-class operation we leave them unimplemented and the existing
// route handlers remain authoritative (see docs/ARCHITECTURE-DECOUPLING.md).

class SkillProvider implements CapabilityProvider {
  readonly kind = "skill" as const;

  async list(ctx: CapabilityContext): Promise<Capability[]> {
    const ca = getPiAdapter().codingAgent;
    const loader = new (
      ca.DefaultResourceLoader as unknown as new (o: { cwd: string; agentDir: string }) => {
        reload(): Promise<void>;
        getSkills(): { skills: Array<{ name: string }> };
      }
    )({
      cwd: ctx.cwd ?? process.cwd(),
      agentDir: getPiAdapter().agentDir,
    });
    await loader.reload();
    return loader.getSkills().skills.map((s) => ({
      kind: "skill" as const,
      id: `skill:${s.name}`,
      name: s.name,
      source: { type: "package" as const, id: s.name },
      enabled: true,
      meta: {},
    }));
  }
}

class PluginProvider implements CapabilityProvider {
  readonly kind = "plugin" as const;

  async list(ctx: CapabilityContext): Promise<Capability[]> {
    const ca = getPiAdapter().codingAgent;
    const sm = (
      ca.SettingsManager as unknown as {
        create(
          cwd: string,
          agentDir: string,
        ): {
          getGlobalSettings(): { packages?: Array<{ source?: string } | string> };
          getProjectSettings(): { packages?: Array<{ source?: string } | string> };
        };
      }
    ).create(ctx.cwd ?? process.cwd(), getPiAdapter().agentDir);
    const toCap = (raw: { source?: string } | string, scope: "global" | "project"): Capability => {
      const source = typeof raw === "string" ? raw : (raw.source ?? "");
      return {
        kind: "plugin" as const,
        id: `plugin:${scope}:${source}`,
        name: source,
        source: { type: scope, id: source },
        enabled: true,
        meta: { scope },
      };
    };
    const out: Capability[] = [];
    for (const p of sm.getGlobalSettings().packages ?? []) out.push(toCap(p, "global"));
    for (const p of sm.getProjectSettings().packages ?? []) out.push(toCap(p, "project"));
    return out;
  }
}

class SubagentProvider implements CapabilityProvider {
  readonly kind = "subagent" as const;

  async list(_ctx: CapabilityContext): Promise<Capability[]> {
    // Subagents are async temp-scoped runs; discovery is a filesystem scan owned
    // by the existing route. The framework exposes the kind so it can be
    // observed uniformly; the scan itself stays in app/api/subagents.
    return [];
  }
}

const providers = new Map<string, CapabilityProvider>();

export function registerProvider(p: CapabilityProvider): void {
  providers.set(p.kind, p);
}

export function getProvider(kind: Capability["kind"]): CapabilityProvider | undefined {
  return providers.get(kind);
}

// Register the built-in providers.
registerProvider(new ExtensionProvider());
registerProvider(new SkillProvider());
registerProvider(new PluginProvider());
registerProvider(new SubagentProvider());
