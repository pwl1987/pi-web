// ============================================================================
// Capability pluggable framework — unified registry
// ============================================================================
//
// One process-wide store holding every discovered/registered capability across
// all four kinds. UI components observe it via the useSyncExternalStore-style
// `subscribe` / `getSnapshot` pair (mirroring the existing ExtensionRegistry).
// Stored on `globalThis` so it survives Next.js dev hot-reloads.

import type { Capability, CapabilityKind } from "./types";

type Listener = () => void;

export class CapabilityRegistry {
  private byId = new Map<string, Capability>();
  private listeners = new Set<Listener>();
  /** Bumped on every mutation so external-store consumers re-render. */
  private version = 0;

  // --- External store API (for useSyncExternalStore) ---
  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  getSnapshot = (): number => this.version;

  private notify(): void {
    this.version++;
    this.listeners.forEach((cb) => cb());
  }

  // --- Mutations ---
  register(cap: Capability): void {
    this.byId.set(cap.id, cap);
    this.notify();
  }
  unregister(id: string): void {
    if (this.byId.delete(id)) this.notify();
  }
  setEnabled(id: string, enabled: boolean): void {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.register({ ...existing, enabled });
  }

  // --- Queries ---
  get(id: string): Capability | undefined {
    return this.byId.get(id);
  }
  list(kind?: CapabilityKind): Capability[] {
    const all = [...this.byId.values()];
    return kind ? all.filter((c) => c.kind === kind) : all;
  }
  get isEmpty(): boolean {
    return this.byId.size === 0;
  }
}

declare global {
  var __piCapabilityRegistry: CapabilityRegistry | undefined;
}

/** Singleton registry. Survives hot-reload via globalThis. */
export function getCapabilityRegistry(): CapabilityRegistry {
  if (!globalThis.__piCapabilityRegistry) {
    globalThis.__piCapabilityRegistry = new CapabilityRegistry();
  }
  return globalThis.__piCapabilityRegistry;
}
