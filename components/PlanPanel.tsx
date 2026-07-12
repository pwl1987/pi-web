// PlanPanel —— 多 Agent 协同讨论的前端载体
// 负责：发起讨论（需求输入）→ 实时讨论时间线（SSE）→ 多套推荐方案选择/修改/退回
// → 确认交接自主编程引擎。所有状态来自编排器快照（lib/agent-orchestrator）。

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  usePlanMode,
  setPlanMode,
  setOrchestratorId,
  setPlanStatus,
  requestOpenEngine as setRequestOpenEngine,
} from "@/lib/plan-mode-store";
import type { OrchestrationSnapshot, RecommendationPlan } from "@/lib/agent-orchestrator";

const COLOR_DOT: Record<string, string> = {
  sky: "background:#0ea5e9",
  violet: "background:#8b5cf6",
  blue: "background:#3b82f6",
  emerald: "background:#10b981",
  teal: "background:#14b8a6",
  amber: "background:#f59e0b",
  rose: "background:#f43f5e",
  cyan: "background:#06b6d4",
  fuchsia: "background:#d946ef",
  orange: "background:#f97316",
  lime: "background:#84cc16",
  slate: "background:#64748b",
  indigo: "background:#6366f1",
};
function dot(color: string): CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block",
    ...(COLOR_DOT[color] ? { background: COLOR_DOT[color] } : { background: "#64748b" }),
  };
}

const STATUS_LABEL: Record<string, string> = {
  idle: "idle",
  parsing: "plan.parsing",
  discussing: "plan.discussing",
  synthesizing: "plan.synthesizing",
  awaiting_confirm: "plan.awaitingConfirm",
  executing: "plan.executing",
  done: "plan.done",
  failed: "plan.failed",
  cancelled: "plan.cancelled",
};

