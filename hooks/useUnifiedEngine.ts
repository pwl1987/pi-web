"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { csrfFetchJson } from "@/lib/csrf-fetch";
import type { EngineEvent, RunState } from "@/lib/unified-engine/unified-engine-types";

export interface UseUnifiedEngine {
  runs: RunState[];
  selectedRunId: string | null;
  events: EngineEvent[];
  cwd: string;
  title: string;
  loading: boolean;
  /** 控制操作（start/pause/resume）进行中，用于按钮禁用态。 */
  controlling: boolean;
  /** SSE 实时连接状态。 */
  connected: boolean;
  error: string | null;
  setCwd: (v: string) => void;
  setTitle: (v: string) => void;
  selectRun: (runId: string) => void;
  createChange: () => Promise<void>;
  controlRun: (runId: string, action: "start" | "pause" | "resume") => Promise<void>;
}

const SSE_RECONNECT_MS = 3000;
const EVENTS_CAP = 200;

export function useUnifiedEngine(): UseUnifiedEngine {
  const [runs, setRuns] = useState<RunState[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [cwd, setCwd] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { ok, data } = await csrfFetchJson<{ runs: RunState[] }>("/api/engine/runs", {
      method: "GET",
    });
    if (ok && data.runs) setRuns(data.runs);
    return data.runs ?? [];
  }, []);

  // SSE 订阅 + 断线重连（对齐 PlanPanel 的 onerror→setTimeout 重连模式）。
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      es = new EventSource("/api/engine/stream");
      setConnected(true);
      es.onmessage = (ev) => {
        try {
          const e = JSON.parse(ev.data) as EngineEvent;
          setEvents((prev) => [e, ...prev].slice(0, EVENTS_CAP));
          if (e.type !== "log" && e.type !== "guard") refresh();
        } catch {
          /* 忽略非法帧 */
        }
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        if (!closed) reconnectTimer = setTimeout(connect, SSE_RECONNECT_MS);
      };
    };
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createChange = useCallback(async () => {
    if (!title.trim() || !cwd.trim()) {
      setError("请填写标题与项目目录（cwd）");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { ok, status, data } = await csrfFetchJson<RunState & { error?: string }>(
        "/api/engine/changes",
        {
          method: "POST",
          body: { title: title.trim(), description: "", cwd: cwd.trim() },
        },
      );
      if (!ok || data.error) throw new Error(data.error ?? `创建失败：${status}`);
      const run = data;
      setRuns((prev) => [run, ...prev]);
      setSelectedRunId(run.runId);
      setTitle("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [title, cwd, refresh]);

  const controlRun = useCallback(
    async (runId: string, action: "start" | "pause" | "resume") => {
      setError(null);
      setControlling(true);
      // 乐观更新：立即反映进行中的状态，避免按钮闪烁。
      const optimistic: Record<string, RunState["status"]> = {
        start: "running",
        pause: "paused",
        resume: "running",
      };
      setRuns((prev) =>
        prev.map((r) => (r.runId === runId ? { ...r, status: optimistic[action] } : r)),
      );
      try {
        const { ok, status, data } = await csrfFetchJson<RunState & { error?: string }>(
          "/api/engine/runs",
          {
            method: "POST",
            body: { runId, action },
          },
        );
        if (!ok || data.error) throw new Error(data.error ?? `操作失败：${status}`);
        const run = data;
        setRuns((prev) => prev.map((r) => (r.runId === run.runId ? run : r)));
        setSelectedRunId(run.runId);
      } catch (e) {
        setError((e as Error).message);
        // 失败回滚：重新拉取真实状态。
        await refresh();
      } finally {
        setControlling(false);
      }
    },
    [refresh],
  );

  const selectRun = useCallback((runId: string) => setSelectedRunId(runId), []);

  return {
    runs,
    selectedRunId,
    events,
    cwd,
    title,
    loading,
    controlling,
    connected,
    error,
    setCwd,
    setTitle,
    selectRun,
    createChange,
    controlRun,
  };
}
