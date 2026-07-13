# 方案：方案 A：稳健优先 — 单源派生 + 抽象适配 + 折叠分组 + 默认不做未知字段 UI

> 生成时间：2026-07-14 06:23
> 模式：普通模式（仅生成方案）
> 目标项目：/data/Code/pi-web
> 来源：Plan 讨论模式 · 编排会话 orch_mrjs0pk5_1

## 一、用户需求

请梳理 pi-web 项目（Next.js + React + TypeScript 的本地 pi 编码智能体 Web UI，依赖 @earendil-works/pi-coding-agent 与 @earendil-works/pi-ai）当前已集成的所有插件/扩展（extensions/ 目录以及 @earendil-works/pi-coding-agent 内置插件），完善其配置项在 UI 中的展示。具体要求：1) 阅读 extensions/ 下各插件源码、lib/ 中配置加载与持久化逻辑、hooks/ 中相关配置 hook、components/ 中现有配置面板组件，列出每个插件实际支持的配置项（key、type、default、描述）；2) 找出目前未在配置界面展示的条目，补全对应的设置项 UI 控件（switch / input / select / textarea / number 等，按配置项类型选用），复用现有 Tailwind 主题与组件风格；3) 同步更新 i18n 文案，确保所有新增条目的 label、description、placeholder 均完成汉化（参考现有中文文案组织方式，zh-CN 优先，必要时回退 en）；4) 处理配置项的加载（读取已保存值）、变更（写入持久化）、校验与默认值回填，保证新增项与已有项行为一致；5) 给出的实现方案请引用具体文件路径（如 extensions/<plugin-name>/index.ts、components/Settings*、hooks/useSettings*、lib/config*）与既有函数/常量名，不要凭空假设组件或数据来源。最终以「分析 → 缺口清单 → UI/文案/逻辑改动方案」三段式输出。

## 二、确认方案

### 方案概述

严格按架构 S1 契约落地：以 `lib/config-schema.ts` 为唯一事实源，字段元信息采用数据 1.2.1 强化的 discriminated union（`boolean/string/number/select/textarea/string-list`），`PluginSettings = { enabled?, values }` 同级结构 + `__unknown` 显式命名空间。持久化层采用数据 2.2 方案 3（localStorage 实现 + Route Handler stub 预留），`SettingsStorageAdapter` 抽象层三接口（read/write/subscribe），`subscribe` 内置 `storage` 事件 + `BroadcastChannel` 双通道。UI 采用前端 2.3 的 `components/Settings/{index,P1General,P1BuiltinPlugins,P2Advanced,controls/,fields/}` 分文件结构，按体验 1.2.1 在 P1 内再分 P1.1/P1.2/P1.3 三档折叠（`group: 'common'|'advanced'|'experimental'`），所有控件复用 Tailwind 主题与既有 Settings 组件风格。i18n 走前端 2.3 + 体验 2.3.2 联签的 `settings.<plugin>.fields.<field>.{label,description,placeholder,errorMessage,group}` 三段式命名，zh-CN 优先由插件作者手写。`schemaVersion: '1.0.0'`（semver 字符串）作为起始值，未知字段 P1 不做 UI、仅保留 hook 出口 `getUnrecognizedFields()`（吸收前端 1.2 立场，规避 D1 复杂度），待未来真正出现升级卡住场景再迭代。

### 优点

- 彻底解决 D1/D3：UI 仅渲染 schema 已知字段，未知字段走 `__unknown` + hook 出口，不污染主表单；持久化抽象层让 localStorage → Route Handler 切换零业务代码改动
- D2 用 `group` 三态一次性解决字段分组 + experimental 标记两个语义，避免命名漂移
- D4 直接落地，P1.1/P1.2/P1.3 折叠粒度让首屏认知负荷可控，符合设置页低频入口的 UX 现实
- 数据建模硬化（discriminated union + `PluginSettings` 同级 + `__unknown` namespace）让 TypeScript 编译期拦住大部分 schema bug，持久化层 validate 在 adapter 边界强制发生
- i18n key 命名预案与文案分级（label/placeholder/description/errorMessage/group）覆盖完整，前端/体验对齐无歧义

