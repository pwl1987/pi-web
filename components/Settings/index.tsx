/**
 * Settings 入口 — 三面板编排占位。
 * 当前 P1 阶段由 components/SettingsPanel.tsx 主导；本组件作为未来拆分后的统一入口。
 */

"use client";

import { P1General } from "./P1General";
import { P1BuiltinPlugins } from "./P1BuiltinPlugins";
import { P2Advanced } from "./P2Advanced";

interface SettingsIndexProps {
  /** 当前显示的内置插件 pluginId；P1 通常由 url 参数注入。 */
  activePluginId?: string;
}

export function SettingsIndex({ activePluginId }: SettingsIndexProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
      <P1General />
      {activePluginId && <P1BuiltinPlugins pluginId={activePluginId} />}
      <P2Advanced />
    </div>
  );
}

export { P1General, P1BuiltinPlugins, P2Advanced };
