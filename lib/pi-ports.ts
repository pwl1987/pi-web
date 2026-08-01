// ============================================================================
// Pi SDK Anti-Corruption Layer — Port contract
// ============================================================================
//
// `PiSdkPort` is the only surface the business layer should depend on to reach
// the Pi SDK. It surfaces the SDK's high-traffic symbols as *named accessors*
// that carry the SDK's own types through unchanged — no `unknown`, no parallel
// weaker interfaces. Swapping the SDK version or replacing Pi entirely requires
// editing only `./pi-sdk-adapter.ts` (the single runtime import site).
//
// Design rationale (see docs/ARCHITECTURE-DECOUPLING.md):
//   - SDK classes (`SessionManager`, `AuthStorage`, …) are surfaced as typed
//     `readonly` references so consumers get the full SDK type surface (static
//     factory methods + instance methods) without importing the SDK package.
//   - Standalone functions (`createAgentSessionServices`, `completeSimple`, …)
//     reuse the SDK's own function types via `typeof`, so signatures can never
//     drift from the SDK and no downstream cast is ever needed.
//   - The raw `codingAgent`/`ai`/`aiCompat` namespaces are deliberately NOT
//     exposed: every SDK symbol must be named here, making the coupling surface
//     explicit and bounded.

import type {
  SdkAuthStorage,
  SdkDefaultPackageManager,
  SdkDefaultResourceLoader,
  SdkModelRegistry,
  SdkSessionManager,
  SdkSettingsManager,
  SdkTheme,
} from "./pi-types";
import type * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import type * as PiAi from "@earendil-works/pi-ai";
import type * as PiAiCompat from "@earendil-works/pi-ai/compat";

/**
 * The unified Pi SDK port. The default `SdkAdapter` (in `./pi-sdk-adapter.ts`)
 * implements it by delegating to `@earendil-works/pi-coding-agent` / `pi-ai`.
 * Alternative implementations (mock for tests, future non-Pi backend) can be
 * registered via `registerPiAdapter()` (see `./pi.ts`) without touching any
 * business code.
 */
export interface PiSdkPort {
  // --- Session file management (high-traffic) -------------------------------
  /** SDK `SessionManager` class — exposes `.open()`/`.create()`/`.listAll()`. */
  readonly SessionManager: typeof SdkSessionManager;

  // --- High-traffic SDK class references ------------------------------------
  readonly AuthStorage: typeof SdkAuthStorage;
  readonly ModelRegistry: typeof SdkModelRegistry;
  readonly SettingsManager: typeof SdkSettingsManager;
  readonly DefaultPackageManager: typeof SdkDefaultPackageManager;
  readonly DefaultResourceLoader: typeof SdkDefaultResourceLoader;
  readonly Theme: typeof SdkTheme;

  // --- Standalone functions (signatures borrowed verbatim from the SDK) ------
  readonly getAgentDir: typeof PiCodingAgent.getAgentDir;
  readonly getPackageDir: typeof PiCodingAgent.getPackageDir;
  readonly parseFrontmatter: typeof PiCodingAgent.parseFrontmatter;
  readonly buildSessionContext: typeof PiCodingAgent.buildSessionContext;
  readonly createAgentSessionServices: typeof PiCodingAgent.createAgentSessionServices;
  readonly createAgentSessionFromServices: typeof PiCodingAgent.createAgentSessionFromServices;
  readonly completeSimple: typeof PiAiCompat.completeSimple;
  readonly getSupportedThinkingLevels: typeof PiAi.getSupportedThinkingLevels;

  // --- Convenience ----------------------------------------------------------
  /** Cached agent dir (equivalent to `getAgentDir()`). */
  readonly agentDir: string;
}

// Re-export SDK type vocabulary so business modules never need a direct (even
// type-only) import from the SDK packages — the entire SDK surface is reachable
// through this module.
export type {
  AgentSessionLike,
  SdkAuthStorage,
  SdkDefaultPackageManager,
  SdkDefaultResourceLoader,
  SdkModelRegistry,
  SdkSessionManager,
  SdkSettingsManager,
  SdkTheme,
} from "./pi-types";
export type {
  AgentSessionServices,
  CreateAgentSessionFromServicesOptions,
  CreateAgentSessionResult,
  CreateAgentSessionServicesOptions,
  PackageSource,
  ResolvedPaths,
  ResolvedResource,
  SessionContext,
  SessionEntry as PiSessionEntry,
  SessionInfo as PiSessionInfo,
  SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
export type { AssistantMessage, SimpleStreamOptions } from "@earendil-works/pi-ai/compat";
export type { ThemeColor } from "@earendil-works/pi-coding-agent";
