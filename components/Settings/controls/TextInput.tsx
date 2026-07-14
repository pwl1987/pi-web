/**
 * TextInput 控件 — string 字段。
 */

"use client";

import { inputStyle } from "@/lib/styles";

interface TextInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
  pattern?: string;
  maxLength?: number;
}

export function TextInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  pattern,
  maxLength,
}: TextInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      pattern={pattern}
      maxLength={maxLength}
      style={inputStyle}
    />
  );
}