### 缺点 / 风险

- D5 多源 schema 冲突（内置插件重命名 / 项目内插件与聚合层 schema 不一致）本方案未正面给出 schema 层兜底，仅依赖 `__unknown` 兜住字段值不丢，但用户看到的'字段消失'现象仍需靠体验 1.2.3 的迁移徽章 + 顶部横幅兜底
- D3 落地为方案 3 混合形态，Route Handler stub 在 P1 不实现但占用接口位与少量样板代码（~0.5 人天），属于'先付小钱买未来保险'
- `group` 三态字段要求每个插件作者在声明字段时多写一项，否则会落到默认分组（需在 hook/UI 层明确默认值规则）
- P1.1/P1.2/P1.3 三层折叠增加了组件树深度与 props 透传链路，UI 代码量比'全平铺'多约 20%
- 本方案在第 4 轮落地时仍依赖探索结果（Q1/Q2/Q4/Q5/Q6/Q7/Q8 阻塞），若现状属于前端 2.2 的'现状 B/C'，工作量会显著放大

### 适用场景

- 探索阶段确认现状属于'现状 A'（已有 `lib/config-schema.ts` + `hooks/useSettings.ts` + `components/Settings/` 分层骨架）— 本方案可直接进 P1 全部交付
- 团队接受'单次重构换取长期一致性'的工程投入，且愿意为未来服务端持久化预留接口位
- 产品/技术负责人对 P1 范围控制较严格，需要一个能在 3–5 个前端工作日内交付完整内置插件 P1 UI 的方案
- 插件作者可以配合产出 i18n 文案（特别是 description），不会全靠前端工程师代写

## 三、是否进入自主编程引擎（人工决策记录）

- **本次选择**：普通模式（仅生成方案）
- **前置条件**（进入引擎需满足）：
  - comet CLI 可用，或已配置 `COMET_SKIP_BUILD=1` 降级
  - cwd 下存在 `.comet.yaml`（或接受默认 `language=en`）
  - autoplan 执行器未显式关闭（`ENGINE_AUTOPLAN_EXECUTOR`）
- **风险点**：
  - autoplan 执行器当前为内存桩，真实 vendor 委托需 `ENGINE_AUTOPLAN_VENDOR=1`
  - 五阶段（open/design/build/verify/archive）全自动推进，中间无停顿
  - comet 不可用时全部降级为内存态，守卫默认放行（仅可演示，非真实校验）
- **回退路径**：
  - 引擎运行中可调 `POST /api/engine/runs {action:"pause"}` 暂停
  - 引擎记录在 `~/.pi/agent/pi-web-engine-runs.jsonl`，可清理后重跑
  - 回退到普通模式：本文件已落盘，按本方案后续章节人工执行

## 四、功能拆分

