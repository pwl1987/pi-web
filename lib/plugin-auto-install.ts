// Auto-install recommended plugins on server startup.
//
// Called fire-and-forget from ensureRegistryInitialized() in rpc-manager.ts.
// Uses pi's DefaultPackageManager to install missing packages. Failures are
// non-fatal — the app still starts. Results are cached in globalThis so the
// /api/plugins/recommended route can report status.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ALL_PLUGINS } from "./recommended-plugins";
import { getAgentDir } from "./config-file";
import { getPiAdapter } from "./pi";

export interface PluginInstallResult {
  source: string;
  name: string;
  status: "installed" | "already" | "failed";
  error?: string;
}

declare global {
  var __piAutoInstallResults: PluginInstallResult[] | undefined;

  var __piAutoInstallLock: Promise<PluginInstallResult[]> | undefined;
}

/** Read the configured packages list from settings.json. */
export function getConfiguredPackages(): Set<string> {
  try {
    const settingsPath = join(getAgentDir(), "settings.json");
    if (!existsSync(settingsPath)) return new Set();
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: string[] };
    return new Set(settings.packages ?? []);
  } catch {
    return new Set();
  }
}

/**
 * Check which recommended plugins are missing and install them.
 * Fire-and-forget safe. Uses a globalThis lock to prevent concurrent runs.
 */
export async function ensureRecommendedPlugins(): Promise<PluginInstallResult[]> {
  if (globalThis.__piAutoInstallLock) {
    return globalThis.__piAutoInstallLock;
  }

  globalThis.__piAutoInstallLock = (async (): Promise<PluginInstallResult[]> => {
    const configured = getConfiguredPackages();
    const results: PluginInstallResult[] = [];
    const missing = ALL_PLUGINS.filter((p) => !configured.has(p.source));

    // All already installed — cache and return.
    if (missing.length === 0) {
      results.push(
        ...ALL_PLUGINS.map((p) => ({
          source: p.source,
          name: p.name,
          status: "already" as const,
        })),
      );
      globalThis.__piAutoInstallResults = results;
      return results;
    }

    // Obtain the SDK through the ACL (single import site). The adapter is
    // constructed lazily on first use and already loads the SDK once.
    const { DefaultPackageManager, SettingsManager } = getPiAdapter().codingAgent;
    const { patchPackageManagerForUninstall } = await import("@/lib/plugin-package-manager");
    patchPackageManagerForUninstall();

    // Use the repo root as cwd (process.cwd() is the pi-web root in both dev and prod).
    const cwd = process.cwd();
    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });

    for (const plugin of ALL_PLUGINS) {
      if (configured.has(plugin.source)) {
        results.push({ source: plugin.source, name: plugin.name, status: "already" });
        continue;
      }
      try {
        await packageManager.installAndPersist(plugin.source, { local: false });
        results.push({ source: plugin.source, name: plugin.name, status: "installed" });
      } catch (e) {
        results.push({
          source: plugin.source,
          name: plugin.name,
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    globalThis.__piAutoInstallResults = results;
    return results;
  })();

  return globalThis.__piAutoInstallLock;
}

/** Return cached install results (or null if not run yet). */
export function getAutoInstallStatus(): PluginInstallResult[] | null {
  return globalThis.__piAutoInstallResults ?? null;
}
