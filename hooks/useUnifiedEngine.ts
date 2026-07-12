"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";
import type { EngineEvent, RunState } from "@/lib/unified-engine/unified-engine-types";

export interface UseUnifiedEngine {
  runs: RunState[];
  selectedRunId: string | null;
  events: EngineEvent[];
  cwd: string;
  title: string;
  loading: boolean;
  error: string | null;
  setCwd: (v: string) => void;
  setTitle: (v: string) => void;
  selectRun: (runId: string) => void;
  createChange: () => Promise<void>;
  controlRun: (runId: string, action: "start" | "pause" | "resume") => Promise<void>;
}

export function useUnifiedEngine(): UseUnifiedEngine {
  const [runs, setRuns] = useState<RunState[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [cwd, setCwd] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/engine/runs");
      const data = (await res.json()) as { runs: RunState[] };
      setRuns(data.runs ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const es = new EventSource("/api/engine/stream");
    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as EngineEvent;
        setEvents((prev) => [e, ...prev].slice(0, 200));
        if (e.type !== "log" && e.type !== "guard") refresh();
      } catch {
        /* ignore malformed */
      }
    };
    esRef.current = es;
    return () => es.close();
  }, [refresh]);

  const createChange = useCallback(async () => {
    if (!title.trim() || !cwd.trim()) {
      setError("请填写标题与项目目录（cwd）");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/engine/changes", {
        method: "POST",
        headers: csrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ title: title.trim(), description: "", cwd: cwd.trim() }),
      });
      if (!res.ok) throw new Error(`创建失败：${res.status}`);
      const run = (await res.json()) as RunState;
      setRuns((prev) => [run, ...prev]);
      setSelectedRunId(run.runId);
      setTitle("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [title, cwd]);

  const controlRun = useCallback(async (runId: string, action: "start" | "pause" | "resume") => {
    setError(null);
    try {
      const res = await fetch("/api/engine/runs", {
        method: "POST",
        headers: csrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ runId, action }),
      });
      if (!res.ok) throw new Error(`操作失败：${res.status}`);
      const run = (await res.json()) as RunState;
      setRuns((prev) => prev.map((r) => (r.runId === run.runId ? run : r)));
      setSelectedRunId(run.runId);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const selectRun = useCallback((runId: string) => setSelectedRunId(runId), []);

  return {
    runs,
    selectedRunId,
    events,
    cwd,
    title,
    loading,
    error,
    setCwd,
    setTitle,
    selectRun,
    createChange,
    controlRun,
  };
}
