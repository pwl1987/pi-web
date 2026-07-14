/**
 * globalThis.__ 单例集中类型注册表
 *
 * 本文件收敛全项目约 27 处 `globalThis.__` 单例的 TypeScript 类型声明，
 * 降低新人认知成本。使用泛型占位而非精确类型导入，避免交叉模块依赖导致
 * 编译期类型冲突与 `declare global` 的 TS2403 重复声明错误。
 *
 * 使用方式：各模块在自身文件内 `declare global` 声明运行时类型（精确类型在此处），
 * 本文件作为纯文档参考——记录了每个单例的 key、持有类型、所在文件与用途。
 *
 * 运行时初始化仍由各模块在首次访问时自行完成（`if (!globalThis.__Xxx) ...`），
 * 避免集中初始化增加模块耦合与启动顺序依赖。
 */

/**
 * ## 单例清单
 *
 * | Key | 持有类型 | 所在文件 | 用途 |
 * |-----|---------|---------|------|
 * | `__piSdkAdapter` | `PiSdkAdapter` | `lib/pi.ts:22` | SDK 适配器单例 |
 * | `__piSessions` | `Map<string, SessionHandle>` | `lib/session-registry.ts:24` | 活跃 RPC 会话注册表 |
 * | `__piStartLocks` | `Map<string, Promise<…>>` | `lib/session-registry.ts:34` | startRpcSession 并发合并锁 |
 * | `__piRunningListeners` | `Set<(ids: string[]) => void>` | `lib/session-registry.ts:55` | 运行态变更订阅 |
 * | `__piSessionPathCache` | `Map<string, {path,expiresAt}>` | `lib/session-reader.ts:95` | sessionId→文件路径缓存（60s TTL） |
 * | `__piSessionDataCache` | `Map<string, CachedSessionSnapshot>` | `lib/session-reader.ts:97` | 会话数据 mtime LRU 缓存 |
 * | `__piSessionEntriesCache` | `Map<string, {mtimeMs,entries}>` | `lib/session-reader.ts:99` | @deprecated 旧缓存（保留兼容） |
 * | `__piListAllPromise` | `Promise<SessionInfo[]>` | `lib/session-reader.ts:101` | listAllSessions in-flight 去重 |
 * | `__piAgentRuntimeStore` | `AgentRuntimeStore` | `lib/agent-runtime-store.ts:86` | 运行态外部 Store |
 * | `__piWebExtensionRegistry` | `ExtensionRegistry` | `lib/extensions/registry.ts:246` | UI 扩展注册表 |
 * | `__piWebAgentEventBus` | `AgentEventBus` | `lib/extensions/event-bus.ts:71` | 扩展事件总线 |
 * | `__piPlanModeStore` | `PlanModeStore` | `lib/plan-mode-store.ts:189` | 计划模式全局 Store |
 * | `__piConstraintEngine` | `ConstraintEngine` | `lib/constraints/index.ts:45` | 约束引擎单例 |
 * | `__piProjectCache` | `Map<string, {info,expiresAt}>` | `lib/worktree.ts:43` | 项目根目录缓存 |
 * | `__piAdditionalAllowedRoots` | `Set<string>` | `lib/allowed-roots.ts:13` | 附加允许根目录 |
 * | `__piAllowedRootsCache` | `{roots: Set<string>, expiresAt}` | `lib/file-access.ts:52` | 允许根目录缓存 |
 * | `__piEngineLogRing` | `LogEntry[]` | `lib/engine-logger.ts:57` | 引擎日志环形缓冲 |
 * | `__piEngineLogFileBuffer` | `string[]` | `lib/engine-logger.ts:61` | 文件缓冲 |
 * | `__piEngineLogLevel` | `LogLevel` | `lib/engine-logger.ts:67` | 引擎日志级别 |
 * | `__piEngineLogFlushScheduled` | `boolean` | `lib/engine-logger.ts:94` | 刷新防抖标记 |
 * | `__piEngineLogHooksRegistered` | `boolean` | `lib/engine-logger.ts:193` | 钩子注册标记 |
 * | `__piAutoInstallLock` | `Promise<PluginInstallResult[]>` | `lib/plugin-auto-install.ts:43` | 插件自动安装去重锁 |
 * | `__piAutoInstallResults` | `PluginInstallResult[]` | `lib/plugin-auto-install.ts:96` | 自动安装结果缓存 |
 * | `__piLoginCallbacks` | `Map<string, {resolve,reject}>` | `app/api/auth/login/…/route.ts:15` | 登录回调注册表 |
 * | `__piFileIndexCache` | `Map<string, CacheEntry>` | `app/api/file-index/route.ts:45` | 文件索引缓存 |
 * | `__piWebPinnedDirsBus` | `PinnedDirsBus` | `lib/pinned-dirs-bus.ts:40` | 置顶目录变更总线 |
 * | `__piLlmCompletionCache` | `Map<string, LlmCompletion>` | `lib/agent-orchestrator/llm-backend.ts:16` | LLM 完成结果缓存 |
 * | `__piOrchestrators` | `Map<string, AgentOrchestrator>` | `lib/agent-orchestrator/orchestrator.ts:645` | 编排器实例注册表 |
 *
 * 共计 **28** 处 globalThis.__ 单例。
 */

export {};
