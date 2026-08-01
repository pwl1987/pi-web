"use client";

import { useState, useCallback, useRef } from "react";
import { filterDroppableFiles } from "@/lib/drag-drop-filter";

export interface UseDragDropOptions {
  onDrop: (files: File[]) => void;
  /** 单文件大小上限（字节）；超出文件被拒绝并交给 onReject。 */
  maxFileSize?: number;
  /** 被大小限制拒绝的文件回调（用于 UI 提示）。 */
  onReject?: (rejected: File[]) => void;
}

export function useDragDrop(options: UseDragDropOptions) {
  const { onDrop, maxFileSize, onReject } = options;
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    const hasImages = Array.from(e.dataTransfer.items).some((item) =>
      item.type.startsWith("image/"),
    );
    if (!hasImages) return;
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const hasImages = Array.from(e.dataTransfer.items).some((item) =>
      item.type.startsWith("image/"),
    );
    if (!hasImages) return;
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback(() => {
    counterRef.current -= 1;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      counterRef.current = 0;
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      const { accepted, rejected } = filterDroppableFiles(files, {
        maxSizeBytes: maxFileSize,
      });
      if (rejected.length > 0) onReject?.(rejected);
      if (accepted.length > 0) onDrop(accepted);
    },
    [onDrop, maxFileSize, onReject],
  );

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
