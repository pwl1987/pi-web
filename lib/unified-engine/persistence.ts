// 自主引擎运行态持久化（best-effort）—— 落盘 <agentDir>/pi-web-engine-runs.jsonl，
// 进程空闲超时 / 重启后磁盘仍保留，按需从磁盘 rehydrate，避免运行历史丢失。
// 纯 fs 实现（不依赖上游适配层），可在 node 单测中直接 import。
// 整体重写（原子 tmp+rename）：引擎运行数量有限，逐行 append 收益低且损坏面更大。

import { writeFileSync, readFileSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { getAgentDir } from "../config-file.ts";
import type { RunState } from "./unified-engine-types.ts";

const STORE_FILE = "pi-web-engine-runs.jsonl";
export const MAX_RECORDS = 100;

export interface StoredEngineRun {
  id: string;
  updatedAt: number;
  run: RunState;
}

function storeFilePath(): string {
  return join(getAgentDir(), STORE_FILE);
}

/** 读取全部已持久化运行（按 updatedAt 升序；best-effort，损坏/缺失返回空数组）。 */
export function loadAllEngineRuns(): StoredEngineRun[] {
  try {
    const file = storeFilePath();
    if (!existsSync(file)) return [];
    const raw = readFileSync(file, "utf8").trim();
    if (!raw) return [];
    const out: StoredEngineRun[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as StoredEngineRun;
        if (parsed && typeof parsed.id === "string" && parsed.run) out.push(parsed);
      } catch {
        // 跳过单行损坏。
      }
    }
    return out.sort((a, b) => a.updatedAt - b.updatedAt);
  } catch {
    return [];
  }
}

/** upsert 一条运行态（按 runId；超出上限时丢弃最旧的记录）。 */
export function saveEngineRun(run: RunState): void {
  try {
    const all = loadAllEngineRuns();
    const record: StoredEngineRun = {
      id: run.runId,
      updatedAt: Date.parse(run.updatedAt) || Date.now(),
      run,
    };
    const idx = all.findIndex((r) => r.id === run.runId);
    if (idx >= 0) all[idx] = record;
    else all.push(record);
    all.sort((a, b) => a.updatedAt - b.updatedAt);
    const trimmed = all.slice(-MAX_RECORDS);
    const lines = trimmed.map((r) => JSON.stringify(r)).join("\n");
    const file = storeFilePath();
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, lines, "utf8");
    renameSync(tmp, file);
  } catch {
    // best-effort：持久化失败不阻断引擎。
  }
}

/** 仅用于测试 / 清理：清空持久化（best-effort）。 */
export function clearEngineRuns(): void {
  try {
    const file = storeFilePath();
    if (existsSync(file)) writeFileSync(file, "", "utf8");
  } catch {
    // ignore
  }
}
