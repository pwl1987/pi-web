// ============================================================================
// Pi SDK Anti-Corruption Layer — service locator (dependency-injection seam)
// ============================================================================
//
// `getPiAdapter()` is the ONLY way business code should obtain Pi SDK
// capabilities. The returned adapter is a process-wide singleton kept on
// `globalThis` so it survives Next.js dev hot-reloads (matching the project's
// existing pattern for cross-reload singletons).
//
// `registerPiAdapter()` lets tests or a future non-Pi backend install an
// alternative implementation without any change to callers.

import { SdkAdapter } from "./pi-sdk-adapter";
import type { PiSdkPort } from "./pi-ports";

declare global {
  var __piSdkAdapter: PiSdkPort | undefined;
}

/** Install a custom adapter (e.g. a mock in tests, or a future backend). */
export function registerPiAdapter(adapter: PiSdkPort): void {
  globalThis.__piSdkAdapter = adapter;
}

/** Get the active Pi SDK adapter, constructing the default SDK adapter lazily. */
export function getPiAdapter(): PiSdkPort {
  if (!globalThis.__piSdkAdapter) {
    globalThis.__piSdkAdapter = new SdkAdapter();
  }
  return globalThis.__piSdkAdapter;
}

export type { PiSdkPort } from "./pi-ports";
export type {
  AgentSessionLike,
  SessionManagerInstancePort,
  SessionManagerStaticPort,
} from "./pi-ports";
// Re-export the SDK type vocabulary so business modules never need a direct
// (even type-only) import from the SDK packages — the entire SDK surface is
// reachable through this single module.
export type {
  AgentSessionEvent,
  SdkSessionManager,
  SdkSettingsManager,
  SlashCommandInfo,
  PiSessionEntry,
  PiSessionInfo,
  ThemeColor,
} from "./pi-ports";
