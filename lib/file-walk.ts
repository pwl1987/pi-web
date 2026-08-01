import fs from "fs";
import path from "path";

export interface WalkDirectoryOptions {
  /** 单目录 entry 处理上限，防止单个巨型目录阻塞 / 饿死同级目录。 */
  maxDirEntries?: number;
  /** 全局收集文件数硬上限，防止单次响应过大。 */
  walkHardCap?: number;
  /** 递归深度上限。 */
  maxDepth?: number;
  /** 跳过的目录 / 文件名集合（如 node_modules）。 */
  ignoredNames?: ReadonlySet<string>;
  /** 跳过的文件后缀（如 .lock）。 */
  ignoredSuffixes?: readonly string[];
}

export interface WalkDirectoryResult {
  files: string[];
  hardTruncated: boolean;
}

const DEFAULT_MAX_DIR_ENTRIES = Number(process.env.PI_WEB_MAX_DIR_ENTRIES ?? 20_000);
const DEFAULT_WALK_HARD_CAP = Number(process.env.PI_WEB_WALK_HARD_CAP ?? 50_000);
const DEFAULT_MAX_WALK_DEPTH = 8;

/**
 * 广度优先遍历目录，收集相对文件路径。
 *
 * 防护层次：
 * - `walkHardCap`：全局文件数硬上限（防止单次响应过大 / OOM）。
 * - `maxDirEntries`：单目录 entry 处理上限（防止单个巨型目录同步阻塞，
 *   或耗尽全局预算导致同级目录被饿死）。
 * - `maxDepth`：递归深度上限。
 *
 * 纯逻辑，可在 node:test 中以临时目录直接验证。
 */
export function walkDirectory(
  cwd: string,
  options: WalkDirectoryOptions = {},
): WalkDirectoryResult {
  const maxDirEntries = options.maxDirEntries ?? DEFAULT_MAX_DIR_ENTRIES;
  const walkHardCap = options.walkHardCap ?? DEFAULT_WALK_HARD_CAP;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_WALK_DEPTH;
  const ignoredNames = options.ignoredNames ?? new Set<string>();
  const ignoredSuffixes = options.ignoredSuffixes ?? [];

  const files: string[] = [];
  let hardTruncated = false;
  let walkStop = false;
  const queue: Array<{ abs: string; rel: string; depth: number }> = [
    { abs: cwd, rel: "", depth: 0 },
  ];

  while (queue.length > 0) {
    const { abs, rel, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    let processed = 0;
    for (const d of dirents) {
      if (files.length >= walkHardCap) {
        hardTruncated = true;
        walkStop = true;
        break;
      }
      // 单目录 entry 上限：超出部分不再处理（仍继续处理其他同级目录）。
      if (processed >= maxDirEntries) {
        hardTruncated = true;
        break;
      }
      processed += 1;
      const name = d.name;
      if (ignoredNames.has(name) || ignoredSuffixes.some((suffix) => name.endsWith(suffix))) {
        continue;
      }
      const childAbs = path.join(abs, name);
      const childRel = rel ? path.join(rel, name) : name;
      if (d.isDirectory()) {
        queue.push({ abs: childAbs, rel: childRel, depth: depth + 1 });
      } else if (d.isFile()) {
        files.push(childRel);
      }
    }
    if (walkStop) break;
  }

  return { files, hardTruncated };
}
