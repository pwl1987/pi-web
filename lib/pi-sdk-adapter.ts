// ============================================================================
// Pi SDK Anti-Corruption Layer — default adapter
// ============================================================================
//
// THE single runtime import site for `@earendil-works/pi-*`. Every business
// module obtains Pi capabilities via `getPiAdapter()` (see ./pi.ts), which
// returns an instance of this class. Swapping the SDK version, or replacing Pi
// entirely, requires editing ONLY this file.

import * as codingAgent from "@earendil-works/pi-coding-agent";
import * as ai from "@earendil-works/pi-ai";
import * as aiCompat from "@earendil-works/pi-ai/compat";

import type { PiSdkPort, SessionManagerInstancePort, SessionManagerStaticPort } from "./pi-ports";

class SdkAdapter implements PiSdkPort {
  /** Raw SDK namespaces — the controlled gateway for one-off SDK calls. */
  readonly codingAgent = codingAgent;
  readonly ai = ai;
  readonly aiCompat = aiCompat;

  /** Agent data directory. */
  get agentDir(): string {
    return codingAgent.getAgentDir();
  }

  // --- Type-safe behavioral seams ------------------------------------------

  readonly sessionManager: SessionManagerStaticPort = {
    open: (filePath: string, sessionDir?: string): SessionManagerInstancePort =>
      codingAgent.SessionManager.open(
        filePath,
        sessionDir,
      ) as unknown as SessionManagerInstancePort,
    create: (cwd: string, sessionDir?: string): SessionManagerInstancePort =>
      codingAgent.SessionManager.create(cwd, sessionDir) as unknown as SessionManagerInstancePort,
    listAll: (): Promise<unknown[]> => codingAgent.SessionManager.listAll(),
  };

  createAgentSessionServices =
    codingAgent.createAgentSessionServices as unknown as PiSdkPort["createAgentSessionServices"];

  createAgentSessionFromServices =
    codingAgent.createAgentSessionFromServices as unknown as PiSdkPort["createAgentSessionFromServices"];

  buildSessionContext =
    codingAgent.buildSessionContext as unknown as PiSdkPort["buildSessionContext"];
}

export { SdkAdapter };
