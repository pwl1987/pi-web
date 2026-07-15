// 插件包「禁用」辅助函数（单包 disable 与全局总开关共用）。
//
// 这些函数直接操作 SDK 的 SettingsManager：把某个包在 settings.json 中的
// extensions/skills/prompts/themes 资源数组清空即视为「禁用」。agent 运行时
// 据此不再加载该包的任何资源，从而停止其后台运行与 token 消耗。该机制与单包
// disable 动作完全一致，全局总开关在此之上做批量禁用/恢复。

import type { PackageSource, SdkSettingsManager } from "@/lib/pi";

export type PluginScopeLike = "global" | "project";

export function keyFor(source: string, scope: PluginScopeLike): string {
  return `${scope}\0${source}`;
}

export function getPackageSource(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

function isDisabledPackage(entry: PackageSource): boolean {
  if (typeof entry === "string") return false;
  return (
    Array.isArray(entry.extensions) &&
    entry.extensions.length === 0 &&
    Array.isArray(entry.skills) &&
    entry.skills.length === 0 &&
    Array.isArray(entry.prompts) &&
    entry.prompts.length === 0 &&
    Array.isArray(entry.themes) &&
    entry.themes.length === 0
  );
}

export function getDisabledPackages(settingsManager: SdkSettingsManager): Map<string, boolean> {
  const disabled = new Map<string, boolean>();
  for (const entry of settingsManager.getGlobalSettings().packages ?? []) {
    disabled.set(keyFor(getPackageSource(entry), "global"), isDisabledPackage(entry));
  }
  for (const entry of settingsManager.getProjectSettings().packages ?? []) {
    disabled.set(keyFor(getPackageSource(entry), "project"), isDisabledPackage(entry));
  }
  return disabled;
}

export function setPackageDisabled(
  settingsManager: SdkSettingsManager,
  source: string,
  scope: PluginScopeLike,
  disabled: boolean,
): boolean {
  const current =
    scope === "project"
      ? (settingsManager.getProjectSettings().packages ?? [])
      : (settingsManager.getGlobalSettings().packages ?? []);
  let changed = false;
  const next = current.map((entry): PackageSource => {
    if (getPackageSource(entry) !== source) return entry;
    changed = true;
    if (disabled) {
      return {
        ...(typeof entry === "string" ? { source: entry } : entry),
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
      };
    }
    return getPackageSource(entry);
  });
  if (!changed) return false;
  if (scope === "project") settingsManager.setProjectPackages(next);
  else settingsManager.setPackages(next);
  return true;
}
