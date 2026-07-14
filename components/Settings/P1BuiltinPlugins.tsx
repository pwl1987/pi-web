/**
 * P1BuiltinPlugins — 内置插件设置面板（P1.1/P1.2/P1.3 三档折叠）。
 * 当前 allSchemas 为空时显示提示占位，由 Step 4.6 阶段从 lib/plugin-config-descriptors.ts 迁移填充。
 */

"use client";

import { useMemo } from "react";
import { useSettings } from "@/hooks/useSettings";
import { getSchema } from "@/lib/config-schema";
import { FieldRenderer } from "./fields/FieldRenderer";
import { FoldSection } from "./FoldSection";
import { useI18n } from "@/hooks/useI18n";

interface P1BuiltinPluginsProps {
  pluginId: string;
}

export function P1BuiltinPlugins({ pluginId }: P1BuiltinPluginsProps) {
  const { settings, setValue, setEnabled, getUnrecognizedFields } = useSettings(pluginId);
  const schema = getSchema(pluginId);
  const { t } = useI18n();

  const groups = useMemo(() => {
    if (!schema) return { common: [], advanced: [], experimental: [] };
    return {
      common: schema.fields.filter((f) => (f.group ?? "common") === "common"),
      advanced: schema.fields.filter((f) => f.group === "advanced"),
      experimental: schema.fields.filter((f) => f.group === "experimental"),
    };
  }, [schema]);

  if (!schema) {
    return (
      <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12 }}>
        未注册的插件 schema：{pluginId}（等待 Step 4.6 迁移）
      </div>
    );
  }

  const unknownKeys = Object.keys(getUnrecognizedFields());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {schema.enabled && (
        <FieldRenderer
          field={schema.enabled}
          value={settings.enabled ?? schema.enabled.default}
          onChange={(v) => setEnabled(Boolean(v))}
        />
      )}
      {groups.common.length > 0 && (
        <FoldSection titleKey="settings.${pluginId}.group.common" defaultOpen>
          {groups.common.map((f) => (
            <FieldRenderer
              key={f.key}
              field={f}
              value={settings.values[f.key]}
              onChange={(v) => setValue(f.key, v)}
            />
          ))}
        </FoldSection>
      )}
      {groups.advanced.length > 0 && (
        <FoldSection titleKey="settings.${pluginId}.group.advanced" defaultOpen={false}>
          {groups.advanced.map((f) => (
            <FieldRenderer
              key={f.key}
              field={f}
              value={settings.values[f.key]}
              onChange={(v) => setValue(f.key, v)}
            />
          ))}
        </FoldSection>
      )}
      {groups.experimental.length > 0 && (
        <FoldSection titleKey="settings.${pluginId}.group.experimental" defaultOpen={false}>
          {groups.experimental.map((f) => (
            <FieldRenderer
              key={f.key}
              field={f}
              value={settings.values[f.key]}
              onChange={(v) => setValue(f.key, v)}
            />
          ))}
        </FoldSection>
      )}
      {unknownKeys.length > 0 && (
        <div
          style={{
            border: "1px solid var(--color-warning, #d97706)",
            background: "var(--color-warning-soft, rgba(217,119,6,0.08))",
            color: "var(--text)",
            borderRadius: 6,
            padding: 8,
            fontSize: 12,
          }}
        >
          ⚠ {t("settings.unrecognizedBanner", { count: unknownKeys.length })}
        </div>
      )}
    </div>
  );
}
