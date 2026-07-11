"use client";

import { useEffect, useState } from "react";

/**
 * Tracks browser connectivity via the online/offline events.
 * Returns `true` when the browser reports a live connection, `false` when it
 * is offline. Used to surface SSE / network disconnect state in the UI.
 *
 * SSR-safe: defaults to `true` until mounted in the browser.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
