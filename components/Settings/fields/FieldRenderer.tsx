/**
 * FieldRenderer — 按 FieldType 分发到对应控件。
 * discriminated union 在 switch 内自动 narrow，无需 `as` 断言。
 */

"use client";

import type { FieldDescriptor } from "@/lib/config-schema";
import { Switch } from "../controls/Switch";
import { NumberInput } from "../controls/NumberInput";
import { TextInput } from "../controls/TextInput";
import { Select } from "../controls/Select";
import { Textarea } from "../controls/Textarea";
import { StringList } from "../controls/StringList";
import { useI18n } from "@/hooks/useI18n";

interface FieldRendererProps {
  field: FieldDescriptor;
  value: unknown;
  onChange: (v: unknown) => void;
}

function FieldRow({
  children,
  label,
  description,
}: {
  children: React.ReactNode;
  label: string;
  description?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 500, color: "var(--text)" }}>{label}</label>
      {children}
      {description && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{description}</div>}
    </div>
  );
}

export function FieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const { t } = useI18n();
  const label = t(`${field.i18nKey}.label`);
  const description = t(`${field.i18nKey}.description`);
  void description;

  switch (field.type) {
    case "boolean":
      return (
        <FieldRow label={label}>
          <Switch value={Boolean(value)} onChange={(v) => onChange(v)} ariaLabel={label} />
        </FieldRow>
      );
    case "number":
      return (
        <FieldRow label={label}>
          <NumberInput
            value={Number(value)}
            onChange={(v) => onChange(v)}
            min={field.min}
            max={field.max}
            step={field.step}
            placeholder={field.placeholder}
            ariaLabel={label}
          />
        </FieldRow>
      );
    case "string":
      return (
        <FieldRow label={label}>
          <TextInput
            value={String(value ?? "")}
            onChange={(v) => onChange(v)}
            placeholder={field.placeholder}
            pattern={field.pattern}
            maxLength={field.maxLength}
            ariaLabel={label}
          />
        </FieldRow>
      );
    case "select":
      return (
        <FieldRow label={label}>
          <Select
            value={String(value ?? field.default)}
            options={field.options}
            onChange={(v) => onChange(v)}
            ariaLabel={label}
          />
        </FieldRow>
      );
    case "textarea":
      return (
        <FieldRow label={label}>
          <Textarea
            value={String(value ?? "")}
            onChange={(v) => onChange(v)}
            placeholder={field.placeholder}
            ariaLabel={label}
          />
        </FieldRow>
      );
    case "string-list":
      return (
        <FieldRow label={label}>
          <StringList
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={(v) => onChange(v)}
            itemPlaceholder={field.itemPlaceholder}
            ariaLabel={label}
          />
        </FieldRow>
      );
  }
}
