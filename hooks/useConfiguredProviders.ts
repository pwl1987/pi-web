"use client";

import { useEffect, useState } from "react";

/**
 * Minimal shape of one entry from `GET /api/auth/all-providers`.
 * Mirrors `ApiKeyProvider` in components/ModelsConfig.tsx without pulling in
 * the panel component. Only `id` and `configured` are consumed here.
 */
interface ProviderAuthEntry {
  id: string;
  configured: boolean;
}

interface AllProvidersResponse {
  providers: ProviderAuthEntry[];
}

// Module-level cache so multiple TokenUsageIndicator instances (one per
// provider) share a single fetch. Cleared only on full page reload.
let cachedConfigured: Set<string> | null = null;
let inFlight: Promise<Set<string>> | null = null;

async function loadConfiguredProviders(): Promise<Set<string>> {
  if (cachedConfigured) return cachedConfigured;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch("/api/auth/all-providers", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as AllProvidersResponse;
      const set = new Set<string>();
      for (const p of body.providers ?? []) {
        if (p.configured) set.add(p.id);
      }
      cachedConfigured = set;
      return set;
    } catch {
      // On failure, fall back to "all configured" so the usage indicators
      // still render — degrades to the pre-filter behavior rather than
      // hiding a working feature because the auth endpoint hiccuped.
      cachedConfigured = null;
      return ALL_CONFIGURED;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

// Sentinel: treat every provider as configured. Since a Proxy Set can't be
// iterated or spread without crashing (iterating calls the Proxy getter which
// returns undefined for iterator), use a concrete helper class that safely
// implements the full Set API surface used by callers.
class AllConfiguredSet {
  has(_key: string): boolean {
    return true;
  }
  get size(): number {
    return Infinity;
  }
  // Prevent crashes when code spreads or iterates the set
  [Symbol.iterator](): IterableIterator<string> {
    return [].values();
  }
}
const ALL_CONFIGURED = new AllConfiguredSet() as unknown as Set<string>;

export interface ConfiguredProvidersState {
  /** Set of provider ids known to have an API key configured. */
  configured: Set<string>;
  /** True until the first load settles. Renders should treat this as "empty". */
  loading: boolean;
}

/**
 * Returns the set of provider ids that have an API key configured, fetched
 * once per page load from `/api/auth/all-providers` and shared across all
 * callers via a module-level cache.
 *
 * While `loading` is true, callers should render nothing — the fetch is
 * typically <100ms and avoids mounting hooks for providers with no key
 * (which would otherwise each fire their own polling fetch).
 *
 * On fetch failure, `configured` becomes a permissive set (`.has()` always
 * returns true) so the feature degrades to "show everything" rather than
 * silently disappearing.
 */
export function useConfiguredProviders(): ConfiguredProvidersState {
  const [state, setState] = useState<ConfiguredProvidersState>({
    configured: ALL_CONFIGURED,
    loading: !cachedConfigured,
  });

  useEffect(() => {
    let alive = true;
    // If a prior mount already populated the cache, settle synchronously.
    if (cachedConfigured) {
      setState({ configured: cachedConfigured, loading: false });
      return;
    }
    loadConfiguredProviders().then((set) => {
      if (!alive) return;
      setState({ configured: set, loading: false });
    });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
