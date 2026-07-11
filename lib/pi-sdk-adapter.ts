// ============================================================================
// Pi SDK Anti-Corruption Layer — default adapter
// ============================================================================
//
// THE single runtime import site for `@earendil-works/pi-*`. Every business
// module obtains Pi capabilities via `getPiAdapter()` (see ./pi.ts), which
// returns an instance of this class. Swapping the SDK version, or replacing Pi
// entirely, requires editing ONLY this file.
//
// Each property is a direct assignment of the SDK symbol — no casts. The port
// (`./pi-ports.ts`) borrows the SDK's own types via `typeof`, so the adapter
// satisfies the contract structurally and types flow to consumers unchanged.

import * as codingAgent from "@earendil-works/pi-coding-agent";
import * as ai from "@earendil-works/pi-ai";
import * as aiCompat from "@earendil-works/pi-ai/compat";

import type { PiSdkPort } from "./pi-ports";

class SdkAdapter implements PiSdkPort {
  // --- SDK class references -------------------------------------------------
  readonly SessionManager = codingAgent.SessionManager;
  readonly AuthStorage = codingAgent.AuthStorage;
  readonly ModelRegistry = codingAgent.ModelRegistry;
  readonly SettingsManager = codingAgent.SettingsManager;
  readonly DefaultPackageManager = codingAgent.DefaultPackageManager;
  readonly DefaultResourceLoader = codingAgent.DefaultResourceLoader;
  readonly Theme = codingAgent.Theme;

  // --- Standalone functions -------------------------------------------------
  readonly getAgentDir = codingAgent.getAgentDir;
  readonly getPackageDir = codingAgent.getPackageDir;
  readonly parseFrontmatter = codingAgent.parseFrontmatter;
  readonly buildSessionContext = codingAgent.buildSessionContext;
  readonly createAgentSessionServices = codingAgent.createAgentSessionServices;
  readonly createAgentSessionFromServices = codingAgent.createAgentSessionFromServices;
  readonly completeSimple = aiCompat.completeSimple;
  readonly getSupportedThinkingLevels = ai.getSupportedThinkingLevels;

  // --- Convenience ----------------------------------------------------------
  get agentDir(): string {
    return codingAgent.getAgentDir();
  }
}

export { SdkAdapter };
