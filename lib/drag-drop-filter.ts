/**
 * 拖拽文件大小过滤纯逻辑（无 DOM 依赖，可由 node:test 覆盖）。
 */

export interface DroppableFileFilterOptions {
  /** 单文件大小上限（字节）；<=0 或未提供表示不限制。 */
  maxSizeBytes?: number;
}

export interface DroppableFileFilterResult {
  accepted: File[];
  rejected: File[];
}

/**
 * 按大小过滤可拖入的文件。超出 maxSizeBytes 的文件归入 rejected，其余 accepted。
 * 纯函数，便于单测；不依赖任何 DOM / React API。
 */
export function filterDroppableFiles(
  files: File[],
  opts?: DroppableFileFilterOptions,
): DroppableFileFilterResult {
  const max = opts?.maxSizeBytes;
  if (!max || max <= 0) return { accepted: files, rejected: [] };
  const accepted: File[] = [];
  const rejected: File[] = [];
  for (const f of files) {
    if (typeof f.size === "number" && f.size > max) rejected.push(f);
    else accepted.push(f);
  }
  return { accepted, rejected };
}
