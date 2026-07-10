"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * SSR-safe persistent state — survives F5 / page navigation by mirroring into
 * localStorage. Mirrors the useTheme / useI18n module-store pattern so the
 * server, the hydration render, and the first client paint all read the same
 * value (no hydration mismatch, no flash of fallback state).
 *
 * Usage:
 *   const [sidebarOpen, setSidebarOpen] = usePersistentState(
 *     "pi-sidebar-open",
 *     true,           // server + first-paint value
 *   );
 *
 * The setter writes through to localStorage and notifies other subscribers in
 * the same tab (so multiple components using the same key stay in sync).
 */

const STORE_KEY_PREFIX = "__piPersistent:";

const listeners = new Map<string, Set<() => void>>();

// Memoize getSnapshot results so referential equality holds across the
// repeated getSnapshot() calls React issues per render. Without this,
// JSON.parse() returns a fresh object every time and useSyncExternalStore
// warns "The result of getSnapshot should be cached to avoid an infinite
// loop". Keyed on the raw storage string so writes invalidate the cache.
const snapshotCache = new Map<string, { raw: string; parsed: unknown }>();

function subscribe(key: string, cb: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

function getSnapshot<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  const cached = snapshotCache.get(key);
  if (cached && cached.raw === raw) return cached.parsed as T;
  try {
    const parsed = JSON.parse(raw) as T;
    snapshotCache.set(key, { raw, parsed });
    return parsed;
  } catch {
    return fallback;
  }
}

function getServerSnapshot<T>(_key: string, fallback: T): T {
  // Always return the default during SSR / first hydration paint to avoid a
  // mismatch. The hook re-reads via getSnapshot on the client immediately
  // after hydration.
  return fallback;
}

export function usePersistentState<T>(
  key: string,
  defaultValue: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const fullKey = STORE_KEY_PREFIX + key;
  // Capture the default exactly once and never reassign. If we re-mirrored
  // `defaultValue` into the ref on every render, callers that pass a fresh
  // literal each render (e.g. `usePersistentState<Tab[]>("file-tabs", [])`)
  // would make the ref's identity churn — and since getSnapshot returns this
  // ref directly when localStorage has no stored value, useSyncExternalStore
  // would see a "new" snapshot every render and either warn about
  // getSnapshot caching or hit "Maximum update depth exceeded".
  //
  // The setter does not depend on defaultRef.current (its useCallback deps
  // are [fullKey]), so this capture-once is safe for it as well.
  const defaultRef = useRef(defaultValue);

  const value = useSyncExternalStore(
    (cb) => subscribe(fullKey, cb),
    () => getSnapshot(fullKey, defaultRef.current),
    () => getServerSnapshot(fullKey, defaultRef.current),
  );

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      try {
        const raw = window.localStorage.getItem(fullKey);
        const prev: T = raw === null ? defaultRef.current : (JSON.parse(raw) as T);
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        window.localStorage.setItem(fullKey, JSON.stringify(resolved));
      } catch {
        // Storage quota / private mode — best-effort, drop the write.
        return;
      }
      const set = listeners.get(fullKey);
      if (set) for (const cb of set) cb();
    },
    [fullKey],
  );

  return [value, setValue];
}