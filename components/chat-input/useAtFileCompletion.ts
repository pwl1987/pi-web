"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  buildEntriesFromFiles,
  buildAtInsertText,
  extractAtQuery,
  filterFileEntries,
  type AtQueryMatch,
  type FileIndexEntry,
} from "@/lib/file-fuzzy";

interface UseAtFileCompletionParams {
  cwd?: string | null;
  value: string;
  setValue: (v: string) => void;
}

/** @ 文件自动补全：管理 token 解析、文件索引拉取、补全应用。 */
export function useAtFileCompletion({ cwd, value, setValue }: UseAtFileCompletionParams) {
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState<{
    cwd: string;
    entries: FileIndexEntry[];
    truncated: boolean;
  } | null>(null);
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{
    cwd: string;
    query: string;
    matches: FileIndexEntry[];
  } | null>(null);

  const fileIndexMetaRef = useRef<{ cwd: string; fetchedAt: number } | null>(null);
  const fileIndexFetchingRef = useRef<string | null>(null);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // 根据输入文本与光标位置重新计算 @ token
  const updateAtQuery = useCallback(
    (text: string, cursor: number | null) => {
      if (!cwd) {
        setAtQuery(null);
        return;
      }
      const pos = cursor ?? text.length;
      setAtQuery(extractAtQuery(text.slice(0, pos)));
    },
    [cwd],
  );

  const atQueryText = atQuery?.query ?? null;

  // 本地匹配（客户端文件索引）
  const atLocalMatches: FileIndexEntry[] = useMemo(
    () =>
      atQueryText !== null && fileIndex && fileIndex.cwd === cwd
        ? filterFileEntries(fileIndex.entries, atQueryText)
        : [],
    [atQueryText, fileIndex, cwd],
  );

  const needsServerSearch = Boolean(atQueryText && fileIndex?.truncated && fileIndex.cwd === cwd);

  // 服务端搜索（大仓库截断时）
  useEffect(() => {
    if (!needsServerSearch || !cwd || !atQueryText) return;
    const fetchCwd = cwd;
    const query = atQueryText;
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}&q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`file search failed: ${res.status}`);
          return res.json() as Promise<{ matches?: FileIndexEntry[] }>;
        })
        .then((data) => setAtServerResult({ cwd: fetchCwd, query, matches: data.matches ?? [] }))
        .catch(() => {
          // 保留本地匹配；下次击键重试
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [needsServerSearch, atQueryText, cwd]);

  const serverResultInUse =
    needsServerSearch &&
    atServerResult !== null &&
    atServerResult.cwd === cwd &&
    atServerResult.query === atQueryText;
  const atMatches: FileIndexEntry[] = serverResultInUse ? atServerResult.matches : atLocalMatches;

  // token 出现/变化时打开菜单
  const atTokenKey =
    atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  // 菜单打开时拉取文件索引（10s 缓存）
  const atTokenActive = atQuery !== null;
  useEffect(() => {
    if (!atTokenActive || !cwd) return;
    const meta = fileIndexMetaRef.current;
    if (meta && meta.cwd === cwd && Date.now() - meta.fetchedAt < 10_000) return;
    if (fileIndexFetchingRef.current === cwd) return;
    fileIndexFetchingRef.current = cwd;
    const fetchCwd = cwd;
    setFileIndexLoading(true);
    fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`file index failed: ${res.status}`);
        return res.json() as Promise<{ files?: string[]; truncated?: boolean }>;
      })
      .then((data) => {
        setFileIndex({
          cwd: fetchCwd,
          entries: buildEntriesFromFiles(data.files ?? []),
          truncated: !!data.truncated,
        });
        fileIndexMetaRef.current = { cwd: fetchCwd, fetchedAt: Date.now() };
      })
      .catch(() => {
        fileIndexMetaRef.current = null;
      })
      .finally(() => {
        fileIndexFetchingRef.current = null;
        setFileIndexLoading(false);
      });
  }, [atTokenActive, cwd]);

  // 应用补全
  const applyAtCompletion = useCallback(
    (entry: FileIndexEntry) => {
      if (!atQuery) return;
      const ta = document.querySelector<HTMLTextAreaElement>("[data-chat-input-textarea]");
      const cursor = ta?.selectionStart ?? value.length;
      const before = value.slice(0, atQuery.start);
      let after = value.slice(cursor);
      if (atQuery.quoted && after.startsWith('"')) {
        after = after.slice(1);
      }
      const insert = buildAtInsertText(entry.path, entry.isDir, atQuery.quoted);
      const newValue = before + insert.text + after;
      const newPos = before.length + insert.cursorOffset;
      setValue(newValue);
      setAtQuery(extractAtQuery(newValue.slice(0, newPos)));
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLTextAreaElement>("[data-chat-input-textarea]");
        if (!el) return;
        el.focus();
        el.setSelectionRange(newPos, newPos);
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
      });
    },
    [atQuery, value, setValue],
  );

  // activeIndex 边界修正
  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  // 滚动活跃项到可见
  useEffect(() => {
    if (!atMenuOpen) return;
    atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  return {
    atQuery,
    setAtQuery,
    atMenuOpen,
    setAtMenuOpen,
    atActiveIndex,
    setAtActiveIndex,
    atMatches,
    atItemRefs,
    fileIndex,
    fileIndexLoading,
    needsServerSearch,
    serverResultInUse,
    updateAtQuery,
    applyAtCompletion,
  } as const;
}
