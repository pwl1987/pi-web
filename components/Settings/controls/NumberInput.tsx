/**
 * NumberInput 控件 — number 字段。
 */

"use client";

import { inputStyle } from "@/lib/styles";

interface NumberInputProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  ariaLabel: string;
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  ariaLabel,
}: NumberInputProps) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      aria-label={ariaLabel}
      style={inputStyle}
    />
  );
}
