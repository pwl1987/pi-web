// 插件总开关（全局启停）持久化层。
//
// 该模块只负责把「总开关状态 + 关闭前各插件禁用快照」落盘到 agent-dir 的
// 侧车文件 `pi-web-plugin-master.json`，不依赖任何 SDK。真正的「停/启」动作
// （禁用/恢复各插件包、跳过后台安装）由调用方（app/api/plugins/master、
// lib/plugin-auto-install）根据这里读到的状态执行。
//
// 设计要点：
// - 默认 enabled = true，保证升级/新装用户行为与现状一致（插件正常运行）。
// - 关闭时会把每个非核心插件「当前是否禁用」记进 snapshot，重新开启时原样
//   恢复，避免覆盖用户此前对单个插件做的个性化启用/禁用选择。
// - 状态同时缓存在 globalThis，跨热重载存活，避免每次都读盘。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@/lib/config-file";

const STATE_FILE = "pi-web-plugin-master.json";

export interface PluginMasterState {
  /** 总开关：true = 插件正常运行；false = 已关闭以节省 token。 */
  enabled: boolean;
  /**
   * 关闭总开关前，每个可选插件当时的禁用状态快照，键为 `${scope}\0${source}`。
   * 重新开启时据此把单个插件的启用/禁用恢复成用户之前的设置。
   */
  snapshot: Record<string, boolean>;
}

declare global {
  var __piPluginMasterState: PluginMasterState | undefined;
}

function defaultState(): PluginMasterState {
  return { enabled: true, snapshot: {} };
}

function statePath(): string {
  return join(getAgentDir(), STATE_FILE);
}

export function readPluginMasterState(): PluginMasterState {
  if (globalThis.__piPluginMasterState) return globalThis.__piPluginMasterState;
  try {
    if (!existsSync(statePath())) {
      globalThis.__piPluginMasterState = defaultState();
      return globalThis.__piPluginMasterState;
    }
    const parsed = JSON.parse(readFileSync(statePath(), "utf8")) as Partial<PluginMasterState>;
    const state: PluginMasterState = {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
      snapshot: parsed.snapshot && typeof parsed.snapshot === "object" ? parsed.snapshot : {},
    };
    globalThis.__piPluginMasterState = state;
    return state;
  } catch {
    globalThis.__piPluginMasterState = defaultState();
    return globalThis.__piPluginMasterState;
  }
}

export function writePluginMasterState(state: PluginMasterState): void {
  globalThis.__piPluginMasterState = state;
  const dir = getAgentDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf8");
}

/** 便捷读取：插件子系统当前是否启用。 */
export function getPluginsMasterEnabled(): boolean {
  return readPluginMasterState().enabled;
}
