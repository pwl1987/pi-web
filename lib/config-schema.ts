/**
 * 配置元信息的唯一事实源（Single Source of Truth）。
 *
 * 由方案 A「稳健优先」引入：UI（components/Settings/）、持久化层
 * （SettingsStorageAdapter）、i18n（settings.<pluginId>.fields.<key>.*）均从此模块派生。
 *
 * 字段类型采用 discriminated union：`boolean/string/number/select/textarea/string-list` 六类。
 * PluginSettings 的 `values` 仅承载 schema 已知字段，未知字段落入 `__unknown` 不渲染 UI（P1 简化）。
 *
 * ponytail: 旧 lib/plugin-config-descriptors.ts 的 toggle/multiselect/list 类型在
 *   Step 4.6 迁移时映射到 boolean/string-list；本文件先落类型壳，迁移后再追加具体 schema。
 */

export const SCHEMA_VERSION = "1.0.0" as const;

/** 字段渲染类型，决定 FieldRenderer 分发到哪个控件。 */
export type FieldType = "boolean" | "string" | "number" | "select" | "textarea" | "string-list";

/** P1.1/P1.2/P1.3 折叠分组。缺省落 "common"。 */
export type FieldGroup = "common" | "advanced" | "experimental";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

/** 所有字段的公共基类。 */
export interface FieldBase {
  /** 在 PluginSettings.values 内的稳定 key。 */
  key: string;
  type: FieldType;
  /** 缺省值；类型必须与 type 严格匹配（编译期联合保护）。 */
  default: unknown;
  /** P1.1/P1.2/P1.3 折叠分组，缺省 "common"。 */
  group?: FieldGroup;
  /** i18n 命名空间前缀；完整 key 由 i18nKey + .{label,description,...} 拼接。 */
  i18nKey: string;
}

export interface BooleanField extends FieldBase {
  type: "boolean";
  default: boolean;
}

export interface StringField extends FieldBase {
  type: "string";
  default: string;
  placeholder?: string;
  /** 校验正则；失败时显示 i18nKey.errorMessage。 */
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
  placeholder?: string;
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
  /** 单条输入占位符。 */
  itemPlaceholder?: string;
}

export type FieldDescriptor =
  BooleanField | StringField | NumberField | SelectField | TextareaField | StringListField;

/** 单个插件的 schema 声明。 */
export interface PluginSchema {
  /** 稳定 ID，例如 "git-status"、"npm:context-mode"。 */
  pluginId: string;
  /** semver 字符串；与 SCHEMA_VERSION 不匹配时仅保留 __unknown 不渲染。 */
  version: string;
  /** 顶级启停开关（可选；缺省无开关）。 */
  enabled?: BooleanField;
  /** 字段列表，按声明顺序渲染。 */
  fields: FieldDescriptor[];
}

/** 持久化结构：已知字段 + 未知字段隔离。 */
export interface PluginSettings {
  enabled?: boolean;
  /** schema 已知字段的实际值。 */
  values: Record<string, unknown>;
  /** schema 不识别的字段保留区；UI 不渲染。 */
  __unknown: Record<string, unknown>;
}

/**
 * 已注册 schema 聚合（实数据在 lib/all-schemas.ts，本文件 re-export）。
 * 由 Step 4.6 阶段从 lib/plugin-config-descriptors.ts 机械迁移填充（33 插件 / 81 字段）。
 */
export { allSchemas } from "./all-schemas.ts";
import { allSchemas as _allSchemas } from "./all-schemas.ts";

/** 按 pluginId 查 schema；不存在返回 undefined。 */
export function getSchema(pluginId: string): PluginSchema | undefined {
  return _allSchemas.find((s) => s.pluginId === pluginId);
}

/** 字段缺省 group 时落 "common"。供 UI 层 / i18n 完整性自检复用。 */
export function resolveGroup(field: FieldDescriptor): FieldGroup {
  return field.group ?? "common";
}

/** TypeScript 编译期守卫：检查 default 是否与字段类型兼容。 */
export function isFieldValid(field: FieldDescriptor): boolean {
  switch (field.type) {
    case "boolean":
      return typeof field.default === "boolean";
    case "string":
    case "select":
    case "textarea":
      return typeof field.default === "string";
    case "number":
      return typeof field.default === "number" && Number.isFinite(field.default);
    case "string-list":
      return Array.isArray(field.default) && field.default.every((v) => typeof v === "string");
  }
}
