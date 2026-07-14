import React from "react";

/** Quick-preset chip button used in the tool checklist header. */
export function PresetChip({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: 5,
        padding: "3px 8px",
        fontSize: 11,
        color: "var(--text-muted)",
        cursor: "pointer",
        flex: 1,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-hover)";
        e.currentTarget.style.color = "var(--text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "none";
        e.currentTarget.style.color = "var(--text-muted)";
      }}
    >
      {label}
    </button>
  );
}