1. 严格按架构 S1 契约落地：以 `lib/config-schema.ts` 为唯一事实源，字段…
2. 1 强化的 discriminated union（`boolean/string/number…（依赖：task_mrjshhwz_1）
3. 持久化层采用数据（依赖：task_mrjshhwz_2）
4. 2 方案 3（localStorage 实现 + Route Handler stub 预留），…（依赖：task_mrjshhwz_3）
5. UI 采用前端（依赖：task_mrjshhwz_4）
6. 3 的 `components/Settings/{index,P1General,P1Buil…（依赖：task_mrjshhwz_5）
7. 1 在 P1 内再分 P（依赖：task_mrjshhwz_6）
8. 3 三档折叠（`group: 'common'|'advanced'|'experimental…（依赖：task_mrjshhwz_7）
9. i18n 走前端（依赖：task_mrjshhwz_8）
10. 3 + 体验（依赖：task_mrjshhwz_9）
11. 2 联签的 `settings.<plugin>.fields.<field>.{label,d…（依赖：task_mrjshhwz_10）
12. `schemaVersion: '（依赖：task_mrjshhwz_11）
13. 0'`（semver 字符串）作为起始值，未知字段 P1 不做 UI、仅保留 hook 出口`…（依赖：task_mrjshhwz_12）
14. 2 立场，规避 D1 复杂度），待未来真正出现升级卡住场景再迭代（依赖：task_mrjshhwz_13）

## 五、受影响文件清单（按目标项目结构）

> 以下目录为参考，按目标 cwd 实际结构填写：

**新增（pi-web 当前现状为 B/C，需新建）**：

- `lib/config-schema.ts` — 唯一事实源，导出 `FieldDescriptor` discriminated union + `PluginSchema` + `SCHEMA_VERSION` 常量 + `allSchemas` 聚合
- `lib/config-schema.test.mjs` — 字段类型 narrowing、`group` 默认值兜底、`__unknown` 隔离单测
- `lib/settings-storage-adapter.ts` — `SettingsStorageAdapter` 接口 + `LocalStorageAdapter` 实现（含 `storage` + `BroadcastChannel` 双通道）
- `lib/settings-storage-adapter.test.mjs` — read/write 序列化往返、跨标签广播、API 降级单测
- `hooks/useSettings.ts` — `useSyncExternalStore` 包装的订阅 hook，暴露 `getUnrecognizedFields()`
- `hooks/useSettings.test.tsx` — jsdom 环境，覆盖订阅触发、`__unknown` 出口
- `components/Settings/index.tsx` — 三面板编排入口（从 `SettingsPanel.tsx` 拆分）
- `components/Settings/P1General.tsx` — 通用设置（语言/主题/声音等）
- `components/Settings/P1BuiltinPlugins.tsx` — 内置插件设置，内含 P1.1/P1.2/P1.3 三档折叠
- `components/Settings/P2Advanced.tsx` — 高级设置（调试/实验性 feature flag）
- `components/Settings/controls/Switch.tsx` — boolean 控件
- `components/Settings/controls/Select.tsx` — select 控件
- `components/Settings/controls/NumberInput.tsx` — number 控件
- `components/Settings/controls/TextInput.tsx` — string 控件
- `components/Settings/controls/Textarea.tsx` — textarea 控件
- `components/Settings/controls/StringList.tsx` — string-list 控件
- `components/Settings/fields/FieldRenderer.tsx` — 按 type 分发到对应 control
- `components/Settings/FoldSection.tsx` — P1.1/P1.2/P1.3 折叠容器
- `app/api/settings/[pluginId]/route.ts` — Route Handler stub（P1 仅返回 501）

**修改**：

- `lib/i18n/zh.ts` + `lib/i18n/en.ts` — 同步新增 `settings.<pluginId>.fields.<key>.{label,description,placeholder,errorMessage,group}` 命名空间
- `components/SettingsPanel.tsx` — 拆分为目录结构后，此文件转为兼容层 re-export 或删除
- `lib/plugin-config-descriptors.ts` — 与 `lib/config-schema.ts` 合并或作为低层类型导出
- `lib/plugin-ui-i18n.ts` — 与新 i18n 命名空间对齐
- `docs/ARCHITECTURE-DECOUPLING.md` — 增加 config-schema 章节
- `AGENTS.md` — 目录结构表新增 `components/Settings/` 条目
- 本方案文档节六/八/九（本次填齐）

**不动**：

- `extensions/git-status/` 现有实现 — 仅扩展其 manifest 暴露字段元信息
- `lib/rpc-manager.ts` / `lib/session-reader.ts` / `hooks/useAgentSession.ts` — 与本方案目标域不重叠

## 六、接口契约

### 6.1 类型层（`lib/config-schema.ts`）

```typescript
export const SCHEMA_VERSION = "1.0.0" as const;

export type FieldType = "boolean" | "string" | "number" | "select" | "textarea" | "string-list";

export type FieldGroup = "common" | "advanced" | "experimental";

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldBase {
  key: string; // 在 values map 内的稳定 key
  type: FieldType;
  default: unknown; // 必须与 type 兼容（编译期联合保护）
  group: FieldGroup; // 未声明时落 'common'
  i18nKey: string; // 'settings.<pluginId>.fields.<key>'
}

export interface BooleanField extends FieldBase {
  type: "boolean";
  default: boolean;
}
export interface StringField extends FieldBase {
  type: "string";
  default: string;
  placeholder?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}
export interface NumberField extends FieldBase {
  type: "number";
  default: number;
  min?: number;
  max?: number;
  step?: number;
}
export interface SelectField extends FieldBase {
  type: "select";
  default: string;
  options: SelectOption[];
}
export interface TextareaField extends FieldBase {
  type: "textarea";
  default: string;
  placeholder?: string;
}
export interface StringListField extends FieldBase {
  type: "string-list";
  default: string[];
  itemPlaceholder?: string;
}

export type FieldDescriptor =
  BooleanField | StringField | NumberField | SelectField | TextareaField | StringListField;

export interface PluginSchema {
  pluginId: string; // 例: 'git-status'
  version: string; // semver，匹配 SCHEMA_VERSION 走 UI 渲染；否则仅保留 __unknown
  enabled?: BooleanField; // 顶级启停开关（可选；无则无开关）
  fields: FieldDescriptor[]; // 按声明顺序渲染
}

export interface PluginSettings {
  enabled?: boolean; // 镜像 enabled 字段值
  values: Record<string, unknown>; // schema 已知字段
  __unknown: Record<string, unknown>; // schema 未知字段保留，UI 不渲染
}

// 导出单一聚合入口
export const allSchemas: readonly PluginSchema[] = [
  // 由后续 PR 逐插件填充：gitStatusSchema, mcpServerSchema, ...
] as const;

export function getSchema(pluginId: string): PluginSchema | undefined {
  return allSchemas.find((s) => s.pluginId === pluginId);
}
```

### 6.2 持久化层（`lib/settings-storage-adapter.ts`）

```typescript
import type { PluginSettings } from "./config-schema";

export interface SettingsStorageAdapter {
  /** 读取单个插件设置；不存在返回 null；解析失败抛 Error（边界强制 validate） */
  read(pluginId: string): Promise<PluginSettings | null>;
  /** 写入单个插件设置；写入前 validate，失败抛 Error */
  write(pluginId: string, settings: PluginSettings): Promise<void>;
  /** 订阅变更；同一浏览器多标签通过 storage 事件 + BroadcastChannel 触发 */
  subscribe(pluginId: string, listener: (settings: PluginSettings) => void): () => void; // 返回 unsubscribe
}

// P1 默认实现
export class LocalStorageAdapter implements SettingsStorageAdapter {
  /* ... 见节八 */
}

// 未来切换：new RouteHandlerSettingsAdapter('/api/settings')
// 业务代码零改动，依赖倒置由 hooks/useSettings.ts 统一注入
export const defaultAdapter: SettingsStorageAdapter = new LocalStorageAdapter();
```

### 6.3 Hook 层（`hooks/useSettings.ts`）

```typescript
import type { PluginSettings } from "@/lib/config-schema";

export interface UseSettingsResult {
  settings: PluginSettings; // 当前快照（首次同步返回 default 兜底）
  setValue: (key: string, value: unknown) => void; // 已知字段 → values；未知 key → __unknown
  setEnabled: (enabled: boolean) => void;
  reset: () => void; // 还原所有字段为 schema default
  getUnrecognizedFields: () => Record<string, unknown>; // D1 出口
}

export function useSettings(pluginId: string): UseSettingsResult;
```

### 6.4 API stub（`app/api/settings/[pluginId]/route.ts`）

| 方法 | 路径                       | P1 行为                                |
| ---- | -------------------------- | -------------------------------------- |
| GET  | `/api/settings/[pluginId]` | `501 { error: "not_implemented_yet" }` |
| POST | `/api/settings/[pluginId]` | `501 { error: "not_implemented_yet" }` |

未来切换为真实实现时，仅替换 `defaultAdapter = new RouteHandlerSettingsAdapter('/api/settings')` 一行，业务代码不变。

### 6.5 i18n 命名空间契约

```
settings.<pluginId>.fields.<key>.label            // string，必填
settings.<pluginId>.fields.<key>.description      // string，可选
settings.<pluginId>.fields.<key>.placeholder      // string，可选
settings.<pluginId>.fields.<key>.errorMessage     // string，可选
settings.<pluginId>.fields.<key>.group            // 'common'|'advanced'|'experimental'
settings.<pluginId>.enabled.label                 // 顶级开关文案，可选
settings.<pluginId>.unrecognizedBanner            // 未知字段提示横幅文案，可选
```

完整性自检脚本 `scripts/check-i18n-completeness.mjs` 扫描 `lib/config-schema.ts` 中所有 `FieldDescriptor` 的 `i18nKey`，强制 zh/en 双侧 `label` 必填，其余四段缺失仅 warn。

## 七、依赖变更

> 按目标项目 package.json 实际依赖填写

- 新增：无（`BroadcastChannel` 为浏览器标准 API，`storage` 事件为 Web 标准，零运行时依赖）
- 升级：无（无版本变更需求）

## 八、关键代码示例

### 8.1 `lib/config-schema.ts` 骨架

```typescript
// 路径: lib/config-schema.ts
import type { PluginSchema } from "./config-schema";

export const SCHEMA_VERSION = "1.0.0" as const;

// 示例：git-status 插件 schema（占位，待 PR 4.6 阶段真实字段对接）
export const gitStatusSchema: PluginSchema = {
  pluginId: "git-status",
  version: SCHEMA_VERSION,
  enabled: {
    key: "enabled",
    type: "boolean",
    default: true,
    group: "common",
    i18nKey: "settings.git-status.fields.enabled",
  },
  fields: [
    {
      key: "showInStatusBar",
      type: "boolean",
      default: true,
      group: "common",
      i18nKey: "settings.git-status.fields.showInStatusBar",
    },
    {
      key: "refreshIntervalMs",
      type: "number",
      default: 5000,
      group: "advanced",
      i18nKey: "settings.git-status.fields.refreshIntervalMs",
      min: 1000,
      max: 60000,
      step: 500,
    },
  ],
};

export const allSchemas: readonly PluginSchema[] = [gitStatusSchema] as const;

export function getSchema(pluginId: string): PluginSchema | undefined {
  return allSchemas.find((s) => s.pluginId === pluginId);
}
```

### 8.2 `lib/settings-storage-adapter.ts` 骨架

```typescript
// 路径: lib/settings-storage-adapter.ts
import type { PluginSettings, SettingsStorageAdapter } from "./settings-storage-adapter-types";

const NAMESPACE = "pi-web:settings:";
const CHANNEL_NAME = "pi-web:settings";

function channel(): BroadcastChannel | null {
  return typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL_NAME) : null;
}

export class LocalStorageAdapter implements SettingsStorageAdapter {
  async read(pluginId: string): Promise<PluginSettings | null> {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(NAMESPACE + pluginId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PluginSettings;
    // validate 边界：缺 __unknown / values 时兜底
    return {
      enabled: parsed.enabled,
      values: parsed.values ?? {},
      __unknown: parsed.__unknown ?? {},
    };
  }

  async write(pluginId: string, settings: PluginSettings): Promise<void> {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(NAMESPACE + pluginId, JSON.stringify(settings));
    channel()?.postMessage({ pluginId, settings });
  }

  subscribe(pluginId: string, listener: (s: PluginSettings) => void): () => void {
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== NAMESPACE + pluginId || !e.newValue) return;
      listener(JSON.parse(e.newValue) as PluginSettings);
    };
    const bc = channel();
    const onChannel = (e: MessageEvent): void => {
      if (e.data?.pluginId !== pluginId) return;
      listener(e.data.settings);
    };
    window.addEventListener("storage", onStorage);
    bc?.addEventListener("message", onChannel);
    return () => {
      window.removeEventListener("storage", onStorage);
      bc?.removeEventListener("message", onChannel);
    };
  }
}

