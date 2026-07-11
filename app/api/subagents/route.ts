import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir, userInfo } from "os";

export const dynamic = "force-dynamic";

/** Resolve the subagents temp-scoped root: /tmp/pi-subagents-uid-<uid> */
function getSubagentsRoot(): string {
  const scope = `uid-${userInfo().uid}`;
  return join(tmpdir(), `pi-subagents-${scope}`);
}

interface AsyncStatus {
  runId?: string;
  sessionId?: string;
  mode?: string;
  state?: string;
  currentStep?: number;
  chainStepCount?: number;
  startedAt?: number;
  endedAt?: number;
  totalTokens?: number;
  totalCost?: number;
  steps?: Array<{
    agent?: string;
    status?: string;
    currentTool?: string;
    activityState?: string;
    turnCount?: number;
    toolCount?: number;
    tokens?: number;
    totalCost?: number;
  }>;
}

interface CompletedResult {
  runId?: string;
  agent?: string;
  success?: boolean;
  summary?: string;
  state?: string;
  totalTokens?: number;
  totalCost?: number;
}

// GET /api/subagents — scan async runs (active + completed) from temp dir.
export async function GET() {
  try {
    const root = getSubagentsRoot();
    if (!existsSync(root)) {
      return NextResponse.json({ active: [], completed: [] });
    }

    // Active runs: async-subagent-runs/<runId>/status.json
    const active: AsyncStatus[] = [];
    const runsDir = join(root, "async-subagent-runs");
    if (existsSync(runsDir)) {
      for (const runId of readdirSync(runsDir)) {
        const statusFile = join(runsDir, runId, "status.json");
        if (!existsSync(statusFile)) continue;
        try {
          const status = JSON.parse(readFileSync(statusFile, "utf8")) as AsyncStatus;
          active.push({ ...status, runId });
        } catch {
          /* skip corrupt */
        }
      }
    }

    // Completed runs: async-subagent-results/<runId>.json
    const completed: CompletedResult[] = [];
    const resultsDir = join(root, "async-subagent-results");
    if (existsSync(resultsDir)) {
      for (const file of readdirSync(resultsDir)) {
        if (!file.endsWith(".json")) continue;
        try {
          const result = JSON.parse(
            readFileSync(join(resultsDir, file), "utf8"),
          ) as CompletedResult;
          completed.push(result);
        } catch {
          /* skip corrupt */
        }
      }
    }

    // Sort: active by startedAt desc, completed by file mtime (approximated by read order reversed)
    active.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    completed.reverse();

    return NextResponse.json({ active, completed });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
