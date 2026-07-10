"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getPinnedDirsBus } from "@/lib/pinned-dirs-bus";

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
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

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
    // Re-fetch when another component mutates the pin list. The Pin button
    // in the cwd picker fires this same bus after POST/DELETE succeeds.
    const bus = getPinnedDirsBus();
    return bus.subscribe(reload);
  }, [reload]);

  const unpin = useCallback(async (path: string) => {
    // Close the alias editor if open — prevents a blur-triggered saveAlias
    // POST from racing against this DELETE. The × button also has
    // onMouseDown=preventDefault which stops the blur from firing at all
    // in real browsers; this is the fallback for keyboard-triggered unpin.
    setEditingPath(null);
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

  const saveAlias = useCallback(async (path: string, alias: string) => {
    setEditingPath(null);
    // Skip the POST when the alias hasn't changed — avoids unnecessary
    // writes and prevents a POST/DELETE race when the user clicks the
    // × unpin button while the editor is open (the blur would otherwise
    // fire a save POST alongside the unpin DELETE).
    const existing = items?.find((d) => d.path === path);
    if (existing && (existing.alias ?? "") === alias) return;
    try {
      const res = await fetch("/api/pinned-dirs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, alias }),
      });
      if (res.ok) {
        // Optimistic local update + notify peers.
        setItems((prev) =>
          (prev ?? []).map((d) =>
            d.path === path ? { ...d, alias: alias || undefined } : d,
          ),
        );
        getPinnedDirsBus().emit();
      } else {
        await reload();
      }
    } catch {
      await reload();
    }
  }, [reload, items]);

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
          const isEditing = editingPath === dir.path;
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
              onClick={() => {
                if (!isEditing) onCwdChange(dir.path, dir.path);
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {isEditing ? (
                <input
                  data-alias-input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      void saveAlias(dir.path, editValue.trim());
                    } else if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditingPath(null);
                    }
                  }}
                  onBlur={() => void saveAlias(dir.path, editValue.trim())}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={t("sidebar.aliasPlaceholder")}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12,
                    padding: "2px 4px",
                    border: "1px solid var(--accent)",
                    borderRadius: 4,
                    outline: "none",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                  }}
                />
              ) : (
                <>
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
                    data-edit-alias
                    aria-label={t("sidebar.addAlias")}
                    title={t("sidebar.addAlias")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditValue(dir.alias ?? "");
                      setEditingPath(dir.path);
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
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                </>
              )}
              <button
                data-unpin
                aria-label={t("sidebar.unpin")}
                // Sole guard against POST/DELETE race: prevents the input
                // from blurring when the user clicks × while editing, so
                // onBlur→saveAlias never fires alongside the unpin DELETE.
                onMouseDown={(e) => e.preventDefault()}
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