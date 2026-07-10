"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

export interface PinnedDir {
  path: string;
  alias?: string;
  pinnedAt: number;
}

interface Props {
  /** Called when the user picks a pinned dir to switch to. */
  onCwdChange: (cwd: string, projectRoot: string | null) => void;
  /** Optional className passthrough for layout in SessionSidebar. */
  className?: string;
}

/**
 * Renders the list of pinned directories. Self-contained: fetches from
 * /api/pinned-dirs on mount and re-fetches after a mutation. The list
 * is shown only when at least one dir is pinned.
 *
 * Contract (locked by components/PinnedDirsList.test.tsx):
 *  - On mount, GET /api/pinned-dirs. Renders one <li data-pinned-row>
 *    per result. Shows `alias || basename(path)` as the visible label,
 *    full path as the dimmer title attribute.
 *  - Click on a row calls onCwdChange(path, path) (no worktree info
 *    available client-side, so projectRoot falls back to the path).
 *  - Each row has a × unpin button (data-unpin). Clicking it sends
 *    DELETE /api/pinned-dirs with { path } and removes the row locally
 *    on a 2xx response.
 *  - Empty list / 500 error → renders nothing (no header, no error
 *    banner — pinned dirs are a convenience, failure is silent).
 *  - No "add" button here — that's the SessionSidebar's job (the user
 *    pins a cwd they're currently in via that component).
 */
export function PinnedDirsList({ onCwdChange, className }: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState<PinnedDir[] | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/pinned-dirs");
      if (!res.ok) {
        setItems([]);
        return;
      }
      const data = await res.json() as { pinnedDirs?: PinnedDir[] };
      setItems(data.pinnedDirs ?? []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const unpin = useCallback(async (path: string) => {
    // Optimistic local removal so the UI feels instant; revert via
    // reload() if the API rejects.
    setItems((prev) => (prev ?? []).filter((d) => d.path !== path));
    try {
      const res = await fetch("/api/pinned-dirs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) await reload();
    } catch {
      await reload();
    }
  }, [reload]);

  // Empty state — render nothing (no header, no "empty" placeholder).
  if (!items || items.length === 0) return null;

  const basename = (p: string) => {
    const cleaned = p.endsWith("/") ? p.slice(0, -1) : p;
    const idx = cleaned.lastIndexOf("/");
    return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
  };

  return (
    <div className={className}>
      <div
        style={{
          padding: "8px 10px 4px",
          fontSize: 10,
          fontWeight: 600,
          color: "var(--text-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {t("sidebar.pinnedDirs")}
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: "0 4px 4px",
        }}
      >
        {items.map((dir) => {
          const label = dir.alias || basename(dir.path);
          return (
            <li
              key={dir.path}
              data-pinned-row
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 8px",
                borderRadius: 5,
                color: "var(--text)",
                cursor: "pointer",
              }}
              onClick={() => onCwdChange(dir.path, dir.path)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                data-pinned-label
                aria-hidden
                style={{
                  fontSize: 12,
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: 500,
                }}
                title={dir.path}
              >
                {label}
              </span>
              {dir.alias && (
                <span
                  aria-hidden
                  style={{
                    fontSize: 10,
                    color: "var(--text-dim)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 80,
                  }}
                >
                  {basename(dir.path)}
                </span>
              )}
              <button
                data-unpin
                aria-label={t("sidebar.unpin")}
                onClick={(e) => {
                  e.stopPropagation();
                  void unpin(dir.path);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 2,
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  borderRadius: 3,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-selected)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--text-dim)";
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}