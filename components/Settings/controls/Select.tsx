/**
 * Select 控件 — select 字段。
 */

"use client";

import { selectStyle } from "@/lib/styles";
import type { SelectOption } from "@/lib/config-schema";

interface SelectControlProps {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  ariaLabel: string;
}

export function Select({ value, options, onChange, ariaLabel }: SelectControlProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      style={selectStyle}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
