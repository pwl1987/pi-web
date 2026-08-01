import { resolve as pathResolve } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

/**
 * Rewrite only the `parentSession` field in the first line (session header) of
 * a `.jsonl` session file, returning the new file contents.
 *
 * The rest of the file is preserved **byte-for-byte** — every message,
 * compaction, and session_info entry after the header is returned verbatim.
 * This matters because the previous DELETE handler split the entire file into
 * lines, re-serialized the header, and `join("\n")`-rewrote the whole file,
 * which (a) normalized any original line endings and (b) fully rewrote large
 * session files just to change one header field.
 *
 * Used by `DELETE /api/sessions/[id]` to cascade re-parent children.
 *
 * @param fileContents - the full original `.jsonl` file text
 * @param newParentSession - the new `parentSession` value (absolute path), or
 *   `undefined` to detach the session from its parent.
 * @returns the new file contents, with only the header line changed. If the
 *   first line is not a valid `session` header JSON, the input is returned
 *   unchanged.
 */
export function reparentSessionHeader(
  fileContents: string,
  newParentSession: string | undefined,
): string {
  const newlineIdx = fileContents.indexOf("\n");
  // firstLine excludes the trailing newline; rest includes everything after it.
  const firstLine = newlineIdx === -1 ? fileContents : fileContents.slice(0, newlineIdx);
  const rest = newlineIdx === -1 ? "" : fileContents.slice(newlineIdx + 1);

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(firstLine) as Record<string, unknown>;
  } catch {
    // Malformed header — leave the file untouched rather than corrupt it.
    return fileContents;
  }

  if (header.type !== "session") {
    // First line isn't a session header (e.g. a file starting with a message).
    return fileContents;
  }

  header.parentSession = newParentSession;
  const newFirstLine = JSON.stringify(header);

  if (newlineIdx === -1) return newFirstLine;
  return newFirstLine + "\n" + rest;
}

// ============================================================================
// L3：fork 外键从「绝对路径」收敛为「cwd 相对键」
//   相对键格式（与 SDK 会话目录布局对齐）：`<--encodedCwd-->/<id>.jsonl`
//     - `--encodedCwd--` 是 SDK getDefaultSessionDirPath 对 cwd 的编码目录名
//     - `<id>` 是父会话 header.id（纯 id，足以在 listAll 的 byId 中唯一定位）
//   相对键只依赖 cwd + id（两者都写在 header 里，随文件迁移），
//   不再依赖会话目录的绝对路径——会话目录被移动/重命名/跨机迁移后树结构不断裂。
// ============================================================================

const RELATIVE_KEY_RE = /^--[^/]+--\/.+\.jsonl$/;
const ORCHESTRATOR_RE = /^orchestrator:[\w-]+$/;

/**
 * 判断一个 parentSession 值是否已是新的相对键（而非旧绝对路径 / orchestrator marker）。
 */
export function isRelativeKey(value: unknown): value is string {
  return typeof value === "string" && RELATIVE_KEY_RE.test(value);
}

/**
 * 把 SDK 遗留的「绝对路径」父外键改写为 L3 相对键。
 * 纯函数，幂等：
 *   - 已是相对键 → 原样返回
 *   - orchestrator marker → 原样返回（属 plan-mode 另一套，L3 不波及）
 *   - 无 parentSession → 原样返回
 *   - 旧绝对路径 → 从路径自身提取 `--encodedCwd--` 目录名与 `id`（文件名去时间戳前缀），
 *     拼接为 `<--encodedCwd-->/<id>.jsonl`。
 *   采用「从路径自身提取」而非用 header.cwd 重新编码，避免双编码漂移。
 */
export function reparentHeader(header: Record<string, unknown>): Record<string, unknown> {
  const parent = header.parentSession;

  // 已是相对键 / orchestrator marker / 缺失 → 不动
  if (parent == null || isRelativeKey(parent) || ORCHESTRATOR_RE.test(String(parent))) {
    return header;
  }

  if (typeof parent !== "string") return header;

  // 旧绝对路径：<agentDir>/sessions/<--encodedCwd-->/<timestamp>_<id>.jsonl
  const normalized = parent.replace(/\\/g, "/");
  const segments = normalized.split("/");
  // 末段 = <timestamp>_<id>.jsonl
  const fileSeg = segments[segments.length - 1] ?? "";
  const extIdx = fileSeg.lastIndexOf(".jsonl");
  if (extIdx <= 0) return header;
  const idWithExt = fileSeg.slice(0, extIdx) + ".jsonl";
  // 去掉 <timestamp>_ 前缀（首个下划线之前的部分）
  const underIdx = idWithExt.indexOf("_");
  const id = underIdx >= 0 ? idWithExt.slice(underIdx + 1) : idWithExt;
  // 编码目录名 = 倒数第二段
  const dirSeg = segments[segments.length - 2] ?? "";
  if (!dirSeg.startsWith("--") || !dirSeg.endsWith("--")) return header;

  const newHeader = { ...header };
  newHeader.parentSession = `${dirSeg}/${id}`;
  return newHeader;
}

