"use client";

import type React from "react";

export function EmptyState({
  children,
  padding = "16px",
  fontSize = 12,
  center = false,
  lineHeight,
}: {
  children: React.ReactNode;
  padding?: string;
  fontSize?: number;
  center?: boolean;
  lineHeight?: number;
}) {
  return (
    <div
      style={{
        padding,
        fontSize,
        color: "var(--text-dim)",
        textAlign: center ? "center" : "left",
        lineHeight,
      }}
    >
      {children}
    </div>
  );
}
