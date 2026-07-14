"use client";

import { useState, useRef, useCallback, memo } from "react";
import type React from "react";
import type { SessionInfo } from "@/lib/types";
import type { WorkspaceLabelItem } from "@/lib/extensions/types";
import { useI18n } from "@/hooks/useI18n";
import { RunningSessionIndicator, UnreadSessionIndicator } from "./StatusIndicators";
import { formatRelativeTime } from "@/lib/session-utils";
import { csrfFetchJson } from "@/lib/csrf-fetch";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import {
  iconButtonStyle,
  iconButtonStyleHover,
  iconButtonStyleHoverError,
  iconButtonStyleDefault,
  collapseButtonStyle,
  smallInputStyle,
} from "@/lib/styles";

export const SessionItem = memo(function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
  labels = [],
}: {
  session: SessionInfo;
  isSelected?: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Extension-contributed label items to render inline. */
  labels?: Array<{ qualifiedId: string; item: WorkspaceLabelItem }>;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const title = session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);

  const startRename = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setRenameValue(session.name ?? "");
      setRenaming(true);
      setTimeout(() => inputRef.current?.select(), 0);
    },
    [session.name],
  );

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    // plan 会话重命名保护：强制保留 📋 前缀，避免角标丢失导致无法识别为计划讨论。
    // isPlanMode 是结构化标记（不依赖 name），但 📋 前缀是用户视觉线索，两者互补。
    const finalName = session.isPlanMode && !name.startsWith("📋") ? `📋 ${name}` : name;
    try {
      await csrfFetchJson(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        body: { name: finalName },
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, session.isPlanMode, onRenamed]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  }, []);

  const handleDeleteConfirm = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setConfirmDelete(false);
      setDeleting(true);
      try {
        await csrfFetchJson(`/api/sessions/${encodeURIComponent(session.id)}`, {
          method: "DELETE",
        });
        onDeleted?.(session.id);
      } catch {
        setDeleting(false);
      }
    },
    [session.id, onDeleted],
  );

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  const ITEM_HEIGHT = 54;

  return (
    <div
      onClick={confirmDelete || renaming ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
      }}
      style={{
        height: ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: depth > 0 ? depth * 12 + 14 : 14,
        paddingRight: 8,
        cursor: confirmDelete || renaming ? "default" : "pointer",
        background: confirmDelete
          ? "var(--error-bg)"
          : isSelected
            ? "var(--bg-selected)"
            : hovered
              ? "var(--bg-hover)"
              : "transparent",
        borderLeft: confirmDelete
          ? "2px solid #ef4444"
          : isSelected
            ? "2px solid var(--accent)"
            : "2px solid transparent",
        transition: "background 0.1s",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {confirmDelete ? (
        <>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {t("sidebar.deleteConfirm", {
              name: `${title.slice(0, 22)}${title.length > 22 ? "…" : ""}`,
            })}
          </div>
          <ConfirmDialog
            isOpen={confirmDelete}
            confirmText={t("sidebar.delete")}
            cancelText={t("common.cancel")}
            onConfirm={handleDeleteConfirm}
            onCancel={handleDeleteCancel}
            confirmIcon={
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            }
          />
        </>
      ) : renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={smallInputStyle}
        />
      ) : (
        /* ── Normal view ── */
        <>
          {/* Fork indicator for child sessions */}
          {depth > 0 && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-dim)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                minWidth: 0,
                fontSize: 12,
                fontWeight: isSelected ? 500 : 400,
                lineHeight: 1.4,
                color: "var(--text)",
              }}
              title={
                isRunning
                  ? t("sidebar.titleAgentRunning", { title })
                  : isUnread
                    ? t("sidebar.titleNewActivity", { title })
                    : title
              }
            >
              {/* plan 会话固定角标：结构化标记，不依赖 name 的 📋 前缀。
                  重命名后仍可识别为计划讨论。accent 色与 plan 模式开关按钮呼应。 */}
              {session.isPlanMode && (
                <span
                  title={t("plan.mode")}
                  style={{
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    color: "var(--accent)",
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="8" y="2" width="8" height="4" rx="1" />
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                </span>
              )}
              {isRunning ? (
                <RunningSessionIndicator />
              ) : isUnread ? (
                <UnreadSessionIndicator />
              ) : null}
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {title}
              </span>
            </div>
            <div
              style={{
                marginTop: 2,
                display: "flex",
                gap: 8,
                color: "var(--text-dim)",
                fontSize: 11,
                minWidth: 0,
              }}
            >
              <span title={session.modified}>{formatRelativeTime(session.modified, t)}</span>
              <span>
                {session.messageCount} {t("sidebar.msgs")}
              </span>
              {session.worktreeBranch && (
                <span
                  title={t("sidebar.worktreeTitle", { cwd: session.cwd })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    color: "var(--accent)",
                    minWidth: 0,
                    overflow: "hidden",
                  }}
                >
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                  >
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {session.worktreeBranch}
                  </span>
                </span>
              )}
              {labels.map(({ qualifiedId, item }) => {
                if (item.type === "text")
                  return (
                    <span
                      key={qualifiedId}
                      title={item.title}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                        color: "var(--text-dim)",
                        flexShrink: 0,
                      }}
                    >
                      {item.icon}
                      <span style={{ whiteSpace: "nowrap" }}>{item.text}</span>
                    </span>
                  );
                if (item.type === "link")
                  return (
                    <a
                      key={qualifiedId}
                      href={item.href}
                      title={item.title}
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: "var(--accent)", textDecoration: "none", flexShrink: 0 }}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.text}
                    </a>
                  );
                if (item.type === "render") {
                  const C = item.Component;
                  return <C key={qualifiedId} {...item.props} />;
                }
                return null;
              })}
            </div>
          </div>

          {/* Collapse toggle — always visible when has children */}
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse?.();
              }}
              title={collapsed ? t("sidebar.expandForks") : t("sidebar.collapseForks")}
              style={{
                ...collapseButtonStyle,
                transform: collapsed ? "rotate(-90deg)" : "none",
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          )}

          {/* Action buttons — shown on hover */}
          {hovered && (
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button
                onClick={startRename}
                title={t("sidebar.rename")}
                aria-label={t("sidebar.rename")}
                style={iconButtonStyle}
                onMouseEnter={(e) => {
                  Object.assign(e.currentTarget.style, iconButtonStyleHover);
                }}
                onMouseLeave={(e) => {
                  Object.assign(e.currentTarget.style, iconButtonStyleDefault);
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
              <button
                onClick={handleDeleteClick}
                title={t("sidebar.delete")}
                aria-label={t("sidebar.delete")}
                style={iconButtonStyle}
                onMouseEnter={(e) => {
                  Object.assign(e.currentTarget.style, iconButtonStyleHoverError);
                }}
                onMouseLeave={(e) => {
                  Object.assign(e.currentTarget.style, iconButtonStyleDefault);
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
});
