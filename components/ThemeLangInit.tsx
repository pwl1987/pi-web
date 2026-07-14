"use client";

import { useEffect } from "react";
import { syncThemeCookie } from "@/hooks/useTheme";

/** 页面挂载时将 localStorage 中的主题/语言同步到 cookie，确保后续 SSR 可读到正确值 */
export function ThemeLangInit() {
  useEffect(() => {
    // 同步主题 cookie
    syncThemeCookie();

    // 同步语言 cookie
    try {
      const lang = localStorage.getItem("pi-language");
      if (lang === "zh" || lang === "en") {
        document.cookie = `pi-language=${lang};path=/;max-age=31536000;SameSite=Lax`;
      }
    } catch {
      // ignore
    }
  }, []);

  return null;
}
