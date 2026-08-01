"use client";

import { useState, useCallback } from "react";

export function useAsync<T>(initialState?: T, options?: { initialLoading?: boolean }) {
  const [loading, setLoading] = useState(options?.initialLoading ?? false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | undefined>(initialState);

  const run = useCallback(async <R = T>(fn: () => Promise<R>, options?: { setData?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      if (options?.setData !== false) {
        setData(result as unknown as T);
      }
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setData(initialState);
  }, [initialState]);

  return { loading, error, data, setData, setError, run, reset };
}
