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
import { csrfFetchJson } from "@/lib/csrf-fetch";
import {
  usePlanMode,
  setPlanMode,
  setOrchestratorId,
  setPlanStatus,
  setPlanConfig,
  requestOpenEngine as setRequestOpenEngine,
  type PlanConfigSlice,
  type ControllerMode,
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
  const { orchestratorId, planConfig } = usePlanMode();
  const [snapshot, setSnapshot] = useState<OrchestrationSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // 配置区 / 角色模型 / 日志 / 历史 相关状态
  const [modelOptions, setModelOptions] = useState<
    Array<{ id: string; name: string; provider: string }>
  >([]);
  const [roles, setRoles] = useState<Array<{ id: string; name: string; modelId: string | null }>>(
    [],
  );
  const [roleModels, setRoleModels] = useState<Record<string, string>>({});
  const [showConfig, setShowConfig] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);

  // 加载可选模型、角色库、当前角色→模型映射（配置区与角色模型下拉）。
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => setModelOptions(d.modelList ?? []))
      .catch(() => {});
    fetch("/api/plan/roles")
      .then((r) => r.json())
      .then((d) => setRoles(d.roles ?? []))
      .catch(() => {});
    fetch("/api/plan/config")
      .then((r) => r.json())
      .then((d) => setRoleModels(d.map ?? {}))
      .catch(() => {});
  }, []);

  // 保存某角色的底层模型（持久化到 /api/plan/config）。
  const setRoleModel = useCallback(
    async (roleId: string, modelId: string) => {
      const next = { ...roleModels, [roleId]: modelId };
      setRoleModels(next);
      try {
        await csrfFetchJson("/api/plan/config", {
          method: "PUT",
          body: { map: next },
        });
      } catch {
        /* ignore */
      }
    },
    [roleModels],
  );

  const loadLog = useCallback(async () => {
    if (!orchestratorId) return;
    try {
      const { data: d } = await csrfFetchJson<{ logs?: Array<Record<string, unknown>> }>(
        `/api/plan/${orchestratorId}/log?limit=200`,
      );
      setLogs(d.logs ?? []);
    } catch {
      /* ignore */
    }
  }, [orchestratorId]);

  const loadHistory = useCallback(async () => {
    try {
      const { data: d } = await csrfFetchJson<{ orchestrations?: Array<Record<string, unknown>> }>(
        "/api/plan/history",
      );
      setHistory(d.orchestrations ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  // 展开日志/历史视图时拉取并定期刷新日志。
  useEffect(() => {
    if (!showLog || !orchestratorId) return;
    void loadLog();
    void loadHistory();
    const timer = setInterval(() => void loadLog(), 4000);
    return () => clearInterval(timer);
  }, [showLog, orchestratorId, loadLog, loadHistory]);

  const refresh = useCallback(async (id: string) => {
    try {
      const { ok, data: snap } = await csrfFetchJson<OrchestrationSnapshot>(`/api/plan/${id}`);
      if (ok) {
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
        await csrfFetchJson(`/api/plan/${orchestratorId}/select`, {
          method: "POST",
          body: { planId },
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
        const { ok, data } = await csrfFetchJson<{ error?: string }>(
          `/api/plan/${orchestratorId}/confirm`,
          { method: "POST", body: { planId } },
        );
        if (!ok) throw new Error(data.error ?? "确认失败");
        // 讨论已交接给编程引擎，清空编排器状态以便下次以干净状态进入。
        setOrchestratorId(null);
        setPlanStatus("idle");
        setPlanMode(false); // 关闭计划模式，回到普通聊天
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

  // 尚未发起讨论：输入框已在底部统一接管需求录入，这里仅给出引导提示。
  if (!orchestratorId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {modeHeader(
          <button
            onClick={() => setShowConfig((v) => !v)}
            style={{
              marginLeft: "auto",
              padding: "4px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: showConfig
                ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                : "none",
              color: "var(--text-muted)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {t("plan.config")}
          </button>,
        )}
        {showConfig && (
          <ConfigSection
            planConfig={planConfig}
            onConfig={setPlanConfig}
            roles={roles}
            modelOptions={modelOptions}
            roleModels={roleModels}
            onRoleModel={setRoleModel}
          />
        )}
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
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("plan.persisted")}</div>
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
        {s.control?.lastDecision && (
          <span style={{ fontSize: 11, color: "var(--accent)" }}>
            · {t("plan.controllerPacing")}：
            {t(`plan.controllerAction.${s.control.lastDecision.action}`)} ·{" "}
            {s.control.lastDecision.reason}
          </span>
        )}
        {s.control?.tokensSavedEstimate ? (
          <span
            style={{
              fontSize: 11,
              color: "#10b981",
              border: "1px solid color-mix(in srgb, #10b981 40%, transparent)",
              borderRadius: 6,
              padding: "1px 6px",
            }}
          >
            {t("plan.tokensSaved")}：≈{s.control.tokensSavedEstimate}
          </span>
        ) : null}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setShowConfig((v) => !v)}
            style={{
              padding: "4px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: showConfig
                ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                : "none",
              color: "var(--text-muted)",
              fontSize: 12,
              cursor: "pointer",
            }}
            title={t("plan.config")}
          >
            {t("plan.config")}
          </button>
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

      {/* 配置区（可折叠） */}
      {showConfig && (
        <ConfigSection
          planConfig={planConfig}
          onConfig={setPlanConfig}
          roles={roles}
          modelOptions={modelOptions}
          roleModels={roleModels}
          onRoleModel={setRoleModel}
        />
      )}

      {/* 日志/历史切换 + 持久化提示 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 14px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <button
          onClick={() => setShowLog((v) => !v)}
          style={{
            padding: "3px 9px",
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: showLog ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "none",
            color: "var(--text-muted)",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {t("plan.log")} / {t("plan.history")}
        </button>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("plan.persisted")}</span>
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 14 }}>
        {showLog && <LogHistorySection logs={logs} history={history} />}
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

function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12, color: "var(--text)", width: 84, flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "var(--accent)" }}
      />
      <span style={{ fontSize: 11, color: "var(--text-muted)", width: 36, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

function ConfigSection({
  planConfig,
  onConfig,
  roles,
  modelOptions,
  roleModels,
  onRoleModel,
}: {
  planConfig: PlanConfigSlice;
  onConfig: (patch: Partial<PlanConfigSlice>) => void;
  roles: Array<{ id: string; name: string; modelId: string | null }>;
  modelOptions: Array<{ id: string; name: string; provider: string }>;
  roleModels: Record<string, string>;
  onRoleModel: (roleId: string, modelId: string) => void;
}) {
  const { t } = useI18n();
  const modes: ControllerMode[] = ["hybrid", "deterministic", "llm"];
  return (
    <div
      style={{
        borderBottom: "1px solid var(--border)",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "color-mix(in srgb, var(--bg) 60%, transparent)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("plan.configHint")}</div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--text)", width: 84, flexShrink: 0 }}>
          {t("plan.controllerMode")}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {modes.map((m) => {
            const active = planConfig.controllerMode === m;
            return (
              <button
                key={m}
                onClick={() => onConfig({ controllerMode: m })}
                style={{
                  padding: "3px 9px",
                  borderRadius: 7,
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  background: active
                    ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                    : "none",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {t(`plan.controller.${m}`)}
              </button>
            );
          })}
        </div>
      </div>

      <Slider
        label={t("plan.maxRounds")}
        min={1}
        max={8}
        value={planConfig.maxRounds}
        onChange={(v) => onConfig({ maxRounds: v })}
      />
      <Slider
        label={t("plan.stabilizeThreshold")}
        min={0.5}
        max={0.99}
        step={0.01}
        value={planConfig.stabilizeThreshold}
        onChange={(v) => onConfig({ stabilizeThreshold: v })}
      />
      <Slider
        label={t("plan.concurrency")}
        min={1}
        max={4}
        value={planConfig.concurrency}
        onChange={(v) => onConfig({ concurrency: v })}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>
          {t("plan.roleModel")}
        </span>
        {roles.length === 0 ? (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("plan.emptyHistory")}</span>
        ) : (
          roles.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", width: 90, flexShrink: 0 }}>
                {r.name}
              </span>
              <select
                value={roleModels[r.id] ?? ""}
                onChange={(e) => void onRoleModel(r.id, e.target.value)}
                style={{
                  flex: 1,
                  background: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 11,
                  padding: "3px 6px",
                }}
              >
                <option value="">{t("plan.roleModelDefault")}</option>
                {modelOptions.map((m) => (
                  <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LogHistorySection({
  logs,
  history,
}: {
  logs: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
}) {
  const { t } = useI18n();
  const levelColor: Record<string, string> = {
    debug: "#64748b",
    info: "#3b82f6",
    warn: "#f59e0b",
    error: "#f43f5e",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
          {t("plan.log")}
        </div>
        {logs.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("plan.emptyLog")}</div>
        ) : (
          <div
            style={{
              maxHeight: 200,
              overflow: "auto",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            {logs.map((l, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "4px 8px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 11,
                  alignItems: "baseline",
                }}
              >
                <span style={{ color: levelColor[String(l.level)] ?? "#64748b" }}>●</span>
                <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                  {String(l.at).slice(11, 19)}
                </span>
                <span style={{ color: "var(--text)" }}>{String(l.message)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
          {t("plan.history")}
        </div>
        {history.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("plan.emptyHistory")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {history.map((h, i) => (
              <div
                key={i}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 8,
                  fontSize: 11,
                }}
              >
                <div style={{ color: "var(--text)" }}>{String(h.requirement)}</div>
                <div style={{ color: "var(--text-muted)", marginTop: 2 }}>
                  {String(h.status)} · {t("plan.round", { round: Number(h.roundCount ?? 0) })} ·{" "}
                  {t("plan.tokensSaved")} ≈{Number(h.tokensSavedEstimate || 0)}
                </div>
              </div>
            ))}
          </div>
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
