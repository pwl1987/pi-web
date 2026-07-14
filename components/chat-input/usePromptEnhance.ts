"use client";

import { useCallback, useState } from "react";
import { csrfFetchJson } from "@/lib/csrf-fetch";

interface UsePromptEnhanceParams {
  value: string;
  setValue: (v: string) => void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  cwd?: string | null;
}

/** 智能提示增强：调用 /api/agent/enhance 优化当前输入。 */
export function usePromptEnhance({
  value,
  setValue,
  isStreaming,
  model,
  cwd,
}: UsePromptEnhanceParams) {
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceError, setEnhanceError] = useState("");
  const [showUndo, setShowUndo] = useState(false);
  const [originalBeforeEnhance, setOriginalBeforeEnhance] = useState("");

  const handleEnhance = useCallback(async () => {
    if (enhancing || isStreaming || !value.trim()) return;
    setEnhanceError("");
    setEnhancing(true);
    setOriginalBeforeEnhance(value);
    try {
      const { ok, data: d } = await csrfFetchJson<{ error?: string; enhanced?: string }>(
        "/api/agent/enhance",
        {
          method: "POST",
          body: { prompt: value, provider: model?.provider, modelId: model?.modelId, cwd },
        },
      );
      if (!ok) throw new Error(d.error ?? "Enhancement failed");
      setValue(d.enhanced ?? "");
      setShowUndo(true);
    } catch (e) {
      setEnhanceError(e instanceof Error ? e.message : String(e));
    }
    setEnhancing(false);
  }, [enhancing, isStreaming, value, model, cwd, setValue]);

  const handleEnhanceUndo = useCallback(() => {
    setValue(originalBeforeEnhance);
    setShowUndo(false);
  }, [originalBeforeEnhance, setValue]);

  const cancelUndo = useCallback(() => setShowUndo(false), []);

  return {
    enhancing,
    enhanceError,
    showUndo,
    handleEnhance,
    handleEnhanceUndo,
    cancelUndo,
  } as const;
}
