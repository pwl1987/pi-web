// 插件总开关（全局启停）API。
//
// GET  /api/plugins/master            → 读取总开关当前状态 { enabled }
// PUT  /api/plugins/master            → 切换总开关 { enabled, cwd }
//
// 关闭时：把 settings.json 中每个「非核心」插件包标记为禁用（复用与单插件
// disable 完全相同的 SDK 机制，使 agent 运行时不再加载它们的 extension/skill/
// prompt/theme，从而彻底停止插件的后台运行与 token 消耗），并快照各插件关闭
// 前的禁用状态以便恢复。
// 开启时：按快照原样恢复每个插件的禁用状态，并触发缺失插件的后台安装。
//
// 注意：agent 运行时在会话启动时读取 settings.json 决定加载哪些插件，因此
// 切换后需重新加载会话（面板内的「重新加载会话」）才能对正在运行的会话生效；
// 新会话则自动应用最新设置。

import { NextResponse } from "next/server";
import { getPiAdapter } from "@/lib/pi";
import { ALL_PLUGINS, DEFAULT_PLUGINS } from "@/lib/recommended-plugins";
import { getDisabledPackages, keyFor, setPackageDisabled } from "@/lib/plugin-disable";
import { readPluginMasterState, writePluginMasterState } from "@/lib/plugin-master-switch";
import { ensureRecommendedPlugins, resetAutoInstall } from "@/lib/plugin-auto-install";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

// 关闭总开关时跳过的「核心」插件：它们是 pi-web 关键 UI（子代理、Todo）的硬
// 依赖，禁用会导致功能损坏。其余可选增强插件（含 context-mode / pi-rtk /
// cc-safety-net 等固定插件，注释明确「仍可禁用」）都会被总开关一并停用。
const CORE_PLUGINS = new Set(DEFAULT_PLUGINS.map((p) => p.source));
const OPTIONAL_PLUGINS = ALL_PLUGINS.filter((p) => !CORE_PLUGINS.has(p.source));

// GET /api/plugins/master
export async function GET() {
  try {
    return NextResponse.json({ enabled: readPluginMasterState().enabled });
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/plugins/master  body: { enabled: boolean, cwd: string }
export async function PUT(req: Request) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const [body, parseError] = await safeJsonBody<{ enabled?: boolean; cwd?: string }>(req);
    if (parseError) return parseError;
    if (typeof body.enabled !== "boolean") return errorResponse("enabled required", 400);
    if (!body.cwd) return errorResponse("cwd required", 400);

    const { SettingsManager, getAgentDir } = getPiAdapter();
    const settingsManager = SettingsManager.create(body.cwd, getAgentDir());
    const state = readPluginMasterState();

    if (!body.enabled) {
      // 关闭：先快照各可选插件当前禁用状态，再统一禁用。
      const disabledByPackage = getDisabledPackages(settingsManager);
      const snapshot: Record<string, boolean> = {};
      for (const p of OPTIONAL_PLUGINS) {
        const k = keyFor(p.source, "global");
        snapshot[k] = disabledByPackage.get(k) ?? false;
        setPackageDisabled(settingsManager, p.source, "global", true);
      }
      await settingsManager.flush();
      state.snapshot = snapshot;
      state.enabled = false;
      writePluginMasterState(state);
    } else {
      // 开启：按快照恢复单个插件的禁用状态（未记录的新装插件保持启用）。
      for (const [k, wasDisabled] of Object.entries(state.snapshot)) {
        const source = k.split("\0")[1];
        if (source) setPackageDisabled(settingsManager, source, "global", wasDisabled);
      }
      await settingsManager.flush();
      state.snapshot = {};
      state.enabled = true;
      writePluginMasterState(state);
      // 重新开启后补全缺失插件（会发起网络安装请求）。清空缓存锁，确保启动时
      // 因总开关关闭而缓存的 skipped 结果不会让本次安装被短路。
      resetAutoInstall();
      void ensureRecommendedPlugins();
    }

    return NextResponse.json({ enabled: state.enabled });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }
}
