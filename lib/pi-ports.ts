// ============================================================================
// Pi SDK Anti-Corruption Layer — Port contracts
// ============================================================================
//
// This module defines the *behavioral contracts* the business layer depends on,
// plus a thin gateway that surfaces the underlying SDK namespaces in a single,
// controlled seam. No value import of the SDK happens here: the `import type`
// lines below are erased at runtime and therefore do NOT pull the SDK packages
// into any bundle. The only module that performs a runtime `import` of
// `@earendil-works/pi-*` is `./pi-sdk-adapter.ts`.
//
// Design goals (see docs/ARCHITECTURE-DECOUPLING.md):
//   1. Every business module reaches Pi exclusively through `getPiAdapter()`.
//   2. SDK version bumps / backend swaps touch ONLY `pi-sdk-adapter.ts`.
//   3. Behavioral ports (`SessionManagerStaticPort`, `createAgentSession*`) give
//      type-safe seams for the highest-traffic operations; the raw `codingAgent`
//      / `ai` / `aiCompat` namespaces cover the long tail of one-off calls
//      without inventing a hundred trivial port methods.

import type * as PiCodingAgentNS from "@earendil-works/pi-coding-agent";
import type * as PiAiNS from "@earendil-works/pi-ai";
import type * as PiAiCompatNS from "@earendil-works/pi-ai/compat";

import type { AgentSessionLike } from "./pi-types";

/** The agent session contract (already existed as `AgentSessionLike`). */
export type { AgentSessionLike } from "./pi-types";

// Re-export the handful of SDK *types* the codebase references, so no business
// module needs a direct (even type-only) import from the SDK packages.
export type {
  AgentSessionEvent,
  SessionManager as SdkSessionManager,
  SettingsManager as SdkSettingsManager,
  SlashCommandInfo,
  SessionEntry as PiSessionEntry,
  SessionInfo as PiSessionInfo,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
export type { AssistantMessage } from "@earendil-works/pi-ai/compat";

// ----------------------------------------------------------------------------
// Behavioral ports — the type-safe seams the business layer should prefer.
// ----------------------------------------------------------------------------

/** A single opened/created session file manager. */
export interface SessionManagerInstancePort {
  isPersisted(): boolean;
  getCwd(): string;
  getSessionDir(): string;
  getSessionFile(): string | undefined;
  getSessionId(): string;
  getEntry(entryId: string): unknown;
  getHeader(): { cwd?: string; parentSession?: string } | undefined;
  getSessionName(): string;
  getEntries(): unknown[];
  newSession(opts: { parentSession?: string }): void;
  createBranchedSession(entryParentId: string): string | undefined;
}

/** Static session-manager factory (open / create / listAll). */
export interface SessionManagerStaticPort {
  open(filePath: string, sessionDir?: string): SessionManagerInstancePort;
  create(cwd: string, sessionDir?: string): SessionManagerInstancePort;
  listAll(): Promise<unknown[]>;
}

/**
 * The unified Pi SDK port. The default `SdkAdapter` implements it by delegating
 * to `@earendil-works/pi-coding-agent` / `pi-ai`. Alternative implementations
 * (mock for tests, future non-Pi backend) can be registered via
 * `registerPiAdapter()` without touching any business code.
 */
export interface PiSdkPort {
  /** Type-safe seam for session-file management. */
  readonly sessionManager: SessionManagerStaticPort;
  /** Agent data directory (equivalent to `getAgentDir()`). */
  readonly agentDir: string;

  createAgentSessionServices(opts: { cwd: string; agentDir: string }): Promise<unknown>;
  createAgentSessionFromServices(opts: {
    services: unknown;
    sessionManager: SessionManagerInstancePort;
    tools?: string[];
  }): Promise<{ session: AgentSessionLike }>;
  buildSessionContext(
    entries: unknown[],
    leafId: string | null | undefined,
    byId: Map<string, unknown>,
  ): unknown;

  /** Raw SDK namespaces — the controlled gateway for one-off SDK calls. */
  readonly codingAgent: typeof PiCodingAgentNS;
  readonly ai: typeof PiAiNS;
  readonly aiCompat: typeof PiAiCompatNS;
}
