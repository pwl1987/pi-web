"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { csrfFetchJson } from "@/lib/csrf-fetch";
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow, type ChatWindowHandle } from "./ChatWindow";
import { TabBar, type Tab } from "./TabBar";
import { McpConfigPanel } from "./McpConfigPanel";
import { WebSearchConfigPanel } from "./WebSearchConfigPanel";
import { SubagentsPanel } from "./SubagentsPanel";
import { SubagentBadge } from "./SubagentBadge";
import { TokenUsageIndicator } from "./TokenUsageIndicator";
import { LazyLoader } from "./LazyLoader";
import {
  FileViewer,
  ModelsConfig,
  SkillsConfig,
  PluginsConfig,
  InspectorPanel,
} from "./config-panels.registry";
import { ExtensionsConfig } from "./ExtensionsConfig";
import { AgentsConfig } from "./AgentsConfig";
import { SettingsPanel } from "./SettingsPanel";
import { ConstraintPanel } from "./ConstraintPanel";
import { AutonomousCodingDashboard } from "./AutonomousCodingDashboard";
import { CommandPalette } from "./CommandPalette";
import { BranchNavigator } from "./BranchNavigator";
import { TopBarButton } from "./TopBarButton";
import { Icons } from "./Icons";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useExtensions } from "@/hooks/useExtensions";
import { usePersistentState } from "@/hooks/usePersistentState";
import { useAgentRuntime } from "@/lib/agent-runtime-store";
import {
  usePlanMode,
  getPlanModeStore,
  requestOpenEngine as setRequestOpenEngine,
  setPlanMode,
  setOrchestratorId,
  getPlanLink,
  getPlanLinkByOrchId,
  unlinkPlanSession,
} from "@/lib/plan-mode-store";
import { useConstraints } from "@/lib/constraints/useConstraints";
import { translate } from "@/lib/i18n";
import { copyText } from "@/lib/clipboard";
import { getFileName } from "@/lib/file-paths";
import { buildAtMentionText } from "@/lib/file-fuzzy";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ChatInputHandle } from "./ChatInput";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { SUPPORTED_TOKEN_USAGE_PROVIDERS } from "@/lib/token-usage";
import { useConfiguredProviders } from "@/hooks/useConfiguredProviders";

