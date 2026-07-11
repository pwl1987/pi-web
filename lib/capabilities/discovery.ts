// ============================================================================
// Capability pluggable framework — discovery strategies
// ============================================================================
//
// A registry of CapabilityDiscovery strategies keyed by CapabilityKind. To
// support a brand-new capability type, implement CapabilityDiscovery and call
// `registerDiscovery()` — no other code (routes, UI, services) needs to change.
// This is the "extension point" that makes adding/replacing capability
// implementations transparent to the business layer.

import type { Capability, CapabilityContext, CapabilityDiscovery, CapabilityKind } from "./types";
import { listExtensionsWithState, type ExtensionListEntry } from "../extensions/discovery";

/** Adapter: existing extension discovery → unified Capability discovery. */
class ExtensionDiscovery implements CapabilityDiscovery {
  readonly kind = "extension" as const;
  async discover(_ctx: CapabilityContext): Promise<Capability[]> {
    return listExtensionsWithState().map(toCapability);
  }
}

function toCapability(e: ExtensionListEntry): Capability {
  return {
    kind: "extension",
    id: `extension:${e.id}`,
    name: e.name ?? e.id,
    source: { type: e.source === "local" ? "local" : "bundled", id: e.id },
    enabled: e.enabled,
    meta: { canUninstall: e.canUninstall, dir: e.dir },
  };
}

const strategies = new Map<CapabilityKind, CapabilityDiscovery>();

export function registerDiscovery(d: CapabilityDiscovery): void {
  strategies.set(d.kind, d);
}

export function getDiscovery(kind: CapabilityKind): CapabilityDiscovery | undefined {
  return strategies.get(kind);
}

/** Discover capabilities of the given kinds (or all registered kinds). */
export async function discoverCapabilities(
  ctx: CapabilityContext,
  kinds?: CapabilityKind[],
): Promise<Capability[]> {
  const wanted = kinds ?? [...strategies.keys()];
  const out: Capability[] = [];
  for (const k of wanted) {
    const strategy = strategies.get(k);
    if (strategy) out.push(...(await strategy.discover(ctx)));
  }
  return out;
}

// Register the built-in discovery strategies.
registerDiscovery(new ExtensionDiscovery());
