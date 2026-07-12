// Lightweight i18n core — zero dependencies.
//
// Mirrors the pattern in hooks/useTheme.ts: a module-level listener set,
// useSyncExternalStore for React binding, and localStorage persistence.
// The layout preload script (app/layout.tsx) writes data-lang before first
// paint so getSnapshot reads the correct locale with no FOUC.
//
// Keys are flat dotted strings ("namespace.subkey"). Variable interpolation
// uses {name} placeholders: translate(locale, "a.key", { count: 3 }) replaces
// "{count}" → "3".

import { en } from "./en";
import { zh } from "./zh";

export type Locale = "en" | "zh";

const STORAGE_KEY = "pi-language";
// Default to Chinese: this app's user-facing copy is authored in Chinese and the
// project mandates a fully localized (Chinese) UI. English remains available via
// the language toggle (storing "en" opts out).
const DEFAULT_LOCALE: Locale = "zh";

const dictionaries: Record<Locale, Record<string, string>> = { en, zh };

const listeners = new Set<() => void>();

/** Read the locale the layout preload script stamped onto <html data-lang>. */
function getSnapshot(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const dom = document.documentElement.getAttribute("data-lang");
  return dom === "zh" ? "zh" : "en";
}

/** Server always renders the default locale to avoid hydration mismatch. */
function getServerSnapshot(): Locale {
  return DEFAULT_LOCALE;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Persist a new locale, update <html>, and notify all subscribers. */
export function setLocale(next: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
  const el = document.documentElement;
  el.setAttribute("data-lang", next);
  el.lang = next;
  listeners.forEach((cb) => cb());
}

/**
 * Translate a key for the given locale. Supports {var} interpolation.
 * Falls back to the key itself when missing (makes gaps obvious in dev).
 */
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const dict = dictionaries[locale];
  let s = dict[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

export { subscribe, getSnapshot, getServerSnapshot };