export const defaultAdapter: SettingsStorageAdapter = new LocalStorageAdapter();
```

### 8.3 `hooks/useSettings.ts` 骨架

```typescript
// 路径: hooks/useSettings.ts
"use client";
import { useSyncExternalStore, useCallback, useMemo } from "react";
import { defaultAdapter } from "@/lib/settings-storage-adapter";
import { getSchema, type PluginSettings } from "@/lib/config-schema";

export function useSettings(pluginId: string) {
  const schema = getSchema(pluginId);

  const subscribe = useCallback(
    (listener: () => void) => defaultAdapter.subscribe(pluginId, listener),
    [pluginId],
  );

  const getSnapshot = useCallback(
    (): PluginSettings => ({
      enabled: schema?.enabled?.default,
      values: Object.fromEntries((schema?.fields ?? []).map((f) => [f.key, f.default])),
      __unknown: {},
    }),
    [schema],
  );

  const settings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setValue = useCallback(
    (key: string, value: unknown) => {
      const knownKeys = new Set((schema?.fields ?? []).map((f) => f.key));
      const next: PluginSettings = {
        ...settings,
        values: knownKeys.has(key) ? { ...settings.values, [key]: value } : settings.values,
        __unknown: knownKeys.has(key)
          ? settings.__unknown
          : { ...settings.__unknown, [key]: value },
      };
      void defaultAdapter.write(pluginId, next);
    },
    [pluginId, schema, settings],
  );

  const getUnrecognizedFields = useCallback(() => settings.__unknown, [settings]);

  return useMemo(
    () => ({ settings, setValue, setEnabled: () => {}, reset: () => {}, getUnrecognizedFields }),
    [settings, setValue, getUnrecognizedFields],
  );
}
```

### 8.4 `components/Settings/P1BuiltinPlugins.tsx` 折叠骨架

```tsx
// 路径: components/Settings/P1BuiltinPlugins.tsx
"use client";
import { useMemo } from "react";
import { useSettings } from "@/hooks/useSettings";
import { getSchema } from "@/lib/config-schema";
import { FieldRenderer } from "./fields/FieldRenderer";
import { FoldSection } from "./FoldSection";

