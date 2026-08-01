// P4：文件列表 / 元信息短 TTL 缓存。避免前端每次导航或重复请求都重扫文件系统
// （readdirSync / statSync）。以目录/文件 mtime 校验失效，内容变化立即反映；
// TTL 仅作为二次兜底，防止高频重复扫描。read/preview/download/watch 不缓存
// （内容敏感、流式）。存 globalThis 兼容热重载（函数内惰性初始化映射，测试可重置）。

const FILE_LIST_CACHE_TTL_MS = 1500;

export interface FileListCacheEntry {
  entries: unknown[];
  dirMtime: number;
  expiresAt: number;
}

export interface FileMetaCacheEntry {
  payload: Record<string, unknown>;
  mtimeMs: number;
  expiresAt: number;
}

declare global {
  var __piFileListCache: Map<string, FileListCacheEntry> | undefined;
  var __piFileMetaCache: Map<string, FileMetaCacheEntry> | undefined;
}

function getFileListCache(): Map<string, FileListCacheEntry> {
  if (!globalThis.__piFileListCache) globalThis.__piFileListCache = new Map();
  return globalThis.__piFileListCache;
}

function getFileMetaCache(): Map<string, FileMetaCacheEntry> {
  if (!globalThis.__piFileMetaCache) globalThis.__piFileMetaCache = new Map();
  return globalThis.__piFileMetaCache;
}

/** 命中目录列表缓存：TTL 未过期且目录 mtime 未变则返回缓存 entries，否则 null。 */
export function getCachedFileList(dirPath: string, dirMtime: number): unknown[] | null {
  const hit = getFileListCache().get(dirPath);
  if (hit && hit.expiresAt > Date.now() && hit.dirMtime === dirMtime) {
    return hit.entries;
  }
  return null;
}

export function setCachedFileList(dirPath: string, dirMtime: number, entries: unknown[]): void {
  getFileListCache().set(dirPath, {
    entries,
    dirMtime,
    expiresAt: Date.now() + FILE_LIST_CACHE_TTL_MS,
  });
}

/** 命中元信息缓存：TTL 未过期且文件 mtime 未变则返回缓存 payload，否则 null。 */
export function getCachedFileMeta(
  filePath: string,
  mtimeMs: number,
): Record<string, unknown> | null {
  const hit = getFileMetaCache().get(filePath);
  if (hit && hit.expiresAt > Date.now() && hit.mtimeMs === mtimeMs) {
    return hit.payload;
  }
  return null;
}

export function setCachedFileMeta(
  filePath: string,
  mtimeMs: number,
  payload: Record<string, unknown>,
): void {
  getFileMetaCache().set(filePath, {
    payload,
    mtimeMs,
    expiresAt: Date.now() + FILE_LIST_CACHE_TTL_MS,
  });
}