/**
 * 构造 L3 相对键（用于「新写入」场景，复刻 SDK 编码规则）。
 * cwd 经 encodePathComponent 得到 `--encodedCwd--`，与 SDK getDefaultSessionDirPath 同款。
 */
export function encodePathComponent(cwd: string): string {
  // 复刻 SDK resolvePath：绝对路径 → path.resolve；与 SDK 编码完全对齐。
  const resolved = pathResolve(cwd)
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-");
  return `--${resolved}--`;
}

export function toParentKey(cwd: string, id: string): string {
  return `${encodePathComponent(cwd)}/${id}.jsonl`;
}

// ============================================================================
// L3 渐进迁移器：扫描所有会话，将遗留「绝对路径」父外键改写为相对键。
//   - 幂等：已是相对键 / orchestrator marker / 无 parent 直接跳过
//   - 仅重写发生变化的 header 首行，其余字节原样保留（复用 reparentSessionHeader）
//   - 单次进程生命周期内只跑一次（globalThis 去重 guard，仿路径缓存 TTL 模式）
//   - PI_WEB_DISABLE_REPARENT=1 整体关闭（仿 S1/S2 降级开关）
//   - 单个文件损坏不应阻断整次扫描（逐文件 try/catch）
// ============================================================================

declare global {
  var __piReparentedAt: number | undefined;
}

const REPART_GUARD_MS = 60_000;

export interface ReparentResult {
  scanned: number;
  migrated: number;
  skipped: number;
  errors: number;
}

/**
 * 运行一次渐进迁移。返回统计；已迁移过（guard 未过期）则直接返回跳过。
 * @param listPaths 提供所有会话文件绝对路径的惰性函数（默认经 pi adapter 的 SDK listAll）
 */
export async function ensureReparented(
  listPaths?: () => Promise<Array<{ path: string }>>,
): Promise<ReparentResult | null> {
  if (process.env.PI_WEB_DISABLE_REPARENT === "1") return null;
  const now = Date.now();
  if (globalThis.__piReparentedAt && now - globalThis.__piReparentedAt < REPART_GUARD_MS) {
    return null;
  }

  const list = listPaths ?? defaultListPaths;
  let paths: Array<{ path: string }>;
  try {
    paths = await list();
  } catch {
    return { scanned: 0, migrated: 0, skipped: 0, errors: 1 };
  }

  const result: ReparentResult = { scanned: 0, migrated: 0, skipped: 0, errors: 0 };
  for (const { path } of paths) {
    result.scanned++;
    try {
      const migrated = reparentFileIfNeeded(path);
      if (migrated) result.migrated++;
      else result.skipped++;
    } catch {
      result.errors++;
    }
  }

  globalThis.__piReparentedAt = now;
  return result;
}

async function defaultListPaths(): Promise<Array<{ path: string }>> {
  const { getPiAdapter } = await import("./pi");
  const all = await getPiAdapter().SessionManager.listAll();
  return all.map((s) => ({ path: s.path }));
}

function reparentFileIfNeeded(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const contents = readFileSync(filePath, "utf8");
  const newlineIdx = contents.indexOf("\n");
  const firstLine = newlineIdx === -1 ? contents : contents.slice(0, newlineIdx);

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(firstLine);
  } catch {
    return false;
  }
  if (header.type !== "session") return false;
  if (header.parentSession == null) return false;
  if (isRelativeKey(header.parentSession) || ORCHESTRATOR_RE.test(String(header.parentSession))) {
    return false;
  }

  // 是遗留绝对路径 → 改写为相对键
  const newHeader = reparentHeader(header);
  if (newHeader === header) return false; // 解析不出结构化组件，跳过避免误改
  const newFirstLine = JSON.stringify(newHeader);
  const rest = newlineIdx === -1 ? "" : contents.slice(newlineIdx + 1);
  writeFileSync(filePath, newlineIdx === -1 ? newFirstLine : newFirstLine + "\n" + rest);
  return true;
}