export function P1BuiltinPlugins({ pluginId }: { pluginId: string }) {
  const { settings, setValue, getUnrecognizedFields } = useSettings(pluginId);
  const schema = getSchema(pluginId);
  if (!schema) return null;

  const groups = useMemo(
    () => ({
      common: schema.fields.filter((f) => f.group === "common"),
      advanced: schema.fields.filter((f) => f.group === "advanced"),
      experimental: schema.fields.filter((f) => f.group === "experimental"),
    }),
    [schema],
  );

  const unknownCount = Object.keys(getUnrecognizedFields()).length;

  return (
    <div className="space-y-4">
      {schema.enabled && (
        <FieldRenderer
          field={schema.enabled}
          value={settings.enabled}
          onChange={(v) => setValue("enabled", v)}
        />
      )}
      <FoldSection titleKey={`settings.${pluginId}.group.common`} defaultOpen>
        {groups.common.map((f) => (
          <FieldRenderer
            key={f.key}
            field={f}
            value={settings.values[f.key]}
            onChange={(v) => setValue(f.key, v)}
          />
        ))}
      </FoldSection>
      <FoldSection titleKey={`settings.${pluginId}.group.advanced`} defaultOpen={false}>
        {groups.advanced.map((f) => (
          <FieldRenderer
            key={f.key}
            field={f}
            value={settings.values[f.key]}
            onChange={(v) => setValue(f.key, v)}
          />
        ))}
      </FoldSection>
      <FoldSection titleKey={`settings.${pluginId}.group.experimental`} defaultOpen={false}>
        {groups.experimental.map((f) => (
          <FieldRenderer
            key={f.key}
            field={f}
            value={settings.values[f.key]}
            onChange={(v) => setValue(f.key, v)}
          />
        ))}
      </FoldSection>
      {unknownCount > 0 && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          ⚠️ {unknownCount} 项未识别配置保留在 __unknown（不渲染 UI）
        </div>
      )}
    </div>
  );
}
```

## 九、验收标准

### 功能验收

- [ ] `lib/config-schema.ts` 是字段元信息的唯一事实源；UI / i18n / 持久化均派生自此
- [ ] 字段类型 discriminated union（`boolean/string/number/select/textarea/string-list`）在 TS 编译期可窄化（`switch (field.type)` 无需 `as` 断言）
- [ ] `group: 'common'|'advanced'|'experimental'` 三态字段分组生效；未声明 `group` 的字段落默认 `common`
- [ ] P1.1（common）默认展开；P1.2（advanced）/P1.3（experimental）默认折叠，可手动展开
- [ ] 所有字段在 `lib/i18n/{zh,en}.ts` 都有 `settings.<pluginId>.fields.<key>.{label,description,placeholder,errorMessage,group}` 命名条目；i18n 完整性自检脚本 `scripts/check-i18n-completeness.mjs` 通过
- [ ] `SettingsStorageAdapter` 三接口（read/write/subscribe）P1 由 `LocalStorageAdapter` 实现；切换实现仅替换 `defaultAdapter` 一行
- [ ] 同一浏览器多标签：标签 A 写入 → 标签 B 在 `storage` 事件触发后 settings 更新（无需刷新）
- [ ] schema 未识别的字段写入 localStorage 后再次读取，值保留在 `__unknown`，UI 不渲染对应控件
- [ ] `getUnrecognizedFields()` hook 出口可枚举当前 `__unknown` 字段名列表
- [ ] `schemaVersion` 字段写入每条 schema，semver 字符串格式

### 质量验收

- [ ] `npm run type-check` 通过
- [ ] `npm run lint` 通过
- [ ] `npm run format:check` 通过

### 测试验收

- [ ] `npm run test:node` 通过
- [ ] `npm run test`（vitest）通过
- [ ] 新增 `lib/config-schema.test.mjs` 覆盖：
  - [ ] discriminated union narrowing（每个 type 分支）
  - [ ] `group` 默认值兜底（缺省 → 'common'）
  - [ ] `__unknown` 与 `values` 不互相污染
- [ ] 新增 `lib/settings-storage-adapter.test.mjs` 覆盖：
  - [ ] read/write 序列化往返
  - [ ] subscribe 在跨标签 `storage` 事件下触发
  - [ ] `BroadcastChannel` 在不支持环境下（mock 缺失 API）降级为仅 `storage` 事件，零报错
- [ ] 新增 `hooks/useSettings.test.tsx` 覆盖（jsdom 环境）：
  - [ ] `getUnrecognizedFields()` 返回当前 `__unknown`
  - [ ] 已知字段 `setValue` 写入 `values` 而非 `__unknown`
  - [ ] 未知 key 写入 `__unknown` 而非 `values`
- [ ] 新增 `scripts/check-i18n-completeness.mjs`：扫描 schema 字段 → 校验 zh/en 双侧都有完整五段 key

### 文档验收

- [ ] `docs/ARCHITECTURE-DECOUPLING.md` 增加 `config-schema` 章节
- [ ] `AGENTS.md` 目录结构表更新：`components/Settings/{index, P1General, P1BuiltinPlugins, P2Advanced, controls/, fields/}` 列出
- [ ] 本方案文档节六/八/九（本次填齐）已提交

## 十、测试与验证步骤

> 按目标项目脚本动态填充：

- `npm run dev`（dev，端口 30141）
- `npm run test`（vitest + node:test）
- `npm run test:node`
- `npm run type-check`
- `npm run lint`
- `npm run format:check`
- `npm run build`
- `npm run test:coverage`
- `node scripts/check-i18n-completeness.mjs`（新增）

## 十一、回滚方案

- Git 层：`git revert <commit>` 或在独立分支开发后丢弃
- 数据层：清理本方案产生的 localStorage 键（`pi-web:settings:*`）与未来服务端文件 `~/.pi/agent/settings.json`
- 配置层：还原 `lib/i18n/{zh,en}.ts` 中 `settings.*` 命名空间；本方案文档已落盘可保留作历史
