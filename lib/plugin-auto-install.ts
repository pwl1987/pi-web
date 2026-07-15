// Auto-install recommended plugins on server startup.
//
// Called fire-and-forget from ensureRegistryInitialized() in rpc-manager.ts.
// Uses pi's DefaultPackageManager to install missing packages. Failures are
// non-fatal — the app still starts. Results are cached in globalThis so the
// /api/plugins/recommended route can report status.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ALL_PLUGINS } from "./recommended-plugins";
import { getPiAdapter } from "./pi";
import { getPluginsMasterEnabled } from "./plugin-master-switch";

export interface PluginInstallResult {
  source: string;
  name: string;
  status: "installed" | "already" | "failed" | "skipped";
  error?: string;
}

declare global {
  var __piAutoInstallResults: PluginInstallResult[] | undefined;

  var __piAutoInstallLock: Promise<PluginInstallResult[]> | undefined;
}

/**
 * 清空自动安装缓存与锁。总开关从「关闭」切回「开启」时调用，使
 * ensureRecommendedPlugins() 能重新执行真正的缺失插件安装（否则会命中启动时
 * 因总开关关闭而缓存的 skipped 结果）。
 */
export function resetAutoInstall(): void {
  globalThis.__piAutoInstallResults = undefined;
  globalThis.__piAutoInstallLock = undefined;
}

/** Read the configured packages list from settings.json. */
export function getConfiguredPackages(): Set<string> {
  try {
    const settingsPath = join(getPiAdapter().getAgentDir(), "settings.json");
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
    // 总开关关闭时彻底跳过后台安装——不发起任何网络/安装请求，直接返回。
    if (!getPluginsMasterEnabled()) {
      const skipped = ALL_PLUGINS.map((p) => ({
        source: p.source,
        name: p.name,
        status: "skipped" as const,
      }));
      globalThis.__piAutoInstallResults = skipped;
      return skipped;
    }

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
    const adapter = getPiAdapter();
    const { DefaultPackageManager, SettingsManager, getAgentDir } = adapter;
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
