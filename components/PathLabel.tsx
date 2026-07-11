import type { CSSProperties } from "react";

/**
 * Right-to-left path label that truncates from the beginning,
 * showing the deepest directory/file name when space is tight.
 */
export function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
  if (!text) return null;
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        lineHeight: 1.35,
        direction: "rtl",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}
