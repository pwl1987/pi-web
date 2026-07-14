/**
 * StringList 控件 — string-list 字段。
 * ponytail: 简化实现，逗号分隔；Step 4.6 阶段如有需要升级为独立行编辑。
 */

"use client";

import { inputStyle } from "@/lib/styles";

interface StringListProps {
  value: string[];
  onChange: (v: string[]) => void;
  itemPlaceholder?: string;
  ariaLabel: string;
}

export function StringList({ value, onChange, itemPlaceholder, ariaLabel }: StringListProps) {
  const text = value.join(", ");
  return (
    <input
      type="text"
      value={text}
      onChange={(e) =>
        onChange(
          e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        )
      }
      placeholder={itemPlaceholder ?? "逗号分隔"}
      aria-label={ariaLabel}
      style={inputStyle}
    />
  );
}