type SessionCopyField = "file" | "id";

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const { locale, t } = useI18n();
  const { getActions, getActionDisabledReason, getWorkspacePanels, extensions } = useExtensions();
  const { configured: configuredProviders, loading: providersLoading } = useConfiguredProviders();
  const runtime = useAgentRuntime();
  const { requestOpenEngine, planMode, planStatus } = usePlanMode();
  const { errors: constraintErrors, warns: constraintWarns } = useConstraints();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [extensionsConfigOpen, setExtensionsConfigOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentsConfigOpen, setAgentsConfigOpen] = useState(false);

  // Expose React on window so extension modules (loaded via dynamic import) share
  // the same React instance — otherwise hooks break across instance boundaries.
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { React: typeof React }).React = React;
      (window as unknown as { ReactDOM: typeof ReactDOM }).ReactDOM = ReactDOM;
    }
  }, []);

  // Global shortcuts (Cmd/Ctrl+K command palette, Cmd/Ctrl+J focus chat input).
  useGlobalShortcuts({
    onToggleCommandPalette: useCallback(() => setCommandPaletteOpen((v) => !v), []),
  });
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pluginsRefreshKey, setPluginsRefreshKey] = useState(0);
  // extensionRenderKey is intentionally unused as a value — bumping it just
  // forces a normal AppShell re-render so extension panels re-run their
  // badge/visible/render() callbacks. (Previously this used the global
  // sessionKey which forced a full ChatWindow remount — wildly over budget.)
  const [, setExtensionRenderKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [skillsConfigOpen, setSkillsConfigOpen] = useState(false);
  const [pluginsConfigOpen, setPluginsConfigOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = usePersistentState<boolean>("sidebar-open", true);
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, setSidebarOpen]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  // Holds the imperative ChatWindow handle (currently: scrollToEntry).
  // Populated by ChatWindow via useImperativeHandle on the ref we pass
  // down (ref={...}, standard React forwardRef pattern).
  const chatWindowRef = useRef<ChatWindowHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);

  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

  const handleBranchDataChange = useCallback(
    (
      tree: SessionTreeNode[],
      activeLeafId: string | null,
      onLeafChange: (leafId: string | null) => void,
    ) => {
      setBranchTree(tree);
      setBranchActiveLeafId(activeLeafId);
      branchLeafChangeFnRef.current = onLeafChange;
    },
    [],
  );

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const systemBtnRef = useRef<HTMLButtonElement>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      setCopiedSessionField(field);
      sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
    };
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{
    percent: number | null;
    contextWindow: number;
    tokens: number | null;
  } | null>(null);
  const handleContextUsageChange = useCallback(
    (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
      setContextUsage(usage);
    },
    [],
  );

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<
    "branches" | "system" | "session" | "panels" | "subagents" | "constraints" | "engine" | null
  >(null);
  const [activePanelTab, setActivePanelTab] = useState<"mcp" | "web-search">("mcp");
  const [topPanelPos, setTopPanelPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const toggleTopPanel = useCallback(
    (
      panel: "branches" | "system" | "session" | "panels" | "subagents" | "constraints" | "engine",
    ) => {
      if (isMobile) setSidebarOpen(false);
      setActiveTopPanel((cur) => (cur === panel ? null : panel));
    },
    [isMobile, setSidebarOpen],
  );

  // Stable callback for SubagentBadge — keeps the badge's React.memo effective
  // when AppShell re-renders for unrelated reasons (modal toggles, etc.).
  const openSubagentsPanel = useCallback(() => toggleTopPanel("subagents"), [toggleTopPanel]);

  // Stable callback for BranchNavigator (memo'd).
  const toggleBranchesPanel = useCallback(() => toggleTopPanel("branches"), [toggleTopPanel]);

  // Stable callbacks for InspectorPanel — same rationale: the panel is
  // memo'd, so these need stable identity across AppShell re-renders.
  // Defined later (after the relevant state is declared) since they close
  // over setTodoSidebarOpen and chatWindowRef.

  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel("session");
  }, [isMobile, setSidebarOpen]);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) setActiveTopPanel(null);
    setSidebarOpen((open) => !open);
  }, [isMobile, setSidebarOpen]);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const bar = topBarRef.current;
    const update = () => {
      const el = topBarRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setTopPanelPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [activeTopPanel]);

  // 用户确认方案后，编排器请求打开编程引擎面板。
  useEffect(() => {
    if (requestOpenEngine) {
      setActiveTopPanel("engine");
      setRequestOpenEngine(false);
    }
  }, [requestOpenEngine]);

  // Right panel — file tabs only
  const [fileTabs, setFileTabs] = usePersistentState<Tab[]>("file-tabs", []);
  const [activeFileTabId, setActiveFileTabId] = usePersistentState<string | null>(
    "active-file-tab-id",
    null,
  );
  const [rightPanelOpen, setRightPanelOpen] = usePersistentState<boolean>(
    "right-panel-open",
    false,
  );
  const [todoSidebarOpen, setTodoSidebarOpen] = usePersistentState<boolean>(
    "todo-sidebar-open",
    false,
  );

  // Stable callbacks for InspectorPanel (memo'd) — keep these refs stable so
  // the panel doesn't re-render on unrelated AppShell state changes.
  const toggleTodoSidebar = useCallback(() => setTodoSidebarOpen((v) => !v), [setTodoSidebarOpen]);
  const scrollChatToEntry = useCallback(
    (entryId: string) => {
      chatWindowRef.current?.scrollToEntry(entryId);
    },
    [], // chatWindowRef is a stable ref — empty deps, callback never changes
  );

  // Reconcile persisted UI state after load: if the persisted active tab no
  // longer exists (user closed it, file was deleted, etc.), drop the pointer.
  // Also closes the right panel if its tab list became empty.
  useEffect(() => {
    if (fileTabs.length === 0) {
      if (activeFileTabId !== null) setActiveFileTabId(null);
      if (rightPanelOpen) setRightPanelOpen(false);
      return;
    }
    if (activeFileTabId && !fileTabs.some((t) => t.id === activeFileTabId)) {
      setActiveFileTabId(fileTabs[fileTabs.length - 1].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileTabs]);

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
  }, []);

  // Stable callback used by extension panels to ask AppShell to re-evaluate
  // their badge/visible/render outputs. Previously this bumped a global
  // sessionKey that remounted ChatWindow (~1100-line subtree) — wildly
  // disproportionate. Now it bumps a dedicated counter that only triggers
  // a normal AppShell re-render (which is what extension panels actually
  // need to re-run their render() callbacks).
  const requestExtensionRender = useCallback(() => {
    setExtensionRenderKey((k) => k + 1);
  }, []);

  const [initialSessionId] = useState<string | null>(() => searchParams.get("session"));
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  // Build the shared extension runtime state (agent data injected for extensions).
  // Each piece is memoized independently so identity stays stable across renders
  // that don't change it — otherwise extension panels that receive these as
  // `state={extState}` re-render on every AppShell render (AppShell owns ~12
  // useState hooks that fire on sidebar/panel toggles, so this happens a lot).
  const extSession = useMemo(
    () =>
      selectedSession
        ? { id: selectedSession.id, cwd: selectedSession.cwd, name: selectedSession.name }
        : null,
    [selectedSession],
  );
  const activeToolNames = useMemo(
    () => runtime.tools.filter((t) => t.active).map((t) => t.name),
    [runtime.tools],
  );
  const extStats = useMemo(
    () =>
      runtime.sessionStats
        ? {
            totalMessages: runtime.sessionStats.totalMessages,
            toolCalls: runtime.sessionStats.toolCalls,
            tokens: { total: runtime.sessionStats.tokens.total },
            cost: runtime.sessionStats.cost,
          }
        : null,
    [runtime.sessionStats],
  );
  const extState = useMemo(
    () => ({
      selectedSession: extSession,
      selectedCwd: activeCwd ?? newSessionCwd ?? null,
      agentRunning: runtime.agentRunning,
      activeTools: activeToolNames,
      sessionStats: extStats,
    }),
    [extSession, activeCwd, newSessionCwd, runtime.agentRunning, activeToolNames, extStats],
  );
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(
    () => !searchParams.get("session"),
  );
  // Suppresses the redundant ChatWindow remount that would come from the
  // onCwdChange effect firing after setSelectedCwd in the sidebar during the
  // initial URL restore (since chatWindowKey is derived from session/cwd,
  // triggering both updates in quick succession would remount ChatWindow twice).
  const suppressCwdBumpRef = useRef(false);

  const handleCwdChange = useCallback(
    (cwd: string | null, projectRoot?: string | null) => {
      setActiveCwd(cwd);
      // Skip if cwd is null (initial mount) or during the initial URL restore.
      if (!cwd) return;
      if (suppressCwdBumpRef.current) {
        suppressCwdBumpRef.current = false;
        return;
      }
      // Worktrees of one repo share a project root. Moving the effective cwd
      // within the same project (e.g. switching worktree, or clicking a session
      // that lives in another worktree) must not close the open session.
      const newProject = projectRoot ?? cwd;
      if (selectedSession && (selectedSession.projectRoot ?? selectedSession.cwd) === newProject) {
        return;
      }
      // Close any session that belongs to a different project — it no longer
      // matches the selected project directory.
      setSelectedSession(null);
      setNewSessionCwd((prev) => {
        if (prev && prev !== cwd) return null;
        return prev;
      });
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      router.replace("/", { scroll: false });
    },
    [router, selectedSession],
  );

  const handleSelectSession = useCallback(
    (session: SessionInfo, isRestore = false) => {
      setNewSessionCwd(null);
      setSelectedSession(session);
      setSystemPrompt(null);
      setInitialSessionRestored(true);
      // ponytail: 选中 plan-mode 入口会话时自动恢复 PlanPanel SSE。
      // 两条命中路径：① 点击 pi session 子节点（id=piId）→ getPlanLink 直接命中；
      // ② 点击顶层虚拟根（id=orchId）→ getPlanLink 必 miss，需 getPlanLinkByOrchId 反查。
      // 未命中且当前处于 plan 模式时，清理 plan 状态，避免 PlanPanel 串台渲染普通会话。
      const planLink = getPlanLink(session.id);
      if (planLink) {
        setPlanMode(true);
        setOrchestratorId(planLink.orchestratorId);
      } else {
        const byOrch = getPlanLinkByOrchId(session.id);
        if (byOrch) {
          setPlanMode(true);
          setOrchestratorId(byOrch.entry.orchestratorId);
        } else if (getPlanModeStore().getState().planMode) {
          // 切到普通会话：plan store 是 globalThis 单例（重挂载不重置），
          // 必须显式清空，否则 ChatWindow 仍渲染 PlanPanel（用旧 orchestratorId 串台）。
          setPlanMode(false);
          setOrchestratorId(null);
        }
      }
      // On mobile, collapse the overlay drawer so the chat is revealed after pick.
      if (isMobile && !isRestore) setSidebarOpen(false);
      if (isRestore) {
        // Suppress the redundant ChatWindow remount that would come from the
        // onCwdChange effect firing after setSelectedCwd in the sidebar
        suppressCwdBumpRef.current = true;
      }
      // Skip router.replace when restoring from URL — the param is already correct
      // and calling replace in production Next.js triggers a Suspense remount loop
      if (!isRestore) {
        router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
      }
    },
    [router, isMobile, setSidebarOpen],
  );

  const handleNewSession = useCallback(
    (_sessionId: string, cwd: string) => {
      setSelectedSession(null);
      setNewSessionCwd(cwd);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      if (isMobile) setSidebarOpen(false);
      router.replace("/", { scroll: false });
    },
    [router, isMobile, setSidebarOpen],
  );

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectRoot, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) =>
          prev && prev.id === sessionId && !prev.projectRoot ? full : prev,
        );
      })
      .catch(() => {});
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback(
    (session: SessionInfo) => {
      setNewSessionCwd(null);
      setSelectedSession(session);
      setRefreshKey((k) => k + 1);
      hydrateSelectedSession(session.id);
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    },
    [router, hydrateSelectedSession],
  );

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleSessionForked = useCallback(
    (newSessionId: string) => {
      setRefreshKey((k) => k + 1);
      setNewSessionCwd(null);
      setSelectedSession((prev) => ({
        ...(prev ?? {
          path: "",
          cwd: "",
          created: "",
          modified: "",
          messageCount: 0,
          firstMessage: "",
        }),
        id: newSessionId,
      }));
      hydrateSelectedSession(newSessionId);
      router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
    },
    [router, hydrateSelectedSession],
  );

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback(
    (sessionId: string) => {
      // ponytail: 删除 plan-mode 入口会话时反向清理：先清客户端 link，
      // 再 fire-and-forget 调 DELETE /api/plan/[orchId] 删服务端持久化快照。
      // 失败不影响删除主流程——下次重启时 10 分钟空闲超时也会回收 in-memory orchestrator。
      const orchId = getPlanLink(sessionId)?.orchestratorId;
      unlinkPlanSession(sessionId);
      if (orchId) {
        void csrfFetchJson(`/api/plan/${encodeURIComponent(orchId)}`, { method: "DELETE" }).catch(
          () => {
            /* best-effort */
          },
        );
      }
      setRefreshKey((k) => k + 1);
      if (selectedSession?.id === sessionId) {
        const cwd = selectedSession.cwd;
        setSelectedSession(null);
        setNewSessionCwd(cwd ?? null);
        setBranchTree([]);
        setBranchActiveLeafId(null);
        setSystemPrompt(null);
        setActiveTopPanel(null);
        router.replace("/", { scroll: false });
      }
    },
    [selectedSession, router],
  );

  const handleOpenFile = useCallback(
    (filePath: string, fileName: string, sourceSessionId?: string | null) => {
      const tabId = `file:${filePath}`;
      setFileTabs((prev) => {
        const existing = prev.find((t) => t.id === tabId);
        if (!existing) return [...prev, { id: tabId, label: fileName, filePath, sourceSessionId }];
        if (!sourceSessionId || existing.sourceSessionId === sourceSessionId) return prev;
        return prev.map((t) => (t.id === tabId ? { ...t, sourceSessionId } : t));
      });
      setActiveFileTabId(tabId);
      setRightPanelOpen(true);
      // On mobile the file panel is full-screen; close the drawer so it shows.
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile, setFileTabs, setActiveFileTabId, setRightPanelOpen, setSidebarOpen],
  );

  const handleOpenLinkedFile = useCallback(
    (filePath: string) => {
      handleOpenFile(filePath, getFileName(filePath), selectedSession?.id ?? null);
    },
    [handleOpenFile, selectedSession?.id],
  );

  const handleCloseFileTab = useCallback(
    (tabId: string) => {
      setFileTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (next.length === 0) setRightPanelOpen(false);
        return next;
      });
      setActiveFileTabId((cur) => {
        if (cur !== tabId) return cur;
        const remaining = fileTabs.filter((t) => t.id !== tabId);
        return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      });
    },
    [fileTabs, setFileTabs, setActiveFileTabId, setRightPanelOpen],
  );

  /** Open an extension panel as a tab in the right-side panel area. */
  const handleOpenExtensionPanel = useCallback(
    (qualifiedId: string, title: string, icon?: ReactNode) => {
      const tabId = `ext:${qualifiedId}`;
      setFileTabs((prev) => {
        const existing = prev.find((t) => t.id === tabId);
        if (!existing)
          return [
            ...prev,
            { id: tabId, label: title, kind: "extension" as const, extensionId: qualifiedId, icon },
          ];
        return prev;
      });
      setActiveFileTabId(tabId);
      setRightPanelOpen(true);
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile, setFileTabs, setActiveFileTabId, setRightPanelOpen, setSidebarOpen],
  );

  const handleExportSession = useCallback(() => {
    if (!selectedSession) return;
    window.location.href = `/api/sessions/${encodeURIComponent(selectedSession.id)}/export`;
  }, [selectedSession]);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  // Memoized so React.memo'd children that depend on these stay stable when
  // unrelated state (modal toggles, refresh counters, etc.) changes.
  const effectiveNewSessionCwd = useMemo(
    () => newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null),
    [newSessionCwd, selectedSession, activeCwd],
  );
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  const activeFileTab = useMemo(
    () => fileTabs.find((t) => t.id === activeFileTabId) ?? null,
    [fileTabs, activeFileTabId],
  );

  // ChatWindow's key. Previously this was a counter (sessionKey) bumped on
  // *any* session-touching action, which forced ChatWindow to fully unmount
  // and remount — expensive (1110-line subtree, 1618-line useAgentSession
  // hook, EventSource teardown/setup, scroll/draft state reset). Using the
  // session id (or cwd for new sessions) as the key means the remount only
  // happens when the actual session identity changes; lighter operations
  // like plugin reload use pluginsRefreshKey instead and refresh tools
  // in-place via a useEffect (see hooks/useAgentSession.ts).
  const chatWindowKey = useMemo(
    () =>
      selectedSession?.id ?? (effectiveNewSessionCwd ? `new:${effectiveNewSessionCwd}` : "empty"),
    [selectedSession?.id, effectiveNewSessionCwd],
  );

  const sidebarContent = (
    <>
      <SessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        initialSessionId={initialSessionId}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onOpenFile={handleOpenFile}
        explorerRefreshKey={explorerRefreshKey}
        onAtMention={handleAtMention}
      />
      <div
        style={{
          padding: "8px",
          flexShrink: 0,
          display: "flex",
          justifyContent: "space-between",
          gap: 4,
        }}
      >
        {(
          [
            {
              label: t("sidebar.models"),
              onClick: () => setModelsConfigOpen(true),
              disabled: false,
              icon: <Icons.Model size={14} />,
            },
            {
              label: t("sidebar.skills"),
              onClick: () => setSkillsConfigOpen(true),
              disabled: !activeCwd && !selectedSession?.cwd && !newSessionCwd,
              icon: <Icons.Skills size={14} />,
            },
            {
              label: t("sidebar.plugins"),
              onClick: () => setPluginsConfigOpen(true),
              disabled: !activeCwd && !selectedSession?.cwd && !newSessionCwd,
              icon: <Icons.Plugins size={14} />,
            },
            {
              label: t("sidebar.extensions"),
              onClick: () => setExtensionsConfigOpen(true),
              disabled: false,
              icon: <Icons.Extensions size={14} />,
            },
          ] as Array<{
            label: string;
            onClick: () => void;
            disabled: boolean;
            icon: React.ReactNode;
          }>
        ).map(({ label, onClick, disabled, icon }) => (
          <button
            key={label}
            onClick={onClick}
            disabled={disabled}
            title={label}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              height: 32,
              padding: 0,
              background: "none",
              border: "none",
              borderRadius: 9,
              color: "var(--text-muted)",
              cursor: disabled ? "default" : "pointer",
              fontSize: 12,
              opacity: disabled ? 0.35 : 1,
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              if (!disabled) {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <>
      <div
        style={{ display: "flex", height: "100dvh", overflow: "hidden", background: "var(--bg)" }}
      >
        {/* Mobile overlay backdrop */}
        <div
          className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 199,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: sidebarOpen ? "blur(1px)" : "none",
            WebkitBackdropFilter: sidebarOpen ? "blur(1px)" : "none",
            opacity: sidebarOpen ? 1 : 0,
            pointerEvents: sidebarOpen ? "auto" : "none",
            transition: "opacity 0.25s ease, backdrop-filter 0.25s ease",
          }}
        />

        {/* Left sidebar */}
        <div
          className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
          style={{
            background: "var(--bg-panel)",
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            zIndex: 200,
          }}
        >
          {sidebarContent}
        </div>

        {/* Center: chat */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          {/* Top bar with sidebar toggle */}
          <div
            ref={topBarRef}
            style={{
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
              borderBottom: "1px solid var(--border)",
              height: 36,
              background: "var(--bg-panel)",
            }}
          >
            <button
              onClick={handleSidebarToggle}
              title={sidebarOpen ? t("topbar.hideSidebar") : t("topbar.showSidebar")}
              aria-label={sidebarOpen ? t("topbar.hideSidebar") : t("topbar.showSidebar")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                padding: 0,
                background: "none",
                border: "none",
                borderRight: "1px solid var(--border)",
                color: "var(--text-muted)",
                cursor: "pointer",
                flexShrink: 0,
                transition: "color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              {sidebarOpen ? <Icons.SidebarClose size={16} /> : <Icons.SidebarOpen size={18} />}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              title={t("settings.title")}
              aria-label={t("settings.title")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                padding: 0,
                background: "none",
                border: "none",
                borderRight: "1px solid var(--border)",
                color: "var(--text-muted)",
                cursor: "pointer",
                flexShrink: 0,
                transition: "color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              <Icons.Settings size={16} />
            </button>
            {showChat && (
              <div style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
                <button
                  onClick={handleExportSession}
                  disabled={!selectedSession}
                  title={selectedSession ? t("topbar.exportHtml") : t("topbar.exportDisabled")}
                  aria-label={t("topbar.exportHtml")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    height: "100%",
                    padding: "0 12px",
                    background: "none",
                    border: "none",
                    borderTop: "2px solid transparent",
                    borderRight: "1px solid var(--border)",
                    color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
                    cursor: selectedSession ? "pointer" : "not-allowed",
                    opacity: selectedSession ? 1 : 0.45,
                    flexShrink: 0,
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    transition: "color 0.1s, background 0.1s, opacity 0.1s",
                  }}
                  onMouseEnter={(e) => {
                    if (!selectedSession) return;
                    e.currentTarget.style.color = "var(--text)";
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = selectedSession
                      ? "var(--text-muted)"
                      : "var(--text-dim)";
                    e.currentTarget.style.background = "none";
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 18,
                      height: 18,
                      borderRadius: 5,
                      background: "transparent",
                      color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
                      flexShrink: 0,
                    }}
                  >
                    <Icons.Export size={12} />
                  </span>
                  {!isMobile && <span>{t("topbar.export")}</span>}
                </button>
                <BranchNavigator
                  tree={branchTree}
                  activeLeafId={branchActiveLeafId}
                  onLeafChange={handleBranchLeafChange}
                  inline
                  compact={isMobile}
                  containerRef={topBarRef}
                  open={activeTopPanel === "branches"}
                  onToggle={toggleBranchesPanel}
                  hasSession
                />
                <TopBarButton
                  ref={systemBtnRef}
                  active={activeTopPanel === "system"}
                  onClick={() => toggleTopPanel("system")}
                  title={t("topbar.systemPrompt")}
                  aria-label={t("topbar.systemPrompt")}
                >
                  <Icons.SystemDoc
                    size={12}
                    style={{
                      color: systemPrompt ? "var(--accent)" : "var(--text-dim)",
                      flexShrink: 0,
                    }}
                  />
                  {!isMobile && <span>{t("topbar.system")}</span>}
                </TopBarButton>
                <TopBarButton
                  active={activeTopPanel === "subagents"}
                  onClick={() => toggleTopPanel("subagents")}
                  title={t("panels.subagents")}
                  aria-label={t("panels.subagents")}
                >
                  <Icons.Subagent size={12} style={{ flexShrink: 0 }} />
                  {!isMobile && <span>{t("panels.subagents")}</span>}
                </TopBarButton>
                <TopBarButton
                  active={activeTopPanel === "panels"}
                  onClick={() => toggleTopPanel("panels")}
                  title={t("panels.title")}
                  aria-label={t("panels.title")}
                >
                  <Icons.Panels size={12} style={{ flexShrink: 0 }} />
                  {!isMobile && <span>{t("panels.title")}</span>}
                </TopBarButton>
                <TopBarButton
                  active={activeTopPanel === "constraints"}
                  onClick={() => toggleTopPanel("constraints")}
                  title={t("constraints.open")}
                  aria-label={t("constraints.open")}
                >
                  <Icons.Alert size={12} style={{ flexShrink: 0 }} />
                  {!isMobile && <span>{t("constraints.open")}</span>}
                  {(constraintErrors.length > 0 || constraintWarns.length > 0) && (
                    <span
                      style={{
                        marginLeft: 4,
                        fontSize: 10,
                        lineHeight: 1,
                        padding: "2px 5px",
                        borderRadius: 999,
                        color: "#fff",
                        background:
                          constraintErrors.length > 0
                            ? "var(--danger, #e5484d)"
                            : "var(--warning, #f5a623)",
                      }}
                    >
                      {constraintErrors.length + constraintWarns.length}
                    </span>
                  )}
                </TopBarButton>
                <TopBarButton
                  active={activeTopPanel === "engine"}
                  onClick={() => toggleTopPanel("engine")}
                  title={t("engine.title")}
                  aria-label={t("engine.title")}
                >
                  <Icons.Subagent size={12} style={{ flexShrink: 0 }} />
                  {!isMobile && <span>{t("engine.title")}</span>}
                </TopBarButton>
              </div>
            )}
            {/* Subagent status badge — shows when subagents are running */}
            {showChat && <SubagentBadge onClick={openSubagentsPanel} />}
            {/* Provider token-plan usage pills — one per supported provider that
              actually has an API key configured. Skipping unconfigured ones
              avoids mounting a polling hook (and its fetches) for providers
              with nothing to show. While the auth list loads, render nothing
              rather than risk a flash of soon-unmounted hooks. */}
            {showChat &&
              !providersLoading &&
              Object.values(SUPPORTED_TOKEN_USAGE_PROVIDERS)
                .filter((cfg) => configuredProviders.has(cfg.id))
                .map((cfg) => (
                  <TokenUsageIndicator
                    key={cfg.id}
                    config={{ provider: cfg.id, displayName: cfg.displayName }}
                    onConfigure={() => setModelsConfigOpen(true)}
                  />
                ))}
            {/* Session stats — right-aligned in top bar */}
            {showChat &&
              (sessionStats || contextUsage) &&
              (() => {
                const t = sessionStats?.tokens;
                const c = sessionStats?.cost ?? 0;
                const fmt = (n: number) =>
                  n >= 1_000_000
                    ? `${(n / 1_000_000).toFixed(1)}M`
                    : n >= 1000
                      ? `${(n / 1000).toFixed(0)}k`
                      : String(n);
                const costStr = c > 0 ? (c >= 0.01 ? `$${c.toFixed(2)}` : `<$0.01`) : null;

                let ctxColor = "var(--text-muted)";
                let ctxStr: string | null = null;
                if (contextUsage?.contextWindow) {
                  const pct = contextUsage.percent;
                  if (pct !== null && pct > 90) ctxColor = "#ef4444";
                  else if (pct !== null && pct > 70) ctxColor = "rgba(234,179,8,0.95)";
                  ctxStr =
                    pct !== null
                      ? `${pct.toFixed(0)}% / ${fmt(contextUsage.contextWindow)}`
                      : `? / ${fmt(contextUsage.contextWindow)}`;
                }

                const tooltipParts: string[] = [];
                if (t) {
                  tooltipParts.push(
                    translate(locale, "topbar.statIn", { value: t.input.toLocaleString() }),
                  );
                  tooltipParts.push(
                    translate(locale, "topbar.statOut", { value: t.output.toLocaleString() }),
                  );
                  tooltipParts.push(
                    translate(locale, "topbar.statCacheRead", {
                      value: t.cacheRead.toLocaleString(),
                    }),
                  );
                  tooltipParts.push(
                    translate(locale, "topbar.statCacheWrite", {
                      value: t.cacheWrite.toLocaleString(),
                    }),
                  );
                  if (c > 0)
                    tooltipParts.push(
                      translate(locale, "topbar.statCost", { value: `$${c.toFixed(4)}` }),
                    );
                }
                if (contextUsage?.contextWindow) {
                  const pct = contextUsage.percent;
                  if (pct !== null) {
                    tooltipParts.push(
                      translate(locale, "topbar.statContext", {
                        pct: pct.toFixed(1) + "%",
                        window: contextUsage.contextWindow.toLocaleString(),
                      }),
                    );
                  } else {
                    tooltipParts.push(
                      translate(locale, "topbar.statContextUnknown", {
                        window: contextUsage.contextWindow.toLocaleString(),
                      }),
                    );
                  }
                }
                const tooltip = tooltipParts.join("  |  ");

                return (
                  <TopBarButton
                    active={activeTopPanel === "session"}
                    onClick={() => toggleTopPanel("session")}
                    title={tooltip || translate(locale, "topbar.sessionInfo")}
                    aria-label={translate(locale, "topbar.sessionInfo")}
                    className="topbar-panel-btn-session"
                    style={{
                      marginLeft: "auto",
                      gap: 10,
                      paddingRight: rightPanelOpen ? 12 : 48,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {isMobile && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                    )}
                    {!isMobile && t && t.input > 0 && (
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Icons.TokenIn size={12} />
                        {fmt(t.input)}
                      </span>
                    )}
                    {!isMobile && t && t.output > 0 && (
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Icons.TokenOut size={12} />
                        {fmt(t.output)}
                      </span>
                    )}
                    {!isMobile && t && t.cacheRead > 0 && (
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Icons.TokenCache size={12} />
                        {fmt(t.cacheRead)}
                      </span>
                    )}
                    {!isMobile && costStr && (
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          color: "var(--text)",
                          fontWeight: 500,
                        }}
                      >
                        {costStr}
                      </span>
                    )}
                    {ctxStr && (
                      <span
                        style={{ display: "flex", alignItems: "center", gap: 4, color: ctxColor }}
                      >
                        <Icons.ContextUsage size={12} />
                        {ctxStr}
                      </span>
                    )}
                  </TopBarButton>
                );
              })()}
            {/* Top panel dropdown — shared, only one active at a time */}
            {activeTopPanel && topPanelPos && (
              <div
                className="animate-fade-in-up"
                style={{
                  position: "fixed",
                  top: topPanelPos.top,
                  left: topPanelPos.left,
                  width: topPanelPos.width,
                  height: `calc(100dvh - ${topPanelPos.top}px)`,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  zIndex: 500,
                }}
              >
                {activeTopPanel === "system" && (
                  <div
                    style={{
                      background: "var(--bg-panel)",
                      borderBottom: "1px solid var(--border)",
                      flex: 1,
                      minHeight: 0,
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                    }}
                  >
                    {systemPrompt ? (
                      <div
                        style={{
                          flex: 1,
                          minHeight: 0,
                          overflowY: "auto",
                          padding: "12px 16px",
                          color: "var(--text-muted)",
                          fontSize: 12,
                          lineHeight: 1.6,
                          whiteSpace: "pre-wrap",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {systemPrompt}
                      </div>
                    ) : systemPrompt === "" ? (
                      <div
                        style={{
                          padding: "10px 16px",
                          fontSize: 12,
                          color: "var(--text-muted)",
                          fontStyle: "italic",
                        }}
                      >
                        {t("systemPrompt.empty")}
                      </div>
                    ) : (
                      <div
                        style={{
                          padding: "10px 16px",
                          fontSize: 12,
                          color: "var(--text-muted)",
                          fontStyle: "italic",
                        }}
                      >
                        {t("systemPrompt.loadHint")}
                      </div>
                    )}
                  </div>
                )}
                {activeTopPanel === "session" && (
                  <div
                    className="session-info-popover"
                    style={{
                      background: "var(--bg-panel)",
                      borderBottom: "1px solid var(--border)",
                      boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
                      padding: "12px 16px",
                    }}
                  >
                    {sessionStats ? (
                      (() => {
                        const sessionRows = [
                          ...(sessionStats.sessionName
                            ? [
                                {
                                  label: t("sessionInfo.name"),
                                  value: sessionStats.sessionName,
                                  copyField: null,
                                },
                              ]
                            : []),
                          {
                            label: t("sessionInfo.file"),
                            value: sessionStats.sessionFile ?? t("sessionInfo.inMemory"),
                            copyField: "file" as const,
                          },
                          {
                            label: t("sessionInfo.id"),
                            value: sessionStats.sessionId,
                            copyField: "id" as const,
                          },
                        ];
                        const messageRows = [
                          [t("sessionInfo.user"), sessionStats.userMessages.toLocaleString()],
                          [
                            t("sessionInfo.assistant"),
                            sessionStats.assistantMessages.toLocaleString(),
                          ],
                          [t("sessionInfo.toolCalls"), sessionStats.toolCalls.toLocaleString()],
                          [t("sessionInfo.toolResults"), sessionStats.toolResults.toLocaleString()],
                          [t("sessionInfo.total"), sessionStats.totalMessages.toLocaleString()],
                        ];
                        const tokenRows = [
                          [t("sessionInfo.input"), sessionStats.tokens.input.toLocaleString()],
                          [t("sessionInfo.output"), sessionStats.tokens.output.toLocaleString()],
                          ...(sessionStats.tokens.cacheRead > 0
                            ? [
                                [
                                  t("sessionInfo.cacheRead"),
                                  sessionStats.tokens.cacheRead.toLocaleString(),
                                ],
                              ]
                            : []),
                          ...(sessionStats.tokens.cacheWrite > 0
                            ? [
                                [
                                  t("sessionInfo.cacheWrite"),
                                  sessionStats.tokens.cacheWrite.toLocaleString(),
                                ],
                              ]
                            : []),
                          [t("sessionInfo.total"), sessionStats.tokens.total.toLocaleString()],
                        ];
                        const ctx = contextUsage ?? sessionStats.contextUsage;
                        const formatCompact = (n: number) =>
                          n >= 1_000_000
                            ? `${(n / 1_000_000).toFixed(1)}M`
                            : n >= 1000
                              ? `${(n / 1000).toFixed(0)}k`
                              : String(n);
                        const extraTokenRows = [
                          ...(sessionStats.cost > 0
                            ? [[t("sessionInfo.cost"), `$${sessionStats.cost.toFixed(4)}`]]
                            : []),
                          ...(ctx?.contextWindow
                            ? [
                                [
                                  t("sessionInfo.context"),
                                  `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompact(ctx.contextWindow)}`,
                                ],
                              ]
                            : []),
                        ];
                        const section = (
                          title: string,
                          sectionRows: string[][],
                          valueAlign: "left" | "right" = "left",
                          compact = false,
                        ) => (
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: "var(--text)",
                                marginBottom: 6,
                              }}
                            >
                              {title}
                            </div>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: compact
                                  ? "max-content max-content"
                                  : "auto minmax(0, 1fr)",
                                columnGap: compact ? 14 : 12,
                                rowGap: 4,
                                justifyContent: compact ? "start" : undefined,
                              }}
                            >
                              {sectionRows.map(([label, value]) => (
                                <div key={`${title}:${label}`} style={{ display: "contents" }}>
                                  <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                                    {label}
                                  </div>
                                  <div
                                    style={{
                                      color: "var(--text-muted)",
                                      minWidth: 0,
                                      overflowWrap: compact ? "normal" : "anywhere",
                                      textAlign: valueAlign,
                                      whiteSpace: valueAlign === "right" ? "nowrap" : "normal",
                                    }}
                                  >
                                    {value}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                        const copyButton = (field: SessionCopyField, value: string) => {
                          const copied = copiedSessionField === field;
                          return (
                            <button
                              type="button"
                              title={
                                copied
                                  ? t("sessionInfo.copied")
                                  : field === "file"
                                    ? t("sessionInfo.copyFilePath")
                                    : t("sessionInfo.copySessionId")
                              }
                              onClick={() => handleCopySessionField(field, value)}
                              style={{
                                alignSelf: "start",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 22,
                                height: 22,
                                marginTop: -2,
                                color: copied ? "var(--accent)" : "var(--text-dim)",
                                background: "transparent",
                                border: "1px solid var(--border)",
                                borderRadius: 4,
                                cursor: "pointer",
                                flex: "0 0 auto",
                                transition: "color 0.12s, border-color 0.12s, background 0.12s",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = "var(--accent)";
                                e.currentTarget.style.borderColor = "var(--accent)";
                                e.currentTarget.style.background = "var(--bg-hover)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = copied
                                  ? "var(--accent)"
                                  : "var(--text-dim)";
                                e.currentTarget.style.borderColor = "var(--border)";
                                e.currentTarget.style.background = "transparent";
                              }}
                            >
                              {copied ? <Icons.Check size={12} /> : <Icons.Copy size={12} />}
                            </button>
                          );
                        };
                        const sessionInfoSection = (
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: "var(--text)",
                                marginBottom: 6,
                              }}
                            >
                              {t("sessionInfo.title")}
                            </div>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "auto minmax(0, 1fr) auto",
                                columnGap: 12,
                                rowGap: 8,
                                alignItems: "start",
                              }}
                            >
                              {sessionRows.map((row) => (
                                <div
                                  key={`session-info:${row.label}`}
                                  style={{ display: "contents" }}
                                >
                                  <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                                    {row.label}
                                  </div>
                                  <div
                                    style={{
                                      color: "var(--text-muted)",
                                      minWidth: 0,
                                      overflowWrap: "anywhere",
                                      wordBreak: "break-word",
                                      whiteSpace: "normal",
                                    }}
                                  >
                                    {row.value}
                                  </div>
                                  <div>
                                    {row.copyField ? copyButton(row.copyField, row.value) : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );

                        return (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: isMobile
                                ? "1fr"
                                : "minmax(360px, 1.7fr) minmax(140px, 0.55fr) minmax(190px, 0.75fr)",
                              gap: isMobile ? 16 : 24,
                              fontSize: 12,
                              lineHeight: 1.5,
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {sessionInfoSection}
                            {section(t("sessionInfo.messages"), messageRows)}
                            {section(
                              t("sessionInfo.tokens"),
                              [...tokenRows, ...extraTokenRows],
                              "right",
                              true,
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      <div
                        style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}
                      >
                        {t("sessionInfo.empty")}
                      </div>
                    )}
                  </div>
                )}
                {activeTopPanel === "panels" && (
                  <div
                    style={{
                      background: "var(--bg-panel)",
                      borderBottom: "1px solid var(--border)",
                      flex: 1,
                      minHeight: 0,
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        gap: 0,
                        borderBottom: "1px solid var(--border)",
                        position: "sticky",
                        top: 0,
                        flexShrink: 0,
                        background: "var(--bg-panel)",
                        zIndex: 1,
                      }}
                    >
                      {(
                        [
                          { id: "mcp", label: t("panels.mcp") },
                          { id: "web-search", label: t("panels.webSearch") },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setActivePanelTab(tab.id)}
                          style={{
                            padding: "8px 14px",
                            fontSize: 11,
                            fontWeight: 500,
                            background: activePanelTab === tab.id ? "var(--bg-selected)" : "none",
                            border: "none",
                            borderBottom:
                              activePanelTab === tab.id
                                ? "2px solid var(--accent)"
                                : "2px solid transparent",
                            color: activePanelTab === tab.id ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                      {activePanelTab === "mcp" && <McpConfigPanel cwd={activeCwd ?? undefined} />}
                      {activePanelTab === "web-search" && <WebSearchConfigPanel />}
                    </div>
                  </div>
                )}
                {activeTopPanel === "subagents" && (
                  <div
                    style={{
                      background: "var(--bg-panel)",
                      borderBottom: "1px solid var(--border)",
                      maxHeight: "min(600px, 75vh)",
                      overflowY: "auto",
                    }}
                  >
                    <SubagentsPanel />
                  </div>
                )}
                {activeTopPanel === "constraints" && (
                  <div
                    style={{
                      background: "var(--bg-panel)",
                      borderBottom: "1px solid var(--border)",
                      flex: 1,
                      minHeight: 0,
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                    }}
                  >
                    <ConstraintPanel />
                  </div>
                )}
                {activeTopPanel === "engine" && (
                  <div
                    style={{
                      background: "var(--bg-panel)",
                      borderBottom: "1px solid var(--border)",
                      flex: 1,
                      minHeight: 0,
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                    }}
                  >
                    <AutonomousCodingDashboard />
                  </div>
                )}
              </div>
            )}
          </div>

          {planMode && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 14px",
                background: "var(--color-doc-bg)",
                borderBottom: "1px solid var(--border)",
                fontSize: 12,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background:
                    planStatus === "awaiting_confirm"
                      ? "var(--color-warning)"
                      : planStatus === "executing"
                        ? "var(--git-added)"
                        : planStatus === "done"
                          ? "var(--git-added)"
                          : planStatus === "failed"
                            ? "var(--color-error-soft)"
                            : planStatus === "cancelled"
                              ? "var(--text-dim)"
                              : "var(--accent)",
                  animation:
                    planStatus === "parsing" ||
                    planStatus === "discussing" ||
                    planStatus === "synthesizing" ||
                    planStatus === "awaiting_confirm" ||
                    planStatus === "executing"
                      ? "inspector-pulse 1.5s ease-in-out infinite"
                      : "none",
                }}
              />
              <span
                style={{
                  color:
                    planStatus === "awaiting_confirm"
                      ? "var(--color-warning)"
                      : planStatus === "executing"
                        ? "var(--git-added)"
                        : planStatus === "done"
                          ? "var(--git-added)"
                          : planStatus === "failed"
                            ? "var(--color-error-soft)"
                            : "var(--text)",
                }}
              >
                {planStatus === "parsing" && t("plan.parsing")}
                {planStatus === "discussing" && t("plan.discussing", { round: 1, max: 4 })}
                {planStatus === "synthesizing" && t("plan.synthesizing")}
                {planStatus === "awaiting_confirm" && t("plan.awaitingConfirm")}
                {planStatus === "executing" && t("plan.executing")}
                {planStatus === "done" && t("plan.done")}
                {planStatus === "failed" && t("plan.failed")}
                {planStatus === "cancelled" && t("plan.cancelled")}
              </span>
              {(planStatus === "done" || planStatus === "failed" || planStatus === "cancelled") && (
                <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button
                    onClick={() => {
                      setActiveTopPanel("engine");
                    }}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 6,
                      border: "1px solid var(--accent)",
                      background: "var(--accent)",
                      color: "#fff",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    {t("plan.openEngine")}
                  </button>
                  <button
                    onClick={() => {
                      setPlanMode(false);
                    }}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "none",
                      color: "var(--text-muted)",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    {t("plan.exit")}
                  </button>
                </span>
              )}
            </div>
          )}

          {/* Chat content */}
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            {showChat && (
              <LazyLoader
                component={InspectorPanel}
                sessionId={selectedSession?.id ?? null}
                cwd={activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? null}
                open={todoSidebarOpen}
                onToggle={toggleTodoSidebar}
                onTaskClick={scrollChatToEntry}
              />
            )}
            {showChat ? (
              <ChatWindow
                key={chatWindowKey}
                session={selectedSession}
                newSessionCwd={effectiveNewSessionCwd}
                onAgentEnd={handleAgentEnd}
                onSessionCreated={handleSessionCreated}
                onSessionForked={handleSessionForked}
                modelsRefreshKey={modelsRefreshKey}
                pluginsRefreshKey={pluginsRefreshKey}
                chatInputRef={chatInputRef}
                ref={chatWindowRef}
                onBranchDataChange={handleBranchDataChange}
                onSystemPromptChange={handleSystemPromptChange}
                onSessionStatsChange={handleSessionStatsChange}
                onSessionStatsPanelOpen={openSessionStatsPanel}
                onContextUsageChange={handleContextUsageChange}
                onOpenFile={handleOpenLinkedFile}
              />
            ) : showPlaceholder ? (
              activeCwd ? (
                <div
                  className="animate-fade-in"
                  style={{
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--text-muted)",
                    fontSize: 15,
                  }}
                >
                  {t("empty.selectSession")}
                </div>
              ) : (
                <div
                  className="animate-fade-in-up"
                  style={{
                    position: "absolute",
                    top: 12,
                    left: 12,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    userSelect: "none",
                    pointerEvents: "none",
                  }}
                >
                  <svg
                    width="44"
                    height="44"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ opacity: 0.7, flexShrink: 0 }}
                  >
                    <line x1="20" y1="12" x2="4" y2="12" />
                    <polyline points="10 6 4 12 10 18" />
                  </svg>
                  <div>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 600,
                        color: "var(--text)",
                        marginBottom: 8,
                      }}
                    >
                      {t("empty.getStarted")}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                      <span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>
                      {t("empty.step1")}
                      <br />
                      <span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>
                      {t("empty.step2Before")}
                      <strong style={{ color: "var(--text)" }}>{t("sidebar.models")}</strong>
                      {t("empty.step2After")}
                    </div>
                  </div>
                </div>
              )
            ) : null}
          </div>
        </div>

        {/* Right panel: file viewer — always mounted, width animated via CSS */}
        <div
          className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}`}
          style={{
            display: "flex",
            flexDirection: "column",
            borderLeft: "1px solid var(--border)",
            background: "var(--bg)",
          }}
        >
          {/* Right panel tab bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
              background: "var(--bg-panel)",
              borderBottom: "1px solid var(--border)",
              height: 36,
            }}
          >
            <div style={{ flex: 1, overflow: "hidden" }}>
              <TabBar
                tabs={fileTabs}
                activeTabId={activeFileTabId ?? ""}
                onSelectTab={setActiveFileTabId}
                onCloseTab={handleCloseFileTab}
              />
            </div>
          </div>

          {/* File content */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            {activeFileTab?.kind === "builtin" && activeFileTab.builtinId ? (
              activeFileTab.builtinId === "mcp" ? (
                <McpConfigPanel cwd={activeCwd ?? undefined} />
              ) : activeFileTab.builtinId === "web-search" ? (
                <WebSearchConfigPanel />
              ) : activeFileTab.builtinId === "subagents" ? (
                <SubagentsPanel />
              ) : (
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--text-dim)",
                    fontSize: 12,
                  }}
                >
                  Unknown panel
                </div>
              )
            ) : activeFileTab?.kind === "extension" && activeFileTab.extensionId ? (
              (() => {
                const panel = getWorkspacePanels().find(
                  (p) => p.qualifiedId === activeFileTab.extensionId,
                );
                if (!panel) {
                  return (
                    <div
                      style={{
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--text-dim)",
                        fontSize: 12,
                      }}
                    >
                      {t("empty.noFileOpen")}
                    </div>
                  );
                }
                return panel.render({
                  session: extSession,
                  cwd: activeCwd ?? undefined,
                  state: extState,
                  requestRender: requestExtensionRender,
                });
              })()
            ) : activeFileTab?.filePath ? (
              <LazyLoader
                component={FileViewer}
                filePath={activeFileTab.filePath}
                cwd={activeCwd ?? undefined}
                sourceSessionId={activeFileTab.sourceSessionId}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  fontSize: 12,
                }}
              >
                {t("empty.noFileOpen")}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* File panel toggle — always visible at top-right */}
      <button
        onClick={() => setRightPanelOpen((v) => !v)}
        title={rightPanelOpen ? t("filePanel.hide") : t("filePanel.show")}
        aria-label={rightPanelOpen ? t("filePanel.hide") : t("filePanel.show")}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          zIndex: 300,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          padding: 0,
          background: "var(--bg-panel)",
          border: "none",
          borderLeft: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          color: rightPanelOpen ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer",
          transition: "color 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = rightPanelOpen ? "var(--text)" : "var(--text-muted)";
        }}
      >
        <Icons.FilePanel size={16} />
      </button>
      {modelsConfigOpen && (
        <LazyLoader
          component={ModelsConfig}
          onClose={() => {
            setModelsConfigOpen(false);
            setModelsRefreshKey((k) => k + 1);
          }}
        />
      )}
      {skillsConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
        <LazyLoader
          component={SkillsConfig}
          cwd={(activeCwd ?? selectedSession?.cwd ?? newSessionCwd)!}
          onClose={() => setSkillsConfigOpen(false)}
        />
      )}
      {pluginsConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
        <LazyLoader
          component={PluginsConfig}
          cwd={(activeCwd ?? selectedSession?.cwd ?? newSessionCwd)!}
          sessionId={selectedSession?.id ?? null}
          onClose={() => setPluginsConfigOpen(false)}
          onReloaded={() => setPluginsRefreshKey((k) => k + 1)}
        />
      )}
      {extensionsConfigOpen && (
        <ExtensionsConfig extensions={extensions} onClose={() => setExtensionsConfigOpen(false)} />
      )}
      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onOpenModels={() => setModelsConfigOpen(true)}
          onOpenSkills={() => setSkillsConfigOpen(true)}
          onOpenPlugins={() => setPluginsConfigOpen(true)}
          onOpenExtensions={() => setExtensionsConfigOpen(true)}
          onOpenAgents={() => setAgentsConfigOpen(true)}
        />
      )}
      {agentsConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
        <AgentsConfig
          cwd={(activeCwd ?? selectedSession?.cwd ?? newSessionCwd)!}
          onClose={() => setAgentsConfigOpen(false)}
        />
      )}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        actions={getActions({
          state: extState,
          focusPrompt: () => {
            document.querySelector<HTMLTextAreaElement>("textarea")?.focus();
          },
          openFilePanel: () => setRightPanelOpen(true),
          openExtensionPanel: (qualifiedId, title) => {
            const panel = getWorkspacePanels().find((p) => p.qualifiedId === qualifiedId);
            handleOpenExtensionPanel(
              qualifiedId,
              title ?? panel?.title ?? "Extension",
              panel?.icon,
            );
          },
        })}
        getDisabledReason={getActionDisabledReason}
        context={{
          state: extState,
          focusPrompt: () => {
            document.querySelector<HTMLTextAreaElement>("textarea")?.focus();
          },
          openFilePanel: () => setRightPanelOpen(true),
          openExtensionPanel: (qualifiedId, title) => {
            const panel = getWorkspacePanels().find((p) => p.qualifiedId === qualifiedId);
            handleOpenExtensionPanel(
              qualifiedId,
              title ?? panel?.title ?? "Extension",
              panel?.icon,
            );
          },
        }}
      />
    </>
  );
}
