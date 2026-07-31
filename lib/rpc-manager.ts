import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, renameSync } from "fs";
import { getPiAdapter } from "./pi";
import { createDefaultExtensionTheme } from "./extension-theme";
import { cacheSessionPath, resolveSessionPath, getSessionHeaderCached } from "./session-reader";
import { loadSessionState, recordActiveSession } from "./session-state-store";
import { getRegistry, getLocks, notifyRunningChange, countAliveSessions } from "./session-registry";
import type { AgentSessionLike, ExtensionUiContextLike, ToolInfo } from "./pi-types";
import type { SlashCommandInfo } from "./pi";
import type { ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "./types";
import { getAgentsMdModular } from "@/lib/prompt-modules-state";
import { composeModularAgentsMdSystemPrompt } from "@/lib/prompt-system/agents-md-modules";

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

type CustomUiComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

type ActiveCustomUi = {
  component: CustomUiComponent;
  width: number;
  resolve: (value: unknown) => void;
  settled: boolean;
};

type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

type ExtensionCommandContextActionsLike = {
  waitForIdle: () => Promise<void>;
  newSession: () => Promise<{ cancelled: boolean }>;
  fork: () => Promise<{ cancelled: boolean }>;
  navigateTree: (
    targetId: string,
    options?: { summarize?: boolean },
  ) => Promise<{ cancelled: boolean }>;
  switchSession: () => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
};

type ExtensionBindingOptions = {
  forceEmptySystemPrompt?: boolean;
};

/**
 * Idle-timeout options for AgentSessionWrapper.
 *
 * `idleTimeoutMs` is exposed (and shortened in tests) so the lifecycle can be
 * exercised without waiting 10 real minutes. The prompt-running pause logic
 * (see resetIdleTimer) is independent of the duration.
 */
export interface AgentSessionWrapperOptions {
  idleTimeoutMs?: number;
  /** P5：idle 硬上限覆盖（测试可缩短），默认 HARD_IDLE_MAX_MS。 */
  hardIdleMaxMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

// P5：idle 硬上限。handleIdleTimeout 在 prompt 运行时无限重排 idle timer，
// 永不回收；若 prompt 卡死/死循环，wrapper 永不销毁导致资源泄漏。硬上限 timer
// 无论是否 running 都会兜底 destroy，作为最后防线。12h 默认，可由
// PI_WEB_HARD_IDLE_MAX_MS 覆盖（人工拍板容量）。
const HARD_IDLE_MAX_MS = Number(process.env.PI_WEB_HARD_IDLE_MAX_MS ?? 12 * 60 * 60 * 1000);

const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];

  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const extensionToolNames = session
    .getAllTools()
    .map((t) => t.name)
    .filter((name) => !codingToolNames.has(name));

  return [...new Set([...toolNames, ...extensionToolNames])];
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private pendingUiResponses = new Map<string, PendingUiResponse>();
  private pendingUiRequests = new Map<string, AgentEvent>();
  private activeCustomUis = new Map<string, ActiveCustomUi>();
  private extensionStatuses = new Map<string, string>();
  private extensionWidgets = new Map<string, ExtensionWidgetItem>();
  private promptRunning = false;
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private forceEmptySystemPrompt = false;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private hardLimitTimer: ReturnType<typeof setTimeout> | null = null;
  private createdAt = Date.now();
  private onDestroyCallback: (() => void) | null = null;
  private _alive = true;
  private readonly idleTimeoutMs: number;
  private readonly hardIdleMaxMs: number;
  private readonly defaultExtensionTheme: ReturnType<typeof createDefaultExtensionTheme>;

  readonly inner: AgentSessionLike;

  constructor(inner: AgentSessionLike, options?: AgentSessionWrapperOptions) {
    this.inner = inner;
    this.idleTimeoutMs = options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.hardIdleMaxMs = options?.hardIdleMaxMs ?? HARD_IDLE_MAX_MS;
    // Extensions written for pi's TUI assume the `theme` argument to
    // `ctx.ui.custom((tui, theme, …) => …)` is a real Theme instance.
    // Without one, `theme.bold(text)` etc. crash inside the extension's
    // `render(width)` and surface here as
    //   "Extension custom UI render failed: Cannot read properties of
    //    undefined (reading 'bold')".
    this.defaultExtensionTheme = createDefaultExtensionTheme();
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  /**
   * 改写 session 文件 header line 的 parentSession 字段。
   * 典型用法：plan-mode 创建的 pi session 入口设 marker = `orchestrator:<orchId>`，
   * session-reader 在 listAllSessions 解析时识别该前缀，归一化为 orchestratorParentId。
   * 实现：读首行（header）、改 parentSession、原子 tmp+rename 回写。
   * parentSession 在 pi 里仅用于显示元数据（参见 AGENTS.md），不会破坏聊天内容。
   * 空字符串视为清空 marker。文件缺失或 header 损坏时抛错（路由层会包装为 ok=false）。
   */
  setSessionParent(parentSession: string): void {
    const filePath = this.inner.sessionFile;
    if (!filePath) throw new Error("Session has no file path; cannot set parentSession");
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (e) {
      throw new Error(`failed to read session file: ${e instanceof Error ? e.message : String(e)}`);
    }
    const newlineIdx = raw.indexOf("\n");
    if (newlineIdx < 0) throw new Error("Session file has no header line");
    let header: Record<string, unknown>;
    try {
      header = JSON.parse(raw.slice(0, newlineIdx)) as Record<string, unknown>;
    } catch (e) {
      throw new Error(
        `session header is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (parentSession) header.parentSession = parentSession;
    else delete header.parentSession;
    const newHeader = JSON.stringify(header);
    const rest = raw.slice(newlineIdx);
    const tmp = `${filePath}.parent.tmp`;
    writeFileSync(tmp, newHeader + rest, "utf8");
    renameSync(tmp, filePath);
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return this._alive && (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting);
  }

  start(): void {
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      this.resetIdleTimer();
      this.emit(event);
      // Streaming / compaction / tool events flow through here; re-broadcast
      // the running-status snapshot so the sidebar can update live.
      notifyRunningChange();
    });
    this.resetIdleTimer();
    // P5：idle 硬上限兜底。即使 prompt 卡死导致 handleIdleTimeout 无限重排，
    // 此 timer 也会在 HARD_IDLE_MAX_MS 后无条件 destroy，防止 wrapper 永不回收。
    if (this.hardLimitTimer) clearTimeout(this.hardLimitTimer);
    this.hardLimitTimer = setTimeout(() => {
      if (this._alive) this.destroy();
    }, this.hardIdleMaxMs);
    notifyRunningChange();
  }

  setForceEmptySystemPrompt(force: boolean): void {
    this.forceEmptySystemPrompt = force;
    this.applyForcedEmptySystemPrompt();
  }

  beginExtensionBinding(options: ExtensionBindingOptions = {}): void {
    void this.ensureExtensionsBound(options).catch((err) => {
      console.error(
        "[pi-web] failed to dispatch session_start to extensions:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  private ensureExtensionsBound(options: ExtensionBindingOptions = {}): Promise<void> {
    if (options.forceEmptySystemPrompt) this.forceEmptySystemPrompt = true;
    if (this.extensionsBound) {
      this.applyForcedEmptySystemPrompt();
      return Promise.resolve();
    }
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    this.extensionBindingPromise = (async () => {
      if (!this._alive) return;
      const uiContext = this.createExtensionUiContext();
      if (typeof this.inner.bindExtensions === "function") {
        const bindExtensions = this.inner.bindExtensions as (bindings: {
          uiContext?: ExtensionUiContextLike;
          mode?: "rpc";
          commandContextActions?: ExtensionCommandContextActionsLike;
          shutdownHandler?: () => void;
          onError?: (error: { extensionPath: string; event: string; error: string }) => void;
        }) => Promise<void>;
        await bindExtensions.call(this.inner, {
          uiContext,
          mode: "rpc",
          commandContextActions: this.createExtensionCommandContextActions(),
          shutdownHandler: () =>
            this.emit({
              type: "extension_ui_request",
              id: randomUUID(),
              method: "notify",
              notifyType: "warning",
              message: "Extension requested shutdown, but shutdown is not supported in pi-web.",
            }),
          onError: (error) =>
            this.emit({
              type: "extension_error",
              extensionPath: error.extensionPath,
              event: error.event,
              error: error.error,
            }),
        });
      } else {
        this.inner.extensionRunner.setUIContext?.(uiContext, "rpc");
      }
      this.extensionsBound = true;
      this.applyForcedEmptySystemPrompt();
      console.warn(
        `[pi-web] session_start dispatched to extensions for session ${this.inner.sessionId}`,
      );
    })().catch((err) => {
      this.extensionBindingError = err;
      throw err;
    });

    return this.extensionBindingPromise;
  }

  private async waitForExtensionsBound(): Promise<void> {
    try {
      if (this.extensionBindingPromise) await this.extensionBindingPromise;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    if (this.extensionBindingError) {
      throw this.extensionBindingError instanceof Error
        ? this.extensionBindingError
        : new Error(String(this.extensionBindingError));
    }
  }

  private shouldWaitForExtensions(type: string): boolean {
    return type === "prompt" || type === "steer" || type === "follow_up" || type === "get_commands";
  }

  private async withFinalRunningNotification<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      notifyRunningChange();
    }
  }

  private applyForcedEmptySystemPrompt(): void {
    if (this.forceEmptySystemPrompt && this.inner.agent.state) {
      this.inner.agent.state.systemPrompt = "";
    }
  }

  private emit(event: AgentEvent): void {
    for (const l of this.listeners) l(event);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.handleIdleTimeout(), this.idleTimeoutMs);
  }

  /**
   * Idle-timeout handler. A prompt can stream silently (long thinking block,
   * hung provider, slow tool) for longer than the idle timeout without emitting
   * any event to reset the timer. Destroying mid-prompt leaves an orphaned
   * inner.prompt promise that then fires callbacks on a dead wrapper. Instead,
   * while a prompt is running, reschedule rather than destroy.
   */
  private handleIdleTimeout(): void {
    if (this.promptRunning) {
      this.idleTimer = setTimeout(() => this.handleIdleTimeout(), this.idleTimeoutMs);
      return;
    }
    this.destroy();
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    for (const event of this.pendingUiRequests.values()) listener(event);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;
    if (this.shouldWaitForExtensions(type)) await this.waitForExtensionsBound();

    switch (type) {
      case "prompt": {
        // Fire and forget — events come via subscribe
        const promptImages = command.images as
          Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
        this.promptRunning = true;
        notifyRunningChange();
        this.inner
          .prompt(command.message as string, {
            ...(promptImages?.length ? { images: promptImages } : {}),
            ...(streamingBehavior ? { streamingBehavior } : {}),
            source: "rpc",
          })
          .then(() => {
            // The wrapper may have been destroyed (idle timeout, explicit
            // close, fork) while this prompt was in flight. Drop the callback
            // — emitting prompt_done / notifyRunningChange on a dead wrapper
            // surfaces as ghost state in the UI and re-enters a torn-down
            // session registry.
            if (!this._alive) return;
            this.promptRunning = false;
            // Resume the idle timer now that no prompt is running.
            this.resetIdleTimer();
            if (!streamingBehavior) this.emit({ type: "prompt_done" });
            notifyRunningChange();
          })
          .catch((error) => {
            if (!this._alive) return;
            this.promptRunning = false;
            this.resetIdleTimer();
            this.emit({
              type: "prompt_error",
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            if (!streamingBehavior) this.emit({ type: "prompt_done" });
            notifyRunningChange();
          });
        return null;
      }

      case "abort":
        await this.withFinalRunningNotification(() => this.inner.abort());
        return null;

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.promptRunning,
          isCompacting: this.inner.isCompacting,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: this.inner.pendingMessageCount,
          queuedMessages: {
            steering: [...this.inner.getSteeringMessages()],
            followUp: [...this.inner.getFollowUpMessages()],
          },
          contextUsage: contextUsage
            ? {
                percent: contextUsage.percent,
                contextWindow: contextUsage.contextWindow,
                tokens: contextUsage.tokens,
              }
            : null,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          extensionStatuses: this.getExtensionStatuses(),
          extensionWidgets: this.getExtensionWidgets(),
          // Pending UI requests (dialogs / custom panels / widgets / status)
          // the server is still awaiting a response for. The client's reconcile
          // poll re-applies these so a missed SSE event auto-recovers without a
          // manual page refresh (e.g. the rpiv-ask-user-question questionnaire
          // or the rpiv-todo overlay popping into the conversation).
          pendingUiRequests: this.getPendingUiRequests() as ExtensionUiRequest[],
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        const registry = this.inner.modelRegistry;
        const model = registry.find(provider, modelId);
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        const entryId = command.entryId as string;

        // L9 修复：若当前会话正在运行（prompt 进行中 / streaming / compaction），
        // 必须先干净地 abort 当前 run，再派生 fork。否则旧会话的 SDK 状态与
        // 会话文件可能停留在「进行中 run 中途」，新 fork 会从不一致的检查点
        // 派生，导致文件状态不一致、丢失进行中 run 的边界错乱。
        // 复用 destroy() 内的 abort 语义，但此处 await 完成再继续，确保停止彻底。
        if (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting) {
          await this.withFinalRunningNotification(() => this.inner.abort());
          this.promptRunning = false;
        }

        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          const newManager = getPiAdapter().SessionManager.create(
            sessionManager.getCwd(),
            sessionDir,
          );
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = getPiAdapter().SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        const newSessionId = getPiAdapter()
          .SessionManager.open(newSessionFile, sessionDir)
          .getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        this.destroy();
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (
          level === "xhigh" &&
          (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat
            ?.thinkingFormat === "deepseek" &&
          this.inner.agent?.state
        ) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        return null;
      }

      case "compact": {
        const result = await this.withFinalRunningNotification(() =>
          this.inner.compact(command.customInstructions as string | undefined),
        );
        return result;
      }

      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.inner.setSessionName(name);
        return null;
      }

      case "get_session_stats": {
        return {
          ...this.inner.getSessionStats(),
          sessionName: this.inner.sessionManager.getSessionName(),
        };
      }

      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "clear_queue": {
        // Full clear only: pi has no single-item dequeue, and clear+requeue
        // races against the agent loop pulling messages mid-flight.
        return this.inner.clearQueue();
      }

      case "steer": {
        const steerImages = command.images as
          Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.steer(
          command.message as string,
          steerImages?.length ? steerImages : undefined,
        );
        return null;
      }

      case "follow_up": {
        const followImages = command.images as
          Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(
          command.message as string,
          followImages?.length ? followImages : undefined,
        );
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "get_commands": {
        const commands: SlashCommandInfo[] = [];
        for (const registered of this.inner.extensionRunner.getRegisteredCommands()) {
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
            sourceInfo: registered.sourceInfo,
          });
        }
        for (const template of this.inner.promptTemplates) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
            sourceInfo: template.sourceInfo,
          });
        }
        for (const skill of this.inner.resourceLoader.getSkills().skills) {
          commands.push({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
            sourceInfo: skill.sourceInfo,
          });
        }
        return { commands };
      }

      case "set_tools": {
        const toolNames = command.toolNames as string[];
        this.setForceEmptySystemPrompt(toolNames.length === 0);
        // The per-tool config panel sends the complete user-chosen tool list
        // (built-in + extension tools), so apply it directly without re-unioning
        // — otherwise toggling an extension tool off would immediately re-enable it.
        this.inner.setActiveToolsByName(toolNames);
        this.applyForcedEmptySystemPrompt();
        return null;
      }

      case "reload": {
        await this.waitForExtensionsBound();
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        await this.inner.reload();
        if (typeof this.inner.bindExtensions !== "function") {
          this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
        }
        this.applyForcedEmptySystemPrompt();
        return { success: true };
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "extension_ui_response": {
        this.resolveExtensionUiResponse(command as ExtensionUiResponse);
        return null;
      }

      case "extension_ui_input": {
        this.handleExtensionUiInput(command.id as string, command.data as string);
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.hardLimitTimer) clearTimeout(this.hardLimitTimer);
    this.hardLimitTimer = null;
    this.unsubscribe?.();
    // Abort an in-flight prompt so the inner SDK stops work on a session the
    // web client has torn down. Fire-and-forget: the prompt's .then/.catch
    // guards below drop callbacks once _alive is false.
    if (this.promptRunning) {
      void Promise.resolve(this.inner.abort?.()).catch(() => {});
    }
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    this.onDestroyCallback?.();
    notifyRunningChange();
  }

  private resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    pending.resolve(response);
  }

  private getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(this.extensionStatuses, ([key, text]) => ({ key, text }));
  }

  private getExtensionWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values());
  }

  private getPendingUiRequests(): AgentEvent[] {
    return Array.from(this.pendingUiRequests.values());
  }

  private getCustomUiWidth(options: unknown): number {
    if (!options || typeof options !== "object") return 92;
    const overlayOptions = (options as { overlayOptions?: unknown }).overlayOptions;
    const resolved = typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
    if (!resolved || typeof resolved !== "object") return 92;
    const width = (resolved as { width?: unknown }).width;
    return typeof width === "number" && Number.isFinite(width)
      ? Math.max(40, Math.min(140, Math.round(width)))
      : 92;
  }

  private emitCustomUiRender(id: string, custom: ActiveCustomUi): void {
    let lines: string[];
    try {
      lines = custom.component.render(custom.width);
    } catch (error) {
      lines = [
        `Extension custom UI render failed: ${error instanceof Error ? error.message : String(error)}`,
      ];
    }
    const event = {
      type: "extension_ui_request",
      id,
      method: "custom",
      lines,
    };
    this.pendingUiRequests.set(id, event);
    this.emit(event);
  }

  private closeCustomUi(id: string, value: unknown): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || custom.settled) return;
    custom.settled = true;
    this.activeCustomUis.delete(id);
    this.pendingUiRequests.delete(id);
    try {
      custom.component.dispose?.();
    } catch {
      // Ignore dispose errors from extension UI components.
    }
    this.emit({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines: [],
      closed: true,
    });
    custom.resolve(value);
  }

  private handleExtensionUiInput(id: string, data: string): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || typeof data !== "string") return;
    try {
      custom.component.handleInput?.(data);
      if (this.activeCustomUis.has(id)) this.emitCustomUiRender(id, custom);
    } catch (error) {
      this.closeCustomUi(id, undefined);
      this.emit({
        type: "extension_error",
        extensionPath: `custom-ui:${id}`,
        event: "custom_ui_input",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private requestExtensionCustomUi<T>(factory: unknown, options?: unknown): Promise<T> {
    if (typeof factory !== "function") return Promise.resolve(undefined as T);

    const id = randomUUID();
    const width = this.getCustomUiWidth(options);

    return new Promise<T>((resolve) => {
      const tui = {
        requestRender: () => {
          const custom = this.activeCustomUis.get(id);
          if (custom) this.emitCustomUiRender(id, custom);
        },
      };
      const done = (value: T) => this.closeCustomUi(id, value);

      Promise.resolve()
        .then(() => factory(tui, this.defaultExtensionTheme, undefined, done))
        .then((component) => {
          if (
            !component ||
            typeof component !== "object" ||
            typeof (component as CustomUiComponent).render !== "function"
          ) {
            resolve(undefined as T);
            return;
          }
          const custom: ActiveCustomUi = {
            component: component as CustomUiComponent,
            width,
            resolve: (value) => resolve(value as T),
            settled: false,
          };
          this.activeCustomUis.set(id, custom);
          this.emitCustomUiRender(id, custom);
        })
        .catch((error) => {
          this.emit({
            type: "extension_error",
            extensionPath: `custom-ui:${id}`,
            event: "custom_ui",
            error: error instanceof Error ? error.message : String(error),
          });
          resolve(undefined as T);
        });
    });
  }

  private requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.resolve(defaultValue);

    const id = randomUUID();
    const fullRequest = {
      type: "extension_ui_request",
      id,
      ...request,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    };

    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        this.pendingUiRequests.delete(id);
        this.pendingUiResponses.delete(id);
      };
      const settle = (value: T) => {
        cleanup();
        resolve(value);
      };
      const onAbort = () => settle(defaultValue);

      if (timeout) timeoutId = setTimeout(() => settle(defaultValue), timeout);
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => settle(defaultValue),
      });
      this.emit(fullRequest as AgentEvent);
    });
  }

  private createExtensionUiContext(): ExtensionUiContextLike {
    const theme = this.defaultExtensionTheme;
    return {
      select: (title, options, opts) =>
        this.requestExtensionUi(
          { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
          undefined,
          (response) => ("value" in response ? response.value : undefined),
          opts?.timeout,
          opts?.signal,
        ),
      confirm: (title, message, opts) =>
        this.requestExtensionUi(
          {
            method: "confirm",
            title,
            message,
            ...(opts?.timeout ? { timeout: opts.timeout } : {}),
          },
          false,
          (response) => ("confirmed" in response ? response.confirmed : false),
          opts?.timeout,
          opts?.signal,
        ),
      input: (title, placeholder, opts) =>
        this.requestExtensionUi(
          {
            method: "input",
            title,
            ...(placeholder !== undefined ? { placeholder } : {}),
            ...(opts?.timeout ? { timeout: opts.timeout } : {}),
          },
          undefined,
          (response) => ("value" in response ? response.value : undefined),
          opts?.timeout,
          opts?.signal,
        ),
      editor: (title, prefill, opts) =>
        this.requestExtensionUi(
          {
            method: "editor",
            title,
            ...(prefill !== undefined ? { prefill } : {}),
            ...(opts?.timeout ? { timeout: opts.timeout } : {}),
          },
          undefined,
          (response) => ("value" in response ? response.value : undefined),
          opts?.timeout,
          opts?.signal,
        ),
      notify: (message, type) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        });
      },
      onTerminalInput: () => () => {},
      setStatus: (key, text) => {
        if (text === undefined) this.extensionStatuses.delete(key);
        else this.extensionStatuses.set(key, text);
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setStatus",
          statusKey: key,
          statusText: text,
        });
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, content, options) => {
        if (content !== undefined && !Array.isArray(content)) return;
        if (content === undefined) {
          this.extensionWidgets.delete(key);
        } else {
          this.extensionWidgets.set(key, {
            key,
            lines: content,
            placement: options?.placement ?? "aboveEditor",
          });
        }
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content,
          widgetPlacement: options?.placement,
        });
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        });
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) =>
        this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        });
      },
      setEditorText: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        });
      },
      getEditorText: () => "",
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      get theme() {
        return theme;
      },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({
        success: false,
        error: "Theme switching is not supported in pi-web extension UI yet",
      }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }

  private createExtensionCommandContextActions(): ExtensionCommandContextActionsLike {
    return {
      waitForIdle: async () => {
        const agent = this.inner.agent as { waitForIdle?: () => Promise<void> };
        await agent.waitForIdle?.();
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async (targetId, options) => {
        const result = await this.inner.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        await this.inner.reload({
          beforeSessionStart: () => {
            this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
          },
        });
        this.applyForcedEmptySystemPrompt();
      },
    };
  }
}

// ============================================================================
// Session registry (extracted to session-registry.ts for testability)
// ============================================================================

// P6：并发上限信号量。进程内常驻的完整 AgentSession 内存/CPU 开销大，无上限时
// 攻击者枚举不同 id 并发 startRpcSession 可耗尽资源（OOM/外部 LLM 配额打满）。
// 默认 8 并发，可由 PI_WEB_MAX_CONCURRENT_SESSIONS 覆盖；PI_WEB_DISABLE_CONCURRENCY_LIMIT=1
// 降级关闭（仿 S1/S2，防本地联调误伤）。超额时抛 SessionLimitError（statusCode=429）。
const MAX_CONCURRENT_SESSIONS = Number(process.env.PI_WEB_MAX_CONCURRENT_SESSIONS ?? 8);
const CONCURRENCY_LIMIT_ENABLED = process.env.PI_WEB_DISABLE_CONCURRENCY_LIMIT !== "1";

/** P6：并发超限错误，路由层 errorResponse 识别 statusCode 返回 429。 */
export class SessionLimitError extends Error {
  readonly statusCode = 429;
  constructor(
    message = `Too many concurrent sessions (max ${MAX_CONCURRENT_SESSIONS}); retry later`,
  ) {
    super(message);
    this.name = "SessionLimitError";
  }
}
// getRegistry, getLocks, getRpcSession, subscribeRunningSessions,
// notifyRunningChange are imported from ./session-registry.
// AgentSessionWrapper satisfies SessionHandle structurally.

/** Re-export for API route consumers. */
export { subscribeRunningSessions } from "./session-registry";
export { getRunningRpcSessionIds } from "./session-registry";

/** Typed wrapper — registry stores SessionHandle, callers get AgentSessionWrapper. */
export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId) as AgentSessionWrapper | undefined;
}

// One-time process cleanup + sidecar restore (added to getRegistry on first call).
let registryInitialized = false;
function ensureRegistryInitialized(): void {
  if (registryInitialized) return;
  registryInitialized = true;
  const cleanup = () => getRegistry().forEach((s) => s.destroy());
  process.once("exit", cleanup);
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  maybeRestore();
  // Auto-install recommended plugins if missing (fire-and-forget).
  void import("./plugin-auto-install").then(({ ensureRecommendedPlugins }) => {
    void ensureRecommendedPlugins();
  });
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[],
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  ensureRegistryInitialized();
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive())
    return { session: existing as AgentSessionWrapper, realSessionId: sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight as Promise<{ session: AgentSessionWrapper; realSessionId: string }>;

  // P6：并发上限信号量。existing/inflight 已命中则上方早退（复用不计入新增并发）；
  // 到此处说明确需新建会话，检查当前存活会话数。注意：此检查在 starting IIFE
  // 执行前同步进行，避免昂贵的 createAgentSessionServices 已完成才拒绝。
  // 降级开关 PI_WEB_DISABLE_CONCURRENCY_LIMIT=1 时跳过（本地联调/受信环境）。
  if (CONCURRENCY_LIMIT_ENABLED && countAliveSessions() >= MAX_CONCURRENT_SESSIONS) {
    throw new SessionLimitError();
  }

  const starting = (async () => {
    const agentDir = getPiAdapter().agentDir;

    const sessionManager = sessionFile
      ? getPiAdapter().SessionManager.open(sessionFile, undefined)
      : getPiAdapter().SessionManager.create(cwd, undefined);

    // Determine which tools to pass based on requested toolNames.
    // Since v0.68.0, session creation expects string[] tool names instead of Tool[] instances.
    let toolsOption: string[] | undefined;
    if (toolNames !== undefined) {
      // toolNames === [] -> "all off" (an empty allow-list disables every tool).
      // Otherwise DO NOT pass a builtin-only allow-list: passing CODING_TOOL_NAMES
      // set allowedToolNames to coding builtins only, which filtered every
      // extension/package-provided tool (e.g. subagents, web access) out of the
      // tool registry — so they were unavailable in pi-web sessions even though the
      // `pi` CLI keeps them. Leaving the allow-list unset lets the SDK register all
      // tools (and activate extension tools); we narrow the ACTIVE set below.
      toolsOption = toolNames.length === 0 ? [] : undefined;
    }

    // Build services first so extension-registered providers are available
    // before the SDK restores the saved model from the session file.
    const services = await getPiAdapter().createAgentSessionServices({ cwd, agentDir });
    const { session: inner } = await getPiAdapter().createAgentSessionFromServices({
      services,
      sessionManager,
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
    });

    // If specific tool names were requested (non-empty), set the active tools to the
    // requested builtin coding tools PLUS all extension/package tools, so installed
    // extensions stay usable in pi-web just like in the `pi` CLI.
    if (toolNames && toolNames.length > 0) {
      inner.setActiveToolsByName(withExtensionTools(inner, toolNames));
    }

    const wrapper = new AgentSessionWrapper(inner);
    // When all tools are disabled, clear the system prompt entirely.
    // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
    // keep this forced after extension resource discovery and reloads as well.
    if (toolNames?.length === 0) {
      wrapper.setForceEmptySystemPrompt(true);
    }

    // AGENTS.md modular 总闸（默认关）：开启时按模块开关+选择裁剪 coding-agent
    // 系统提示词中的 AGENTS.md 片段，减少 Token。仅在 SDK 已构建完整提示词时生效，
    // 仅替换 AGENTS.md 注入段，保留 SYSTEM.md/APPEND_SYSTEM.md/SKILLS.md/工具约束等。
    // 失败一律回退 SDK 原样，绝不阻断会话。
    if (getAgentsMdModular()) {
      try {
        const base = inner.agent.state?.systemPrompt ?? "";
        if (base) {
          const merged = composeModularAgentsMdSystemPrompt({ cwd, baseSystemPrompt: base });
          if (merged && merged.trim() && inner.agent.state) {
            inner.agent.state.systemPrompt = merged;
          }
        }
      } catch {
        // 回退 SDK 默认系统提示词
      }
    }
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    // Guard against a duplicate-session race: the input `sessionId` for a new
    // session is a one-time temp key, while the lock is keyed on it. A
    // concurrent caller that already knows the realSessionId (e.g. events + POST
    // racing on a freshly-created session) could pass both the registry and the
    // lock checks under that temp key and build a second wrapper for the same
    // real session. If one already won, discard ours and return the winner.
    const raced = registry.get(realSessionId);
    if (raced && raced !== wrapper && raced.isAlive()) {
      wrapper.destroy();
      return { session: raced as AgentSessionWrapper, realSessionId };
    }

    wrapper.onDestroy(() => registry.delete(realSessionId));
    registry.set(realSessionId, wrapper);
    wrapper.beginExtensionBinding({ forceEmptySystemPrompt: toolNames?.length === 0 });

    // Persist to sidecar so this session can be pre-warmed after a process restart.
    recordActiveSession(realSessionId, toolNames?.length === 0);

    return { session: wrapper, realSessionId };
  })();

  // Set the lock BEFORE the IIFE can yield — prevents concurrent callers from
  // passing the inflight check above and creating duplicate sessions.
  locks.set(sessionId, starting);
  return starting.finally(() => locks.delete(sessionId));
}

// ----------------------------------------------------------------------------
// Restart recovery — pre-warm recently active sessions from the sidecar.
//
// Called once (lazily) when the registry is first accessed after a process
// restart. Fire-and-forget: failures don't block the app from starting.
// ----------------------------------------------------------------------------

let restoreStarted = false;

export async function restoreActiveSessions(): Promise<void> {
  const state = loadSessionState();
  // Only pre-warm the 5 most recent — avoids heavy I/O on startup.
  const recent = [...state.activeSessions].sort((a, b) => b.lastActive - a.lastActive).slice(0, 5);

  for (const entry of recent) {
    try {
      const filePath = await resolveSessionPath(entry.sessionId);
      if (!filePath) continue; // session deleted from disk — skip
      const cwd = getSessionHeaderCached(filePath)?.cwd as string;
      if (!cwd) continue;
      // toolNames=undefined lets the SDK restore the saved tool set from .jsonl;
      // we re-apply toolsDisabled separately via setForceEmptySystemPrompt.
      const { session } = await startRpcSession(entry.sessionId, filePath, cwd, undefined);
      if (entry.toolsDisabled) session.setForceEmptySystemPrompt(true);
    } catch {
      // Individual session restore failure is non-fatal — skip and continue.
    }
  }
}

/** Lazy trigger: runs restoreActiveSessions exactly once on first registry access. */
function maybeRestore(): void {
  if (restoreStarted) return;
  restoreStarted = true;
  void restoreActiveSessions();
}
