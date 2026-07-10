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
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
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
  // Mirror defaultValue into a ref so the setter's deps don't churn when the
  // caller passes a fresh literal each render (e.g. `[]`, `true`).
  const defaultRef = useRef(defaultValue);
  defaultRef.current = defaultValue;

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