export function PlanPanel() {
  const { t } = useI18n();
  const { planMode, orchestratorId } = usePlanMode();
  const [snapshot, setSnapshot] = useState<OrchestrationSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/plan/${id}`);
      if (res.ok) {
        const snap = (await res.json()) as OrchestrationSnapshot;
        setSnapshot(snap);
        setPlanStatus(snap.status);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // SSE：连接事件流，按事件刷新快照并把状态同步到 store（供输入框判断交互方式）。
  useEffect(() => {
    if (!orchestratorId) {
      setSnapshot(null);
      return;
    }
    const es = new EventSource(`/api/plan/${orchestratorId}/events`);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as { type: string; snapshot?: OrchestrationSnapshot };
        if (e.type === "snapshot" && e.snapshot) {
          setSnapshot(e.snapshot);
          setPlanStatus(e.snapshot.status);
        } else if (orchestratorId) void refresh(orchestratorId);
      } catch {
        /* ignore malformed */
      }
    };
    return () => es.close();
  }, [orchestratorId, refresh]);

  const selectPlan = useCallback(
    async (planId: string) => {
      if (!orchestratorId) return;
      setSnapshot((s) => (s ? { ...s, selectedPlanId: planId } : s));
      try {
        await fetch(`/api/plan/${orchestratorId}/select`, {
          method: "POST",
          headers: csrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ planId }),
        });
      } catch {
        /* ignore */
      }
    },
    [orchestratorId],
  );

  const confirmPlan = useCallback(
    async (planId?: string) => {
      if (!orchestratorId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/plan/${orchestratorId}/confirm`, {
          method: "POST",
          headers: csrfHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ planId }),
        });
        const data = (await res.json()) as { error?: string; runId?: string };
        if (!res.ok) throw new Error(data.error ?? "确认失败");
        // 讨论已交接给编程引擎，清空编排器状态以便下次以干净状态进入。
        setOrchestratorId(null);
        setPlanStatus("idle");
        setPlanMode(false); // 关闭计划模式，避免 AppShell 把它重新弹回计划面板
        setRequestOpenEngine(true); // AppShell 打开引擎面板
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [orchestratorId, busy],
  );

  // 退出计划模式 → 回到普通聊天模式（状态保留在 store 中，可再次进入恢复）。
  const exitPlan = useCallback(() => setPlanMode(false), []);
  // 新建讨论：清空当前编排器与状态，回到需求输入界面（状态由输入框统一录入）。
  const newDiscussion = useCallback(() => {
    setOrchestratorId(null);
    setPlanStatus("idle");
    setSnapshot(null);
    setError(null);
  }, []);

  // 计划模式下始终可见的头部工具条：标题 + 退出按钮，确保任何状态都能退回普通模式。
  const modeHeader = (extra?: ReactNode) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{t("plan.mode")}</span>
      {extra}
      <button onClick={exitPlan} style={closeBtnStyle} title={t("plan.exit")}>
        ✕
      </button>
    </div>
  );

  // 未进入计划模式：提示先开启。
  if (!planMode) {
    return (
      <div style={{ padding: 24, color: "var(--text-muted)", fontSize: 13 }}>
        {t("plan.toolbarHint")}
      </div>
    );
  }

  // 尚未发起讨论：输入框已在底部统一接管需求录入，这里仅给出引导提示。
  if (!orchestratorId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {modeHeader()}
        <div
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            overflow: "auto",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            {t("plan.mode")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
            {t("plan.enterHint")}
          </div>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {modeHeader()}
        <div style={{ padding: 24, color: "var(--text-muted)", fontSize: 13 }}>
          {t("plan.parsing")}
        </div>
      </div>
    );
  }

  const s = snapshot;
  const showPlans =
    s.status === "awaiting_confirm" || s.status === "executing" || s.status === "done";
  const convergeReason =
    s.convergence.reason !== "none" && s.convergence.converged
      ? t(`plan.converge.${s.convergence.reason}`)
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* 头部：状态 + 轮次进度 + 退出 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
          {t("plan.mode")}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {s.status === "discussing"
            ? t("plan.discussing", { round: s.rounds.length || 1, max: s.config.maxRounds })
            : t(STATUS_LABEL[s.status] ?? s.status)}
        </span>
        {convergeReason && (
          <span style={{ fontSize: 11, color: "var(--accent)" }}>
            · {t("plan.consensus", { reason: convergeReason })}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={newDiscussion}
            disabled={busy}
            style={{
              padding: "4px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--text-muted)",
              fontSize: 12,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
            title={t("plan.newDiscussion")}
          >
            {t("plan.newDiscussion")}
          </button>
          <button
            onClick={exitPlan}
            style={{ ...closeBtnStyle, marginLeft: 0 }}
            title={t("plan.exit")}
          >
            ✕
          </button>
        </div>
      </div>

      {/* 参与角色 */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: "8px 14px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {s.agents.map((a) => (
          <span
            key={a.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              color: "var(--text-muted)",
            }}
          >
            <span style={dot(a.color)} />
            {a.roleName}
            {a.status === "thinking" && <span style={{ color: "var(--accent)" }}>…</span>}
          </span>
        ))}
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 14 }}>
        {error && (
          <div style={{ color: "var(--danger, #f43f5e)", fontSize: 12, marginBottom: 10 }}>
            {error}
          </div>
        )}

        {/* 讨论时间线 */}
        {!showPlans && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {s.messages.map((m) => (
              <div key={m.id} style={{ display: "flex", gap: 8 }}>
                <span
                  style={{
                    ...dot(
                      m.kind === "arbiter"
                        ? "slate"
                        : (s.agents.find((a) => a.roleId === m.from)?.color ?? "slate"),
                    ),
                    marginTop: 5,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
                    {m.kind === "user" ? t("plan.requirement") : m.fromName}
                    {m.round > 0 && (
                      <span style={{ opacity: 0.7 }}> · {t("plan.round", { round: m.round })}</span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--text)",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.5,
                      maxHeight: 220,
                      overflow: "auto",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "8px 10px",
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              </div>
            ))}
            {s.status === "discussing" && (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t("plan.discussing", { round: s.rounds.length || 1, max: s.config.maxRounds })}…
              </div>
            )}
          </div>
        )}

        {/* 推荐方案 */}
        {showPlans && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
              {t("plan.plans")}
            </div>
            {s.plans.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("plan.emptyDraft")}</div>
            )}
            {s.plans.map((p: RecommendationPlan) => {
              const selected = s.selectedPlanId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => selectPlan(p.id)}
                  style={{
                    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 10,
                    padding: 12,
                    background: selected
                      ? "color-mix(in srgb, var(--accent) 8%, transparent)"
                      : "var(--bg)",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
                      {p.title}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {t("plan.confidence")}: {Math.round(p.confidence * 100)}%
                    </span>
                  </div>
                  <div
                    style={{ fontSize: 12.5, color: "var(--text)", marginTop: 6, lineHeight: 1.5 }}
                  >
                    {p.summary}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <PlanList
                      title={t("plan.pros")}
                      items={p.pros}
                      color="var(--accent, #10b981)"
                    />
                    <PlanList
                      title={t("plan.cons")}
                      items={p.cons}
                      color="var(--danger, #f43f5e)"
                    />
                  </div>
                  <PlanList
                    title={t("plan.scenarios")}
                    items={p.scenarios}
                    color="var(--text-muted)"
                  />
                </div>
              );
            })}

            {/* 执行任务（确认后） */}
            {s.status === "done" && s.tasks.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div
                  style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}
                >
                  {t("plan.tasks")}
                </div>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--text)" }}>
                  {s.tasks.map((tk) => (
                    <li key={tk.id} style={{ marginBottom: 4 }}>
                      {tk.title}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {showPlans && s.status !== "done" && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              onClick={() => confirmPlan(s.selectedPlanId)}
              disabled={!s.selectedPlanId || busy}
              style={{
                flex: 1,
                padding: "9px 14px",
                borderRadius: 9,
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontWeight: 600,
                cursor: s.selectedPlanId && !busy ? "pointer" : "not-allowed",
                opacity: s.selectedPlanId && !busy ? 1 : 0.5,
              }}
            >
              {busy ? t("plan.executing") : t("plan.confirmAndCode")}
            </button>
          </div>
        )}

        {s.status === "done" && (
          <button
            onClick={() => {
              setOrchestratorId(null);
              setPlanStatus("idle");
              setPlanMode(false);
              setRequestOpenEngine(true);
            }}
            style={{
              padding: "9px 14px",
              borderRadius: 9,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("plan.openEngine")}
          </button>
        )}
      </div>
    </div>
  );
}

function PlanList({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color, marginBottom: 2 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--text)" }}>
        {items.map((it, i) => (
          <li key={i} style={{ marginBottom: 2 }}>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

const closeBtnStyle: CSSProperties = {
  marginLeft: "auto",
  background: "none",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
};
