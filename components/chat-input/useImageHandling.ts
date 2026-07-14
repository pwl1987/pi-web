"use client";

import { useCallback, useState } from "react";
import type { AttachedImage } from "@/lib/types";
import {
  imageToDraftImage,
  draftImageToAttachedImage,
  revokeImagePreview,
} from "@/lib/image-utils";

/** 图片附件处理：添加/删除/清空。 */
export function useImageHandling(isStreaming: boolean) {
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

  const processImageFiles = useCallback(
    async (files: File[]) => {
      if (isStreaming) return;
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      if (!imageFiles.length) return;
      const newImages = await Promise.all(
        imageFiles.map(
          (file) =>
            new Promise<AttachedImage>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                const base64 = result.split(",")[1];
                resolve({
                  data: base64,
                  mimeType: file.type,
                  previewUrl: URL.createObjectURL(file),
                });
              };
              reader.onerror = reject;
              reader.readAsDataURL(file);
            }),
        ),
      );
      setAttachedImages((prev) => [...prev, ...newImages]);
    },
    [isStreaming],
  );

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) revokeImagePreview(removed);
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return [];
    });
  }, []);

  return {
    attachedImages,
    setAttachedImages,
    processImageFiles,
    removeImage,
    clearImages,
  } as const;
}

/** 重新导出工具函数供外部使用 */
export { imageToDraftImage, draftImageToAttachedImage, revokeImagePreview };
