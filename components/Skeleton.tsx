"use client";

import { type CSSProperties } from "react";

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  /** When true, a circular shape is forced (overrides radius). */
  circle?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Lightweight shimmer placeholder used to improve perceived loading speed.
 * Pure CSS animation (no JS) so it costs nothing on the main thread.
 */
export function Skeleton({
  width = "100%",
  height = 12,
  radius = 6,
  circle = false,
  className,
  style,
}: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={["skeleton", className].filter(Boolean).join(" ")}
      style={{
        display: "inline-block",
        width,
        height,
        borderRadius: circle ? "50%" : radius,
        background:
          "linear-gradient(90deg, var(--bg-hover) 25%, color-mix(in srgb, var(--text-muted) 12%, transparent) 37%, var(--bg-hover) 63%)",
        backgroundSize: "400% 100%",
        animation: "skeleton-shimmer 1.4s ease infinite",
        verticalAlign: "middle",
        ...style,
      }}
    />
  );
}

/** A block of stacked skeleton lines, e.g. for message placeholders. */
export function SkeletonLines({
  lines = 3,
  lineHeight = 12,
  gap = 8,
  lastLineWidth = "60%",
  className,
  style,
}: {
  lines?: number;
  lineHeight?: number | string;
  gap?: number;
  lastLineWidth?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={["skeleton-lines", className].filter(Boolean).join(" ")}
      style={{ display: "flex", flexDirection: "column", gap, width: "100%", ...style }}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={lineHeight} width={i === lines - 1 ? lastLineWidth : "100%"} />
      ))}
    </span>
  );
}
