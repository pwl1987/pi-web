// Workaround for a bug in @earendil-works/pi-coding-agent's DefaultPackageManager.
//
// installNpm installs extension packages with `--legacy-peer-deps`, because pi
// extensions declare @earendil-works/pi-* peers that must NOT be resolved (resolving
// them would pull a second, conflicting copy of the SDK). uninstallNpm, however,
// omits that flag. `npm uninstall` re-resolves the entire dependency tree, so without
// the flag it hits ERESOLVE peer-dependency conflicts and exits with code 1 — which
// surfaces to the UI as:
//   "npm uninstall @scope/pkg --prefix <dir> failed with code 1"
//
// This module patches the prototype (once, idempotently) to mirror the install flags
// onto the uninstall command. It must only be imported from server code (app/api/** or
// lib/rpc-manager.ts), never from the client bundle.

import { existsSync } from "fs";
import { getPiAdapter } from "./pi";

interface NpmSourceLike {
  name?: string;
}

let patched = false;

export function patchPackageManagerForUninstall(): void {
  if (patched) return;
  patched = true;

  const proto = getPiAdapter().codingAgent.DefaultPackageManager.prototype as unknown as Record<
    string,
    unknown
  >;
  const original = proto.uninstallNpm as
    ((source: unknown, scope: string) => Promise<void>) | undefined;
  if (typeof original !== "function") return;

  proto.uninstallNpm = async function (source: unknown, scope: string): Promise<void> {
    const self = this as unknown as {
      getNpmInstallRoot(scope: string, temporary: boolean): string;
      getPackageManagerName(): string;
      runNpmCommand(args: string[], options?: unknown): Promise<void>;
    };

    const installRoot = self.getNpmInstallRoot(scope, false);
    if (!existsSync(installRoot)) return;

    const name = (source as NpmSourceLike).name;
    if (!name) {
      // Fall back to the original behavior for unexpected shapes.
      await original.call(this, source, scope);
      return;
    }

    if (self.getPackageManagerName() === "bun") {
      await self.runNpmCommand(["uninstall", name, "--cwd", installRoot, "--legacy-peer-deps"]);
      return;
    }

    await self.runNpmCommand(["uninstall", name, "--prefix", installRoot, "--legacy-peer-deps"]);
  };
}
