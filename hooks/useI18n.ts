"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getServerSnapshot,
  getSnapshot,
  setLocale,
  subscribe,
  translate,
} from "@/lib/i18n";

/**
 * Bind the i18n store to React. Mirrors hooks/useTheme.ts.
 *
 * const { locale, t, toggle } = useI18n();
 * t("chatInput.send")            // → "Send" / "发送"
 * t("sidebar.newIn", { cwd })    // → "New session in {cwd}" with {cwd} filled
 */
export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      translate(locale, key, vars),
    [locale],
  );

  const toggle = useCallback(
    () => setLocale(locale === "zh" ? "en" : "zh"),
    [locale],
  );

  return { locale, t, toggle, setLocale };
}
