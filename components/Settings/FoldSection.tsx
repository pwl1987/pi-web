/**
 * FoldSection — P1.1/P1.2/P1.3 折叠容器。
 * ponytail: 用原生 <details> 实现，无第三方依赖；UI 风格复用 var(--*) 主题变量。
 */

"use client";

import { type ReactNode, useState, useEffect } from "react";
import { useI18n } from "@/hooks/useI18n";

export type FoldGroup = "common" | "advanced" | "experimental";

interface FoldSectionProps {
  titleKey: string;
  defaultOpen: boolean;
  children: ReactNode;
}

/** 内部 key → settings.group.{name} 的 i18n 实际查询 key。 */
function resolveTitleKey(titleKey: string, group: FoldGroup): string {
  // ponytail: titleKey 形如 "settings.${pluginId}.group.${group}" 模式，
  //   但目前 i18n dictionary 只实现了 settings.group.{common|advanced|experimental}。
  //   简化处理：只取最后一段 group 名查通用 i18n。
  const map: Record<FoldGroup, string> = {
    common: "settings.group.common",
    advanced: "settings.group.advanced",
    experimental: "settings.group.experimental",
  };
  void titleKey;
  return map[group];
}

export function FoldSection({ titleKey, defaultOpen, children }: FoldSectionProps) {
  const { t } = useI18n();
  // ponytail: SSR 不一致 → 客户端挂载后才允许交互
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [open, setOpen] = useState(defaultOpen);
  const group = titleKey.endsWith(".common")
    ? "common"
    : titleKey.endsWith(".advanced")
      ? "advanced"
      : "experimental";
  const i18nTitle = resolveTitleKey(titleKey, group);
  void i18nTitle;
  // 简化：直接用 group 名称查 i18n
  const title = t(
    group === "common"
      ? "settings.group.common"
      : group === "advanced"
        ? "settings.group.advanced"
        : "settings.group.experimental",
  );
  return (
    <details
      open={mounted ? open : defaultOpen}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontWeight: 600,
          fontSize: 12,
          color: "var(--text)",
          userSelect: "none",
        }}
      >
        {title}
      </summary>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </details>
  );
}
