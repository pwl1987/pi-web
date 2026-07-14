/**
 * Textarea 控件 — textarea 字段。
 */

"use client";

import { inputStyle } from "@/lib/styles";

interface TextareaProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
  rows?: number;
}

export function Textarea({ value, onChange, placeholder, ariaLabel, rows = 4 }: TextareaProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      rows={rows}
      style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
    />
  );
}
