"use client";

import { useState, useCallback, useEffect } from "react";

export function useSave(options?: { savedTimeoutMs?: number }) {
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const timeoutMs = options?.savedTimeoutMs ?? 2000;

  useEffect(() => {
    if (savedOk) {
      const timer = setTimeout(() => setSavedOk(false), timeoutMs);
      return () => clearTimeout(timer);
    }
  }, [savedOk, timeoutMs]);

  const startSave = useCallback(() => {
    setSaving(true);
    setSavedOk(false);
  }, []);

  const endSave = useCallback((success: boolean = true) => {
    setSaving(false);
    if (success) {
      setSavedOk(true);
    }
  }, []);

  const runSave = useCallback(
    async <R>(fn: () => Promise<R>) => {
      startSave();
      try {
        const result = await fn();
        endSave(true);
        return result;
      } catch (e) {
        endSave(false);
        throw e;
      }
    },
    [startSave, endSave],
  );

  return { saving, savedOk, startSave, endSave, runSave };
}
