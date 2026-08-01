"use client";

import { useCallback, useState } from "react";
import { csrfFetchJson } from "@/lib/csrf-fetch";
import { setOrchestratorId, linkPlanSession } from "@/lib/plan-mode-store";

interface UsePlanModeSendParams {
  cwd?: string | null;
  planConfig?: unknown;
  onClearInput: () => void;
  onCancelUndo: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

/** Plan 模式发送逻辑：发起多智能体讨论 / 重新讨论。 */
export function usePlanModeSend({
  cwd,
  planConfig,
  onClearInput,
  onCancelUndo,
  t,
}: UsePlanModeSendParams) {
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  /** 计划模式下发送消息，返回 true 表示已处理（应跳过普通模式发送）。 */
  const sendPlanMessage = useCallback(
    async (msg: string, orchestratorId: string | null, planStatus: string | null) => {
      if (!msg || planBusy) return true;
      if (orchestratorId && planStatus !== "awaiting_confirm") return true;

      setPlanBusy(true);
      setPlanError(null);
      try {
        if (!orchestratorId) {
          const { ok, data } = await csrfFetchJson<{ id?: string; error?: string }>(
            "/api/plan/orchestrate",
            {
              method: "POST",
              body: { requirement: msg, cwd: cwd ?? undefined, config: planConfig },
            },
          );
          if (!ok || !data.id) throw new Error(data.error ?? t("plan.startFailed"));
          const orchId = data.id as string;

          // 同步建 pi session 作为侧栏入口
          if (cwd) {
            try {
              const { ok: newOk, data: newData } = await csrfFetchJson<{
                sessionId?: string;
              }>("/api/agent/new", {
                method: "POST",
                body: { cwd, type: "ensure_session" },
              });
              if (!newOk || !newData?.sessionId) {
                throw new Error("ensure_session returned no id");
              }
              const piId = newData.sessionId;
              const title = `📋 计划讨论：${msg.slice(0, 40)}`;
              await csrfFetchJson(`/api/agent/${encodeURIComponent(piId)}`, {
                method: "POST",
                body: { type: "set_session_name", name: title },
              });
              await csrfFetchJson(`/api/agent/${encodeURIComponent(piId)}`, {
                method: "POST",
                body: {
                  type: "set_session_parent",
                  parentSession: `orchestrator:${orchId}`,
                },
              });
              linkPlanSession(piId, { orchestratorId: orchId, cwd });
            } catch {
              // 侧栏入口失败非阻塞
            }
          }
          setOrchestratorId(orchId);
        } else {
          const { ok } = await csrfFetchJson(`/api/plan/${orchestratorId}/rediscuss`, {
            method: "POST",
            body: { feedback: msg },
          });
          if (!ok) throw new Error(t("plan.rediscussFailed"));
        }
        onClearInput();
        onCancelUndo();
      } catch (e) {
        setPlanError(e instanceof Error ? e.message : String(e));
      } finally {
        setPlanBusy(false);
      }
      return true;
    },
    [cwd, planConfig, planBusy, onClearInput, onCancelUndo, t],
  );

  return { planBusy, planError, sendPlanMessage } as const;
}
