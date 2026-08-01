"use client";

import { useEffect } from "react";

export function shouldUseVisualViewportHeight(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.visualViewport !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !("MSStream" in window)
  );
}

export function useViewportHeight(): void {
  useEffect(() => {
    if (!shouldUseVisualViewportHeight()) return;
    const setViewportHeight = () => {
      if (!window.visualViewport) return;
      document.documentElement.style.setProperty(
        "--app-viewport-height",
        `${window.visualViewport.height}px`,
      );
    };
    setViewportHeight();
    window.visualViewport?.addEventListener("resize", setViewportHeight);
    window.addEventListener("orientationchange", setViewportHeight);
    return () => {
      window.visualViewport?.removeEventListener("resize", setViewportHeight);
      window.removeEventListener("orientationchange", setViewportHeight);
    };
  }, []);
}
