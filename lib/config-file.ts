// Shared helpers for reading/writing plugin config files atomically.
// All writes use the tmp+rename pattern (see session-state-store.ts) so a crash
// mid-write never leaves a corrupt file.

import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

/** Resolve the pi agent directory. */
export function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

/** Read a JSON file, returning a fallback if missing/corrupt. */
export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Atomically write JSON to a file (write .tmp then rename). */
export function writeJsonFileAtomic(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, filePath);
}

/** Ensure parent directory exists (mkdir -p). */
export function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
