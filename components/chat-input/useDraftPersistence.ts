"use client";

import { useRef, useEffect, useCallback } from "react";
import { clearDraft, getDraft, setDraft } from "@/lib/draft-store";
import {
  imageToDraftImage,
  draftImageToAttachedImage,
  revokeImagePreview,
} from "@/lib/image-utils";
import type { AttachedImage } from "@/lib/types";

interface UseDraftPersistenceParams {
  draftKey?: string;
  value: string;
  attachedImages: AttachedImage[];
  setValue: (v: string) => void;
  setAttachedImages: (updater: (prev: AttachedImage[]) => AttachedImage[]) => void;
}

/** 草稿持久化：自动保存/恢复文本框内容、图片与光标位置。 */
export function useDraftPersistence({
  draftKey,
  value,
  attachedImages,
  setValue,
  setAttachedImages,
}: UseDraftPersistenceParams) {
  const draftKeyRef = useRef(draftKey);
  const valueRef = useRef(value);
  const attachedImagesRef = useRef(attachedImages);
  const draftMountedRef = useRef(false);

  valueRef.current = value;
  attachedImagesRef.current = attachedImages;

  // 自动保存草稿（跳过初始 hydration）
  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    if (!draftMountedRef.current) {
      draftMountedRef.current = true;
      return;
    }
    const ta = document.querySelector<HTMLTextAreaElement>("[data-chat-input-textarea]");
    setDraft(draftKey, {
      value,
      images: attachedImages.map(imageToDraftImage),
      selectionStart: ta ? ta.selectionStart : null,
      selectionEnd: ta ? ta.selectionEnd : null,
    });
  }, [attachedImages, draftKey, value]);

  // 恢复光标位置
  useEffect(() => {
    if (!draftKey) return;
    const ta = document.querySelector<HTMLTextAreaElement>("[data-chat-input-textarea]");
    if (!ta) return;
    const draft = getDraft(draftKey);
    const raf = requestAnimationFrame(() => {
      const len = ta.value.length;
      const start = draft?.selectionStart ?? len;
      const end = draft?.selectionEnd ?? len;
      const s = Math.max(0, Math.min(start, len));
      const e = Math.max(0, Math.min(end, len));
      try {
        ta.setSelectionRange(s, e);
      } catch {
        // 无效 range，浏览器保持默认光标
      }
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [draftKey]);

  // draftKey 切换时保存旧草稿并加载新草稿
  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    if (previousDraftKey === draftKey) return;

    if (previousDraftKey) {
      const ta = document.querySelector<HTMLTextAreaElement>("[data-chat-input-textarea]");
      setDraft(previousDraftKey, {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
        selectionStart: ta ? ta.selectionStart : null,
        selectionEnd: ta ? ta.selectionEnd : null,
      });
    }

    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef.current = draftKey;
    setValue(draft?.value ?? "");
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return draft?.images.map(draftImageToAttachedImage) ?? [];
    });
  }, [draftKey, setValue, setAttachedImages]);

  /** 清空当前 draftKey 对应的草稿（发送后调用）。 */
  const clearCurrentDraft = () => {
    if (draftKey) clearDraft(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) clearDraft(draftKeyRef.current);
  };

  /** 立即持久化草稿（用于光标移动等不触发 effect 的场景）。 */
  const persistCursor = useCallback(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    const ta = document.querySelector<HTMLTextAreaElement>("[data-chat-input-textarea]");
    setDraft(draftKey, {
      value: valueRef.current,
      images: attachedImagesRef.current.map(imageToDraftImage),
      selectionStart: ta ? ta.selectionStart : null,
      selectionEnd: ta ? ta.selectionEnd : null,
    });
  }, [draftKey]);

  return { draftKeyRef, clearCurrentDraft, persistCursor } as const;
}
