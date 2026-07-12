// comet-adapter.ts —— 唯一导入/调用 vendor/comet 的适配层
// 实现 WorkflowStateMachinePort：所有状态机操作经白名单 child_process 调用 comet .mjs。
import { runCometScript, cometGet } from "./guards/comet-cli";
import type { WorkflowStateMachinePort } from "./workflow-state-machine-ports";
import type { ChangeState, Stage } from "./unified-engine-types";

function eventForPhase(phase: Stage): string {
  if (phase === "verify") return "verify-pass";
  return `${phase}-complete`;
}

async function readState(change: string, cwd: string): Promise<ChangeState> {
  const [phase, workflow, runId] = await Promise.all([
    cometGet(change, "phase", cwd),
    cometGet(change, "workflow", cwd),
    cometGet(change, "run_id", cwd),
  ]);
  return {
    name: change,
    workflow: workflow || "classic",
    phase: (phase || "open") as Stage,
    runId: runId || undefined,
  };
}

export function createCometAdapter(): WorkflowStateMachinePort {
  return {
    async openChange(change, workflow, cwd) {
      await runCometScript("comet-state.mjs", ["init", change, workflow], cwd);
      return readState(change, cwd);
    },
    getState(change, cwd) {
      return readState(change, cwd);
    },
    async advanceStage(change, phase, cwd) {
      const from = phase;
      const { code } = await runCometScript("comet-guard.mjs", [change, phase, "--apply"], cwd);
      if (code !== 0) {
        throw new Error(`阶段推进被守卫阻止：${change}@${phase}`);
      }
      const next = await readState(change, cwd);
      return {
        change,
        from,
        to: next.phase,
        event: eventForPhase(phase),
        at: new Date().toISOString(),
      };
    },
    async evaluateGuard(change, phase, cwd) {
      const { stdout, code } = await runCometScript("comet-guard.mjs", [change, phase], cwd);
      return {
        change,
        phase,
        passed: code === 0,
        message: stdout.trim() || (code === 0 ? "守卫通过" : "守卫未通过"),
      };
    },
    resumeRun(change, cwd) {
      return readState(change, cwd);
    },
  };
}

let registered: WorkflowStateMachinePort | null = null;

export function registerCometAdapter(
  adapter: WorkflowStateMachinePort = createCometAdapter(),
): void {
  registered = adapter;
}

export function getCometAdapter(): WorkflowStateMachinePort {
  if (!registered) registered = createCometAdapter();
  return registered;
}
