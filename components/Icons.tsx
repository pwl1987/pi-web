"use client";

import { memo, type SVGProps } from "react";

/** Shared SVG icon library — extracted to avoid duplicating inline SVG markup
 *  across components. Each icon is a memo'd pure component accepting standard
 *  SVG props (width/height/className etc.) for styling overrides. */

const mkIcon = (viewBox: string, path: React.ReactNode, name: string) => {
  const Comp = memo(function _icon({ size = 14, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {path}
      </svg>
    );
  });
  Comp.displayName = `Icon.${name}`;
  return Comp;
};

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

export const Icons = {
  /** Copy to clipboard — two overlapping rectangles */
  Copy: mkIcon(
    "0 0 24 24",
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>,
    "Copy",
  ),

  /** Checkmark — used for "copied" state */
  Check: mkIcon("0 0 24 24", <polyline points="20 6 9 17 4 12" />, "Check"),

  /** Close — "X" mark */
  Close: mkIcon(
    "0 0 24 24",
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>,
    "Close",
  ),

  /** Search magnifying glass */
  Search: mkIcon(
    "0 0 24 24",
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>,
    "Search",
  ),

  /** Chevron down — used in dropdowns, scrolling, expand/collapse */
  ChevronDown: mkIcon("0 0 24 24", <polyline points="6 9 12 15 18 9" />, "ChevronDown"),

  /** Chevron right — used for tree expansion, breadcrumbs */
  ChevronRight: mkIcon("0 0 24 24", <polyline points="9 18 15 12 9 6" />, "ChevronRight"),

  /** Sidebar menu (hamburger) */
  SidebarOpen: mkIcon(
    "0 0 24 24",
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>,
    "SidebarOpen",
  ),

  /** Sidebar panel (close) */
  SidebarClose: mkIcon(
    "0 0 24 24",
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </>,
    "SidebarClose",
  ),

  /** Settings gear */
  Settings: mkIcon(
    "0 0 24 24",
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>,
    "Settings",
  ),

  /** File panel toggle (split-view right panel) */
  FilePanel: mkIcon(
    "0 0 24 24",
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </>,
    "FilePanel",
  ),

  /** Export/download */
  Export: mkIcon(
    "0 0 24 24",
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>,
    "Export",
  ),

  /** System prompt (document) */
  SystemDoc: mkIcon(
    "0 0 24 24",
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </>,
    "SystemDoc",
  ),

  /** Subagent (user + box) */
  Subagent: mkIcon(
    "0 0 24 24",
    <>
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
    </>,
    "Subagent",
  ),

  /** Panels grid (4 squares) */
  Panels: mkIcon(
    "0 0 24 24",
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>,
    "Panels",
  ),

  /** Model (chip/cpu) */
  Model: mkIcon(
    "0 0 24 24",
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </>,
    "Model",
  ),

  /** Skills (layers) */
  Skills: mkIcon(
    "0 0 24 24",
    <>
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </>,
    "Skills",
  ),

  /** Plugins (flask) */
  Plugins: mkIcon(
    "0 0 24 24",
    <>
      <path d="M9 7V2" />
      <path d="M15 7V2" />
      <path d="M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0Z" />
      <path d="M12 19v3" />
    </>,
    "Plugins",
  ),

  /** Extensions (sliders) */
  Extensions: mkIcon(
    "0 0 24 24",
    <>
      <path d="M20 7h-9" />
      <path d="M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </>,
    "Extensions",
  ),

  /** Token counter input arrow */
  TokenIn: mkIcon(
    "0 0 10 10",
    <>
      <line x1="5" y1="8.5" x2="5" y2="1.5" />
      <polyline points="2 4 5 1.5 8 4" />
    </>,
    "TokenIn",
  ),

  /** Token counter output arrow */
  TokenOut: mkIcon(
    "0 0 10 10",
    <>
      <line x1="5" y1="1.5" x2="5" y2="8.5" />
      <polyline points="2 6 5 8.5 8 6" />
    </>,
    "TokenOut",
  ),

  /** Token counter cache arrow (refresh) */
  TokenCache: mkIcon(
    "0 0 10 10",
    <>
      <path d="M8.5 5a3.5 3.5 0 1 1-1-2.45" />
      <polyline points="6.5 1.5 8.5 2.5 7.5 4.5" />
    </>,
    "TokenCache",
  ),

  /** Context usage (brain/cloud) */
  ContextUsage: mkIcon(
    "0 0 10 10",
    <>
      <path d="M1 9 L1 5 Q1 1 5 1 Q9 1 9 5 L9 9" />
      <line x1="1" y1="9" x2="9" y2="9" />
    </>,
    "ContextUsage",
  ),

  /** Add / New (plus sign) */
  Add: mkIcon(
    "0 0 12 12",
    <>
      <line x1="6" y1="1" x2="6" y2="11" />
      <line x1="1" y1="6" x2="11" y2="6" />
    </>,
    "Add",
  ),
} as const;
