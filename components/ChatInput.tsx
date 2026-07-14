"use client";

import React, {
  useRef,
  useState,
  useMemo,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
  memo,
  type KeyboardEvent,
} from "react";
import type {
  BuiltinSlashCommandResult,
  CompactResultInfo,
  QueuedMessages,
  SlashCommandInfo,
} from "@/hooks/useAgentSession";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { usePlanMode, setPlanMode } from "@/lib/plan-mode-store";
import type { ToolEntry } from "@/lib/tool-presets";
import { formatTokenCount } from "@/lib/format-token-count";
import { compareModelOptions, modelOptionCollator, type ModelOption } from "@/lib/model-utils";
import { QueuedMessageRow } from "@/components/QueuedMessageRow";
import {
  type SlashCommandPaletteItem,
  type SlashCommandSource,
  buildBuiltinSlashCommands,
  SLASH_SOURCES,
  SLASH_SOURCE_ORDER,
  slashMatchRank,
} from "@/lib/slash-commands";
import { SlashCommandPanel } from "./chat-input/SlashCommandPanel";
import { AtFilePanel } from "./chat-input/AtFilePanel";
import { ModelDropdownPanel } from "./chat-input/ModelDropdownPanel";
import { ThinkingLevelDropdown } from "./chat-input/ThinkingLevelDropdown";
import { ToolPresetDropdown } from "./chat-input/ToolPresetDropdown";
import { useImageHandling } from "./chat-input/useImageHandling";
import { useDraftPersistence } from "./chat-input/useDraftPersistence";
import { useAtFileCompletion } from "./chat-input/useAtFileCompletion";
import { usePlanModeSend } from "./chat-input/usePlanModeSend";
import { usePromptEnhance } from "./chat-input/usePromptEnhance";

// AttachedImage and ChatInputHandle live in @/lib/types (shared with
// useAgentSession). Re-exported here for backward-compatible imports.
import type { AttachedImage } from "@/lib/types";
export type { AttachedImage };

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  onPromptWithStreamingBehavior?: (
    message: string,
    behavior: "steer" | "followUp",
    images?: AttachedImage[],
  ) => void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: Array<{ id: string; name: string; provider: string }>;
  onModelChange?: (provider: string, modelId: string) => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  compactResult?: CompactResultInfo | null;
  toolPreset?: "none" | "default" | "full";
  onToolPresetChange?: (preset: "none" | "default" | "full") => void;
  /** Per-tool granularity (preferred over toolPreset when provided). */
  tools?: ToolEntry[];
  onToolsChange?: (tools: ToolEntry[]) => void;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  onThinkingLevelChange?: (
    level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh",
  ) => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages | null;
  onRecallQueue?: () => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  onAudioUnlock?: () => void;
  draftKey?: string;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
}

// ChatInputHandle is sourced from @/lib/types; re-export for backward compat.
import type { ChatInputHandle } from "@/lib/types";
export type { ChatInputHandle };

const TOOL_PRESET_MAP: Record<"off" | "default" | "full", "none" | "default" | "full"> = {
  off: "none",
  default: "default",
  full: "full",
};
const COMPOSITION_END_ENTER_GRACE_MS = 100;

// THINKING_LEVELS / THINKING_LEVEL_DESC imported from ./chat-input/ThinkingLevelDropdown

export const ChatInput = memo(
  forwardRef<ChatInputHandle, Props>(function ChatInput(
    {
      onSend,
      onAbort,
      onSteer,
      onFollowUp,
      isStreaming,
      model,
      isAutoModelSelection,
      modelNames,
      modelList,
      onModelChange,
      onCompact,
      onAbortCompaction,
      isCompacting,
      compactError,
      compactResult,
      toolPreset,
      onToolPresetChange,
      tools,
      onToolsChange,
      thinkingLevel,
      onThinkingLevelChange,
      availableThinkingLevels,
      thinkingLevelMap,
      retryInfo,
      queuedMessages,
      onRecallQueue,
      slashCommands,
      slashCommandsLoading,
      onLoadSlashCommands,
      onBuiltinCommand,
      soundEnabled,
      onSoundToggle,
      onAudioUnlock,
      onPromptWithStreamingBehavior,
      draftKey,
      cwd,
    }: Props,
    ref,
  ) {
    const isMobile = useIsMobile();
    const { t } = useI18n();
    const { planMode, orchestratorId, planStatus, planConfig } = usePlanMode();

    const [value, setValue] = useState("");
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const [modelDropdownRect, setModelDropdownRect] = useState<{
      top: number;
      left: number;
      width: number;
    } | null>(null);
    const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
    const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
    const [controlsMenuOpen, setControlsMenuOpen] = useState(false);
    const [slashMenuOpen, setSlashMenuOpen] = useState(false);
    const [slashActiveIndex, setSlashActiveIndex] = useState(0);
    const [stopConfirming, setStopConfirming] = useState(false);

    // ── 提取的 hooks ──
    const { attachedImages, setAttachedImages, processImageFiles, removeImage, clearImages } =
      useImageHandling(isStreaming);

    const { clearCurrentDraft, persistCursor } = useDraftPersistence({
      draftKey,
      value,
      attachedImages,
      setValue,
      setAttachedImages,
    });

    const {
      atQuery,
      setAtQuery,
      atMenuOpen,
      setAtMenuOpen,
      atActiveIndex,
      setAtActiveIndex,
      atMatches,
      atItemRefs,
      fileIndex,
      fileIndexLoading,
      needsServerSearch,
      serverResultInUse,
      updateAtQuery,
      applyAtCompletion,
    } = useAtFileCompletion({ cwd, value, setValue });

    const { enhancing, enhanceError, showUndo, handleEnhance, handleEnhanceUndo, cancelUndo } =
      usePromptEnhance({ value, setValue, isStreaming, model, cwd });

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
    const toolDropdownRef = useRef<HTMLDivElement>(null);
    const thinkingDropdownRef = useRef<HTMLDivElement>(null);
    const controlsMenuRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isComposingRef = useRef(false);
    const lastCompositionEndAtRef = useRef(0);
    const slashCommandsRequestedRef = useRef(false);
    const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const stopConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanup stop-confirmation timeout on unmount
    useEffect(() => {
      return () => {
        if (stopConfirmTimeoutRef.current) clearTimeout(stopConfirmTimeoutRef.current);
      };
    }, []);

    useImperativeHandle(ref, () => ({
      insertIfEmpty(text: string) {
        const ta = textareaRef.current;
        const current = ta ? ta.value : value;
        if (current.trim()) return;
        setValue(text);
        setAtQuery(null);
        requestAnimationFrame(() => {
          if (!ta) return;
          ta.focus();
          ta.style.height = "auto";
          ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
        });
      },
      prependText(text: string) {
        if (!text.trim()) return;
        const ta = textareaRef.current;
        const current = ta ? ta.value : value;
        // Mirrors the TUI's queue restore: queued text first, then whatever
        // the user already typed, separated by a blank line.
        const combined = [text, current].filter((t) => t.trim()).join("\n\n");
        setValue(combined);
        setAtQuery(null);
        requestAnimationFrame(() => {
          if (!ta) return;
          ta.focus();
          ta.setSelectionRange(combined.length, combined.length);
          ta.style.height = "auto";
          ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
        });
      },
      insertText(text: string) {
        const ta = textareaRef.current;
        if (!ta) {
          setValue((v) => v + (v ? " " : "") + text);
          return;
        }
        const start = ta.selectionStart ?? ta.value.length;
        const end = ta.selectionEnd ?? ta.value.length;
        const before = ta.value.slice(0, start);
        const after = ta.value.slice(end);
        const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
        const newVal = before + sep + text + after;
        setValue(newVal);
        setAtQuery(null);
        requestAnimationFrame(() => {
          if (!ta) return;
          const pos = start + sep.length + text.length;
          ta.setSelectionRange(pos, pos);
          ta.focus();
          ta.style.height = "auto";
          ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
        });
      },
      addImages(files: File[]) {
        processImageFiles(files);
      },
    }));

    const clearInput = useCallback(() => {
      setValue("");
      setAtQuery(null);
      clearCurrentDraft();
      clearImages();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }, [clearImages, clearCurrentDraft, setAtQuery]);

    useEffect(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.style.height = "auto";
      if (value) ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }, [value]);

    // 卸载时清理图片 blob URL
    useEffect(() => {
      return () => {
        clearImages();
      };
    }, [clearImages]);

    const { planBusy, planError, sendPlanMessage } = usePlanModeSend({
      cwd,
      planConfig,
      onClearInput: clearInput,
      onCancelUndo: cancelUndo,
      t,
    });

    const handleSend = useCallback(async () => {
      const msg = value.trim();
      onAudioUnlock?.();

      // 计划模式：委派给 usePlanModeSend
      if (planMode) {
        await sendPlanMessage(msg, orchestratorId, planStatus);
        return;
      }

      // 普通模式流控
      if (isStreaming) return;
      if (!msg && !attachedImages.length) return;
      if (!attachedImages.length && msg.startsWith("/") && onBuiltinCommand) {
        const result = await onBuiltinCommand(msg);
        if (result.handled) {
          if (!result.error) clearInput();
          return;
        }
      }
      onSend(msg, attachedImages.length ? attachedImages : undefined);
      clearInput();
      cancelUndo();
    }, [
      value,
      attachedImages,
      isStreaming,
      planMode,
      planStatus,
      orchestratorId,
      sendPlanMessage,
      onBuiltinCommand,
      onSend,
      clearInput,
      cancelUndo,
      onAudioUnlock,
    ]);

    const slashQuery =
      value.startsWith("/") && !/\s/.test(value.slice(1)) ? value.slice(1).toLowerCase() : null;

    const filteredSlashCommands = useMemo(() => {
      if (slashQuery === null) return [];
      const commands = [
        ...(isStreaming ? [] : buildBuiltinSlashCommands(t)),
        ...(slashCommands ?? []),
      ];
      return [...commands]
        .filter((command) => {
          const name = command.name.toLowerCase();
          const description = command.description?.toLowerCase() ?? "";
          return name.includes(slashQuery) || description.includes(slashQuery);
        })
        .sort((a, b) => {
          const rankDelta = slashMatchRank(a, slashQuery) - slashMatchRank(b, slashQuery);
          if (rankDelta !== 0) return rankDelta;
          return (
            SLASH_SOURCE_ORDER[a.source] - SLASH_SOURCE_ORDER[b.source] ||
            modelOptionCollator.compare(a.name, b.name)
          );
        });
    }, [slashQuery, isStreaming, slashCommands, t]);

    const groupedSlashCommands = useMemo(() => {
      const groups = new Map<
        SlashCommandSource,
        {
          source: SlashCommandSource;
          items: Array<{ command: SlashCommandPaletteItem; index: number }>;
        }
      >();
      for (const source of SLASH_SOURCES) {
        groups.set(source, { source, items: [] });
      }
      filteredSlashCommands.forEach((command, index) => {
        groups.get(command.source)?.items.push({ command, index });
      });
      return SLASH_SOURCES.map((source) => groups.get(source)).filter(
        (group): group is NonNullable<typeof group> => group != null && group.items.length > 0,
      );
    }, [filteredSlashCommands]);

    const slashCommandCountLabel =
      filteredSlashCommands.length === 1
        ? slashQuery
          ? t("input.oneMatch")
          : t("input.oneCommand")
        : slashQuery
          ? t("input.countMatches", { count: filteredSlashCommands.length })
          : t("input.countCommands", { count: filteredSlashCommands.length });
    const hasInputText = Boolean(value.trim());
    const canQueueStreamingMessage = hasInputText && attachedImages.length === 0;

    // @ file autocomplete 逻辑已提取至 useAtFileCompletion hook

    const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
      const nextValue = `/${command.name} `;
      setValue(nextValue);
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(nextValue.length, nextValue.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    }, []);

    const sendQueued = useCallback(
      (mode: "steer" | "followup") => {
        const msg = value.trim();
        if (!msg && !attachedImages.length) return;
        if (attachedImages.length) return;
        onAudioUnlock?.();
        const streamingBehavior = mode === "steer" ? "steer" : "followUp";
        if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
          onPromptWithStreamingBehavior(
            msg,
            streamingBehavior,
            attachedImages.length ? attachedImages : undefined,
          );
          clearInput();
          return;
        }
        if (mode === "steer" && onSteer) {
          onSteer(msg, attachedImages.length ? attachedImages : undefined);
        } else if (mode === "followup" && onFollowUp) {
          onFollowUp(msg, attachedImages.length ? attachedImages : undefined);
        }
        clearInput();
      },
      [
        value,
        attachedImages,
        onPromptWithStreamingBehavior,
        onSteer,
        onFollowUp,
        clearInput,
        onAudioUnlock,
      ],
    );

    const getNextSlashIndex = useCallback(
      (direction: "up" | "down" | "left" | "right") => {
        const lastIndex = filteredSlashCommands.length - 1;
        if (lastIndex < 0) return 0;

        if (direction === "left") return Math.max(0, slashActiveIndex - 1);
        if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);

        const currentNode = slashItemRefs.current[slashActiveIndex];
        if (!currentNode) {
          return direction === "down"
            ? Math.min(lastIndex, slashActiveIndex + 1)
            : Math.max(0, slashActiveIndex - 1);
        }

        const currentRect = currentNode.getBoundingClientRect();
        const currentX = currentRect.left + currentRect.width / 2;
        const currentY = currentRect.top + currentRect.height / 2;
        let bestIndex = -1;
        let bestScore = Number.POSITIVE_INFINITY;

        for (let index = 0; index <= lastIndex; index += 1) {
          if (index === slashActiveIndex) continue;
          const node = slashItemRefs.current[index];
          if (!node) continue;
          const rect = node.getBoundingClientRect();
          const candidateY = rect.top + rect.height / 2;
          const verticalDelta = candidateY - currentY;
          if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;

          const candidateX = rect.left + rect.width / 2;
          const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
          if (score < bestScore) {
            bestIndex = index;
            bestScore = score;
          }
        }

        if (bestIndex >= 0) return bestIndex;
        return direction === "down"
          ? Math.min(lastIndex, slashActiveIndex + 1)
          : Math.max(0, slashActiveIndex - 1);
      },
      [filteredSlashCommands.length, slashActiveIndex],
    );

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        const nativeEvent = e.nativeEvent;
        const recentlyComposed =
          Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
        const isComposing =
          isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229;

        if (e.key === "Enter" && !e.shiftKey && (isComposing || recentlyComposed)) {
          if (recentlyComposed) e.preventDefault();
          return;
        }

        if (slashMenuOpen && slashQuery !== null) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSlashActiveIndex(getNextSlashIndex("down"));
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setSlashActiveIndex(getNextSlashIndex("up"));
            return;
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            setSlashActiveIndex(getNextSlashIndex("right"));
            return;
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setSlashActiveIndex(getNextSlashIndex("left"));
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setSlashMenuOpen(false);
            return;
          }
          if (
            (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) &&
            filteredSlashCommands[slashActiveIndex]
          ) {
            e.preventDefault();
            applySlashCommand(filteredSlashCommands[slashActiveIndex]);
            return;
          }
        }

        // @ file menu — skip while composing so IME candidate navigation
        // (arrows/Enter/Tab) is never intercepted.
        if (atMenuOpen && atQuery !== null && !isComposing) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAtActiveIndex((i) => Math.min(Math.max(0, atMatches.length - 1), i + 1));
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setAtActiveIndex((i) => Math.max(0, i - 1));
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setAtMenuOpen(false);
            return;
          }
          if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) && atMatches[atActiveIndex]) {
            e.preventDefault();
            applyAtCompletion(atMatches[atActiveIndex]);
            return;
          }
        }

        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          // 流控解耦：plan 模式始终走 handleSend（受 planBusy 控制），
          // 普通模式流式输出时才走 steer/followUp 队列。与发送按钮三元判断保持一致。
          if (isStreaming && !planMode && (onSteer || onFollowUp)) {
            // Default Enter sends as steer if available, else followup
            sendQueued(onSteer ? "steer" : "followup");
          } else {
            handleSend();
          }
        }
      },
      [
        isStreaming,
        planMode,
        onSteer,
        onFollowUp,
        slashMenuOpen,
        slashQuery,
        filteredSlashCommands,
        slashActiveIndex,
        applySlashCommand,
        sendQueued,
        handleSend,
        getNextSlashIndex,
        atMenuOpen,
        atQuery,
        atMatches,
        atActiveIndex,
        applyAtCompletion,
        setAtActiveIndex,
        setAtMenuOpen,
      ],
    );

    const handleInput = useCallback(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }, []);

    const handlePaste = useCallback(
      (e: React.ClipboardEvent) => {
        const items = Array.from(e.clipboardData?.items ?? []);
        const imageItems = items.filter((item) => item.type.startsWith("image/"));
        if (!imageItems.length) return;
        e.preventDefault();
        const files = imageItems
          .map((item) => item.getAsFile())
          .filter((f): f is File => f !== null);
        processImageFiles(files);
      },
      [processImageFiles],
    );

    useEffect(() => {
      if (slashQuery === null) {
        setSlashMenuOpen(false);
        setSlashActiveIndex(0);
        slashCommandsRequestedRef.current = false;
        return;
      }
      setSlashMenuOpen(true);
      setSlashActiveIndex(0);
      if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
        slashCommandsRequestedRef.current = true;
        Promise.resolve(onLoadSlashCommands()).catch(() => {
          slashCommandsRequestedRef.current = false;
        });
      }
    }, [slashQuery, onLoadSlashCommands]);

    useEffect(() => {
      if (slashActiveIndex >= filteredSlashCommands.length) {
        setSlashActiveIndex(Math.max(0, filteredSlashCommands.length - 1));
      }
    }, [filteredSlashCommands.length, slashActiveIndex]);

    useEffect(() => {
      slashItemRefs.current.length = filteredSlashCommands.length;
    }, [filteredSlashCommands.length]);

    useEffect(() => {
      if (!slashMenuOpen) return;
      slashItemRefs.current[slashActiveIndex]?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }, [slashActiveIndex, slashMenuOpen]);

    // Build model options: prefer modelList (has provider info), fallback to modelNames
    const modelOptions: ModelOption[] = useMemo(() => {
      if (modelList && modelList.length > 0) {
        return modelList
          .map((m) => ({ provider: m.provider, modelId: m.id, name: m.name }))
          .sort(compareModelOptions);
      }
      return Object.entries(modelNames ?? {})
        .map(([modelId, name]) => ({
          provider: model?.provider ?? "unknown",
          modelId,
          name,
        }))
        .sort(compareModelOptions);
    }, [modelList, modelNames, model?.provider]);

    // Group options by provider, preserving insertion order
    const modelsByProvider = useMemo(() => {
      const result: Array<{ provider: string; options: ModelOption[] }> = [];
      for (const opt of modelOptions) {
        const group = result.find((g) => g.provider === opt.provider);
        if (group) group.options.push(opt);
        else result.push({ provider: opt.provider, options: [opt] });
      }
      return result;
    }, [modelOptions]);

    const displayModelName = model
      ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)
          ?.name ?? model.modelId)
      : null;
    const currentName = displayModelName;

    const compactSavedTokens =
      compactResult && compactResult.estimatedTokensAfter !== undefined
        ? Math.max(0, compactResult.tokensBefore - compactResult.estimatedTokensAfter)
        : 0;
    const compactVerb =
      compactResult?.reason && compactResult.reason !== "manual"
        ? t("input.compactedReason", {
            reason: `${compactResult.reason[0].toUpperCase()}${compactResult.reason.slice(1)}`,
          })
        : t("input.compacted");
    const compactResultText = compactResult
      ? t("input.compactResult", {
          verb: compactVerb,
          before: formatTokenCount(compactResult.tokensBefore),
          after:
            compactResult.estimatedTokensAfter !== undefined
              ? formatTokenCount(compactResult.estimatedTokensAfter)
              : "...",
          saved: compactSavedTokens > 0 ? formatTokenCount(compactSavedTokens) : "0",
        })
      : null;
    const thinkingDisplayLabel = (() => {
      const lvl = thinkingLevel ?? "auto";
      if (lvl === "auto" || !thinkingLevelMap) return lvl;
      return thinkingLevelMap[lvl] ?? lvl;
    })();
    const toolPresetLabel =
      Object.entries(TOOL_PRESET_MAP).find(([, v]) => v === (toolPreset ?? "default"))?.[0] ??
      "default";
    // Button label for the per-tool panel: "Tools: 4/7" (active/total). Falls back
    // to the preset label when the per-tool list isn't available.
    const toolsLabel =
      tools && tools.length > 0
        ? t("input.toolsCount", {
            active: tools.filter((x) => x.active).length,
            total: tools.length,
          })
        : toolPresetLabel;

    // Close dropdowns on outside click
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (
          dropdownRef.current &&
          !dropdownRef.current.contains(e.target as Node) &&
          modelDropdownPanelRef.current &&
          !modelDropdownPanelRef.current.contains(e.target as Node)
        ) {
          setModelDropdownOpen(false);
        }
        if (toolDropdownRef.current && !toolDropdownRef.current.contains(e.target as Node)) {
          setToolDropdownOpen(false);
        }
        if (
          thinkingDropdownRef.current &&
          !thinkingDropdownRef.current.contains(e.target as Node)
        ) {
          setThinkingDropdownOpen(false);
        }
        if (controlsMenuRef.current && !controlsMenuRef.current.contains(e.target as Node)) {
          setControlsMenuOpen(false);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, []);

    useEffect(() => {
      if (!isMobile) setControlsMenuOpen(false);
    }, [isMobile]);

    return (
      <div
        style={{
          flexShrink: 0,
          background: "transparent",
          padding: "0 16px 8px",
          paddingRight: isMobile ? 16 : 52, // desktop: 16px base + 36px for ChatMinimap alignment
        }}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          disabled={isStreaming}
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            processImageFiles(files);
            e.target.value = "";
          }}
        />
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          {/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
          {(queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0) > 0 && (
            <div
              style={{
                marginBottom: 8,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg-panel)",
                padding: "5px 0",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "2px 8px 4px 10px",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-dim)",
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  {t("input.queued", {
                    count:
                      (queuedMessages?.steering.length ?? 0) +
                      (queuedMessages?.followUp.length ?? 0),
                  })}
                </span>
                {onRecallQueue && (
                  <button
                    onClick={onRecallQueue}
                    title={t("input.recallHint")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 12px",
                      fontSize: 12,
                      color: "var(--text)",
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: 7,
                      cursor: "pointer",
                      transition: "background 0.12s, border-color 0.12s",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--bg-hover)";
                      e.currentTarget.style.borderColor =
                        "color-mix(in srgb, var(--accent) 45%, var(--border))";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.borderColor = "var(--border)";
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 14 4 9 9 4" />
                      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                    </svg>
                    {t("input.recallToInput")}
                  </button>
                )}
              </div>
              {queuedMessages?.steering.map((text, i) => (
                <QueuedMessageRow
                  key={`steer-${i}`}
                  kind="steer"
                  label={t("input.ster")}
                  text={text}
                />
              ))}
              {queuedMessages?.followUp.map((text, i) => (
                <QueuedMessageRow
                  key={`followup-${i}`}
                  kind="follow-up"
                  label={t("input.followUp")}
                  text={text}
                />
              ))}
            </div>
          )}
          {/* Retry banner */}
          {retryInfo && (
            <div
              style={{
                marginBottom: 8,
                padding: "5px 10px",
                background: "rgba(234,179,8,0.08)",
                border: "1px solid rgba(234,179,8,0.25)",
                borderRadius: 6,
                fontSize: 12,
                color: "rgba(180,130,0,0.9)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              {t("input.retrying", { attempt: retryInfo.attempt, max: retryInfo.maxAttempts })}…
              {retryInfo.errorMessage && (
                <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>
              )}
            </div>
          )}
          {compactResultText && (
            <div
              style={{
                marginBottom: 8,
                padding: "5px 10px",
                background: "rgba(16,185,129,0.08)",
                border: "1px solid rgba(16,185,129,0.24)",
                borderRadius: 6,
                fontSize: 12,
                color: "rgba(5,150,105,0.95)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {compactResultText}
            </div>
          )}
          {/* Image previews */}
          {attachedImages.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
              {attachedImages.map((img, i) => (
                <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.previewUrl}
                    alt=""
                    style={{
                      width: 56,
                      height: 56,
                      objectFit: "cover",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      display: "block",
                    }}
                  />
                  <button
                    onClick={() => removeImage(i)}
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -4,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: "var(--bg-panel)",
                      border: "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      padding: 0,
                      color: "var(--text-muted)",
                    }}
                  >
                    <svg
                      width="8"
                      height="8"
                      viewBox="0 0 8 8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    >
                      <line x1="1" y1="1" x2="7" y2="7" />
                      <line x1="7" y1="1" x2="1" y2="7" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Main input */}
          <div style={{ position: "relative" }}>
            {slashMenuOpen && (
              <SlashCommandPanel
                slashQuery={slashQuery}
                groupedSlashCommands={groupedSlashCommands}
                slashActiveIndex={slashActiveIndex}
                slashItemRefs={slashItemRefs}
                slashCommandsLoading={slashCommandsLoading}
                slashCommandCountLabel={slashCommandCountLabel}
                filteredCount={filteredSlashCommands.length}
                applySlashCommand={applySlashCommand}
                setSlashActiveIndex={setSlashActiveIndex}
                t={t}
              />
            )}
            {atMenuOpen && (
              <AtFilePanel
                atQuery={atQuery}
                atMatches={atMatches}
                atActiveIndex={atActiveIndex}
                atItemRefs={atItemRefs}
                fileIndexLoading={fileIndexLoading}
                fileIndex={fileIndex}
                cwd={cwd}
                needsServerSearch={needsServerSearch}
                serverResultInUse={serverResultInUse}
                applyAtCompletion={applyAtCompletion}
                setAtActiveIndex={setAtActiveIndex}
                t={t}
              />
            )}
            <div
              style={
                {
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  background: "var(--bg)",
                  border: `1px solid ${
                    isStreaming && (onSteer || onFollowUp)
                      ? "rgba(234,179,8,0.4)"
                      : "color-mix(in srgb, var(--border) 70%, transparent)"
                  }`,
                  borderRadius: 14,
                  padding: "10px 10px 10px 14px",
                  boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)",
                  transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
                } as React.CSSProperties
              }
            >
              <textarea
                ref={textareaRef}
                data-chat-input-textarea
                aria-label={t("input.label")}
                aria-autocomplete="list"
                aria-haspopup="listbox"
                role="combobox"
                aria-expanded={atMenuOpen || slashMenuOpen ? "true" : "false"}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  updateAtQuery(e.target.value, e.target.selectionStart);
                  // User started editing manually — the undo affordance no
                  // longer applies.
                  if (showUndo) cancelUndo();
                }}
                onSelect={(e) => {
                  const el = e.currentTarget;
                  updateAtQuery(el.value, el.selectionStart);
                  persistCursor();
                }}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={(e) => {
                  isComposingRef.current = false;
                  lastCompositionEndAtRef.current = Date.now();
                  const el = e.currentTarget;
                  updateAtQuery(el.value, el.selectionStart);
                }}
                onInput={handleInput}
                onPaste={handlePaste}
                placeholder={
                  planMode
                    ? orchestratorId
                      ? t("plan.placeholderFeedback")
                      : t("plan.placeholderRequirement")
                    : isStreaming && (onSteer || onFollowUp)
                      ? t("input.placeholderSteer")
                      : isStreaming
                        ? t("input.placeholderRunning")
                        : t("input.placeholderIdle")
                }
                rows={1}
                style={{
                  flex: 1,
                  background: "none",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  color: "var(--text)",
                  fontSize: 14,
                  lineHeight: 1.6,
                  fontFamily: "inherit",
                  minHeight: 24,
                  maxHeight: 200,
                  overflow: "auto",
                }}
              />

              {/* 流控解耦：plan 模式始终显示发送按钮（受 planBusy 控制），
                  普通模式流式输出时才切换为 steer/followUp 队列按钮。 */}
              {isStreaming && !planMode ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexShrink: 0,
                    alignSelf: "flex-end",
                  }}
                >
                  {onSteer && (
                    <button
                      onClick={() => sendQueued("steer")}
                      disabled={!canQueueStreamingMessage}
                      title={attachedImages.length ? t("input.imageNoQueue") : t("input.steerHint")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "7px 12px",
                        background: canQueueStreamingMessage ? "rgba(234,179,8,0.12)" : "none",
                        border: "1px solid rgba(234,179,8,0.35)",
                        borderRadius: 8,
                        color: canQueueStreamingMessage ? "rgba(180,130,0,1)" : "var(--text-dim)",
                        cursor: canQueueStreamingMessage ? "pointer" : "not-allowed",
                        fontSize: 13,
                        fontWeight: 600,
                        letterSpacing: "-0.01em",
                        transition: "background 0.12s",
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 10 10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 1 L9 5 L5 9" />
                        <line x1="1" y1="5" x2="9" y2="5" />
                      </svg>
                      {t("input.ster")}
                    </button>
                  )}
                  {onFollowUp && (
                    <button
                      onClick={() => sendQueued("followup")}
                      disabled={!canQueueStreamingMessage}
                      title={
                        attachedImages.length ? t("input.imageNoQueue") : t("input.followUpHint")
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "7px 12px",
                        background: canQueueStreamingMessage ? "rgba(129,140,248,0.12)" : "none",
                        border: "1px solid rgba(129,140,248,0.35)",
                        borderRadius: 8,
                        color: canQueueStreamingMessage ? "rgba(99,102,241,1)" : "var(--text-dim)",
                        cursor: canQueueStreamingMessage ? "pointer" : "not-allowed",
                        fontSize: 13,
                        fontWeight: 600,
                        letterSpacing: "-0.01em",
                        transition: "background 0.12s",
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 10 10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="5" y1="1" x2="5" y2="6" />
                        <polyline points="2.5 3.5 5 1 7.5 3.5" />
                        <line x1="2" y1="9" x2="8" y2="9" />
                      </svg>
                      {t("input.followUp")}
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={
                    planMode
                      ? !value.trim() ||
                        planBusy ||
                        (orchestratorId != null && planStatus !== "awaiting_confirm")
                      : !value.trim() && !attachedImages.length
                  }
                  style={{
                    flexShrink: 0,
                    alignSelf: "flex-end",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "7px 14px",
                    background:
                      value.trim() || attachedImages.length ? "var(--accent)" : "var(--bg-panel)",
                    border: "none",
                    borderRadius: 8,
                    color: value.trim() || attachedImages.length ? "#fff" : "var(--text-dim)",
                    cursor: value.trim() || attachedImages.length ? "pointer" : "not-allowed",
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                    boxShadow:
                      value.trim() || attachedImages.length
                        ? "0 1px 3px rgba(37,99,235,0.25)"
                        : "none",
                    transition: "background 0.15s, box-shadow 0.15s",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="2" y1="7" x2="11" y2="7" />
                    <polyline points="7.5 3 12 7 7.5 11" />
                  </svg>
                  {t("input.send")}
                </button>
              )}
            </div>
          </div>

          {enhanceError && (
            <div
              style={{
                marginBottom: 6,
                fontSize: 12,
                color: "#ef4444",
                display: "flex",
                alignItems: "center",
                gap: 4,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontWeight: 600 }}>{t("input.enhanceError")}:</span>
              <span style={{ color: "var(--text-muted)" }}>{enhanceError}</span>
            </div>
          )}

          {planMode && planError && (
            <div
              style={{
                marginBottom: 6,
                fontSize: 12,
                color: "#ef4444",
                display: "flex",
                alignItems: "center",
                gap: 4,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontWeight: 600 }}>{t("plan.error")}:</span>
              <span style={{ color: "var(--text-muted)" }}>{planError}</span>
            </div>
          )}

          {/* Bottom bar: left | center (context) | right */}
          <div
            style={{
              marginTop: 8,
              display: isMobile ? "grid" : "flex",
              gridTemplateColumns: isMobile ? "minmax(0, 1fr) auto" : undefined,
              alignItems: "center",
              gap: 6,
            }}
          >
            {/* LEFT: attach + model selector (idle) or steer/followup toggle (streaming) */}
            <div
              style={{
                flex: isMobile ? "1 1 auto" : "0 0 auto",
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 2,
              }}
            >
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
                title={t("input.attachImage")}
                style={{
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  padding: 0,
                  background: "none",
                  border: "none",
                  borderRadius: 9,
                  color: attachedImages.length ? "var(--accent)" : "var(--text-muted)",
                  cursor: isStreaming ? "not-allowed" : "pointer",
                  opacity: isStreaming ? 0.5 : 1,
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (isStreaming) return;
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = attachedImages.length
                    ? "var(--accent)"
                    : "var(--text)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = attachedImages.length
                    ? "var(--accent)"
                    : "var(--text-muted)";
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </button>
              {showUndo ? (
                <button
                  onClick={handleEnhanceUndo}
                  title={t("input.enhanceUndo")}
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    height: 32,
                    padding: "0 10px",
                    background: "none",
                    border: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
                    borderRadius: 9,
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    transition: "background 0.12s, color 0.12s",
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
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 7v6h6" />
                    <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
                  </svg>
                  {t("input.enhanceUndo")}
                </button>
              ) : (
                <button
                  onClick={handleEnhance}
                  disabled={isStreaming || enhancing || !value.trim()}
                  title={enhancing ? t("input.enhancing") : t("input.enhanceTooltip")}
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    height: 32,
                    padding: "0 10px",
                    background: enhancing ? "var(--bg-hover)" : "none",
                    border: `1px solid ${
                      isStreaming || !value.trim()
                        ? "color-mix(in srgb, var(--border) 70%, transparent)"
                        : "color-mix(in srgb, var(--accent) 45%, transparent)"
                    }`,
                    borderRadius: 9,
                    color: isStreaming || !value.trim() ? "var(--text-dim)" : "var(--accent)",
                    cursor: isStreaming || enhancing || !value.trim() ? "not-allowed" : "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    opacity: isStreaming || !value.trim() ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s, border-color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming || !value.trim()) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = enhancing ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color =
                      isStreaming || !value.trim() ? "var(--text-dim)" : "var(--accent)";
                  }}
                >
                  {enhancing ? (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      style={{ animation: "spin 0.8s linear infinite" }}
                    >
                      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
                    </svg>
                  ) : (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 3l1.9 4.6L18.5 9.5 14 11.4 12 16l-2-4.6L5.5 9.5 10.1 7.6 12 3z" />
                      <path d="M19 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
                    </svg>
                  )}
                  {t(enhancing ? "input.enhancing" : "input.enhance")}
                </button>
              )}
              {/* 计划模式开关：进入/退出多 Agent 协同讨论 */}
              <button
                onClick={() => setPlanMode(!planMode)}
                title={planMode ? t("plan.exit") : t("plan.enter")}
                style={{
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  height: 32,
                  padding: "0 10px",
                  background: planMode ? "var(--accent)" : "none",
                  border: `1px solid ${
                    planMode
                      ? "var(--accent)"
                      : "color-mix(in srgb, var(--border) 70%, transparent)"
                  }`,
                  borderRadius: 9,
                  color: planMode ? "#fff" : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (planMode) return;
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(e) => {
                  if (planMode) return;
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 11l3 3 8-8" />
                  <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
                </svg>
                {t("plan.mode")}
              </button>
              {/* Model selector — visible always, disabled during streaming */}
              {modelOptions.length > 0 && currentName && onModelChange && (
                <div
                  ref={dropdownRef}
                  style={{
                    position: "relative",
                    flex: isMobile ? "1 1 auto" : undefined,
                    minWidth: 0,
                  }}
                >
                  <button
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setModelDropdownRect({ top: rect.top, left: rect.left, width: rect.width });
                      setModelDropdownOpen((v) => !v);
                    }}
                    disabled={isStreaming}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      justifyContent: isMobile ? "flex-start" : undefined,
                      padding: isMobile ? "8px 10px" : "8px 12px",
                      height: 32,
                      width: isMobile ? "100%" : undefined,
                      maxWidth: isMobile ? "100%" : 220,
                      overflow: "hidden",
                      background: modelDropdownOpen ? "var(--bg-hover)" : "none",
                      border: "none",
                      borderRadius: 9,
                      color: "var(--text-muted)",
                      cursor: isStreaming ? "not-allowed" : "pointer",
                      fontSize: 12,
                      opacity: isStreaming ? 0.5 : 1,
                      transition: "background 0.12s, color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      if (isStreaming) return;
                      e.currentTarget.style.background = "var(--bg-hover)";
                      e.currentTarget.style.color = "var(--text)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = modelDropdownOpen
                        ? "var(--bg-hover)"
                        : "none";
                      e.currentTarget.style.color = "var(--text-muted)";
                    }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
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
                    </svg>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                      }}
                    >
                      {currentName}
                    </span>
                  </button>
                  {modelDropdownOpen && modelDropdownRect && (
                    <ModelDropdownPanel
                      dropdownRect={modelDropdownRect}
                      modelsByProvider={modelsByProvider}
                      currentModel={model}
                      isAutoModelSelection={isAutoModelSelection}
                      isMobile={isMobile}
                      onModelChange={onModelChange}
                      onClose={() => setModelDropdownOpen(false)}
                      panelRef={modelDropdownPanelRef}
                    />
                  )}
                </div>
              )}
            </div>

            {/* spacer */}
            {!isMobile && <div style={{ flex: 1 }} />}

            {/* RIGHT: thinking + tools preset + compact + sound (idle) | Stop + sound (streaming) */}
            <div
              ref={controlsMenuRef}
              style={{
                flex: "0 0 auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                position: "relative",
                marginLeft: isMobile ? 0 : "auto",
              }}
            >
              {isMobile && (
                <button
                  type="button"
                  title={controlsMenuOpen ? undefined : t("input.moreControls")}
                  aria-label={t("input.moreControls")}
                  aria-expanded={controlsMenuOpen}
                  aria-hidden={controlsMenuOpen || undefined}
                  tabIndex={controlsMenuOpen ? -1 : undefined}
                  onClick={() => {
                    setModelDropdownOpen(false);
                    setControlsMenuOpen(true);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "100%",
                    height: 32,
                    padding: "8px 10px",
                    background: "none",
                    border: "none",
                    borderRadius: 9,
                    color: "var(--text-muted)",
                    cursor: controlsMenuOpen ? "default" : "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                    visibility: controlsMenuOpen ? "hidden" : "visible",
                    pointerEvents: controlsMenuOpen ? "none" : "auto",
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (controlsMenuOpen) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    if (controlsMenuOpen) return;
                    e.currentTarget.style.background = "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  {t("input.more")}
                </button>
              )}
              <div
                style={{
                  display: isMobile ? (controlsMenuOpen ? "flex" : "none") : "flex",
                  alignItems: "center",
                  gap: isMobile ? 1 : 2,
                  ...(isMobile
                    ? {
                        position: "absolute",
                        right: 0,
                        bottom: 0,
                        zIndex: 60,
                        padding: 1,
                        width: "max-content",
                        maxWidth: "calc(100vw - 32px)",
                        flexWrap: "nowrap",
                        justifyContent: "flex-end",
                        border: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
                        borderRadius: 10,
                        background: "color-mix(in srgb, var(--bg-panel) 92%, var(--bg))",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
                        backdropFilter: "blur(10px)",
                      }
                    : null),
                }}
              >
                {!isStreaming && onThinkingLevelChange && (
                  <ThinkingLevelDropdown
                    thinkingLevel={thinkingLevel}
                    dropdownOpen={thinkingDropdownOpen}
                    thinkingDisplayLabel={thinkingDisplayLabel}
                    availableThinkingLevels={availableThinkingLevels}
                    thinkingLevelMap={thinkingLevelMap}
                    isStreaming={isStreaming}
                    controlsMenuOpen={controlsMenuOpen}
                    onThinkingLevelChange={onThinkingLevelChange}
                    onToggle={setThinkingDropdownOpen}
                    dropdownRef={thinkingDropdownRef}
                    t={t}
                  />
                )}
                {!isStreaming && (onToolsChange || onToolPresetChange) && (
                  <ToolPresetDropdown
                    tools={tools}
                    toolPreset={toolPreset}
                    toolsLabel={toolsLabel}
                    isStreaming={isStreaming}
                    controlsMenuOpen={controlsMenuOpen}
                    dropdownOpen={toolDropdownOpen}
                    onToolsChange={onToolsChange}
                    onToolPresetChange={onToolPresetChange}
                    onToggle={setToolDropdownOpen}
                    dropdownRef={toolDropdownRef}
                    t={t}
                  />
                )}

                {!isStreaming && onCompact && (
                  <div style={{ position: "relative" }}>
                    {compactError && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "calc(100% + 6px)",
                          right: 0,
                          background: "var(--tool-bg)",
                          color: "var(--color-error-soft)",
                          fontSize: 11,
                          padding: "4px 8px",
                          borderRadius: 5,
                          whiteSpace: "nowrap",
                          pointerEvents: "none",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                          zIndex: 50,
                        }}
                      >
                        {compactError}
                      </div>
                    )}
                    <button
                      onClick={isCompacting ? onAbortCompaction : onCompact}
                      disabled={isStreaming && !isCompacting}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 5,
                        padding: isMobile ? "0 6px" : "8px 12px",
                        width: isMobile ? "auto" : undefined,
                        height: 32,
                        background: isCompacting ? "rgba(239,68,68,0.08)" : "none",
                        border: "none",
                        borderRadius: 9,
                        color: isCompacting ? "#ef4444" : "var(--text-muted)",
                        cursor: isStreaming && !isCompacting ? "not-allowed" : "pointer",
                        fontSize: 12,
                        opacity: isStreaming && !isCompacting ? 0.5 : 1,
                        transition: "background 0.12s, color 0.12s",
                      }}
                      onMouseEnter={(e) => {
                        if (isStreaming && !isCompacting) return;
                        e.currentTarget.style.background = isCompacting
                          ? "rgba(239,68,68,0.16)"
                          : "var(--bg-hover)";
                        e.currentTarget.style.color = isCompacting ? "#ef4444" : "var(--text)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = isCompacting
                          ? "rgba(239,68,68,0.08)"
                          : "none";
                        e.currentTarget.style.color = isCompacting
                          ? "#ef4444"
                          : "var(--text-muted)";
                      }}
                      title={isCompacting ? t("input.stopCompaction") : t("input.compactContext")}
                      aria-label={
                        isCompacting ? t("input.stopCompaction") : t("input.compactContext")
                      }
                    >
                      {isCompacting ? (
                        <>
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" />
                          </svg>
                          {(!isMobile || controlsMenuOpen) && (
                            <span style={{ whiteSpace: "nowrap" }}>Compacting…</span>
                          )}
                        </>
                      ) : (
                        <>
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="4 14 10 14 10 20" />
                            <polyline points="20 10 14 10 14 4" />
                            <line x1="10" y1="14" x2="3" y2="21" />
                            <line x1="21" y1="3" x2="14" y2="10" />
                          </svg>
                          {(!isMobile || controlsMenuOpen) && (
                            <span style={{ whiteSpace: "nowrap" }}>Compact</span>
                          )}
                        </>
                      )}
                    </button>
                  </div>
                )}

                {isStreaming && (
                  <button
                    onClick={() => {
                      if (stopConfirming) {
                        // Second click — actually abort
                        if (stopConfirmTimeoutRef.current)
                          clearTimeout(stopConfirmTimeoutRef.current);
                        setStopConfirming(false);
                        onAbort();
                      } else {
                        // First click — arm confirmation state
                        setStopConfirming(true);
                        stopConfirmTimeoutRef.current = setTimeout(
                          () => setStopConfirming(false),
                          2_500,
                        );
                      }
                    }}
                    onMouseLeave={(e) => {
                      // Reset confirm state if the user hovers away
                      if (stopConfirming && stopConfirmTimeoutRef.current) {
                        clearTimeout(stopConfirmTimeoutRef.current);
                        setStopConfirming(false);
                      }
                      // Restore background on hover out (non-confirming)
                      if (!stopConfirming) {
                        e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                      }
                    }}
                    title={stopConfirming ? t("input.stopConfirm") : t("input.stopAgent")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 14px",
                      height: 32,
                      background: stopConfirming
                        ? "var(--color-error-soft)"
                        : "rgba(239,68,68,0.08)",
                      border: stopConfirming
                        ? "1px solid var(--color-error-soft)"
                        : "1px solid rgba(239,68,68,0.3)",
                      borderRadius: 9,
                      color: stopConfirming ? "#fff" : "#ef4444",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      letterSpacing: "-0.01em",
                      transition: "background 0.12s, border-color 0.12s, color 0.12s",
                      animation: stopConfirming
                        ? "pulse 0.6s ease-in-out infinite alternate"
                        : "none",
                    }}
                    onMouseEnter={(e) => {
                      if (stopConfirming) return;
                      e.currentTarget.style.background = "rgba(239,68,68,0.16)";
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" />
                    </svg>
                    {stopConfirming ? t("input.stopConfirm") : "Stop"}
                  </button>
                )}

                {onSoundToggle !== undefined && (
                  <button
                    onClick={onSoundToggle}
                    title={soundEnabled ? t("input.disableSound") : t("input.enableSound")}
                    aria-label={soundEnabled ? t("input.disableSound") : t("input.enableSound")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 5,
                      width: isMobile ? 32 : 32,
                      height: 32,
                      padding: 0,
                      background: "none",
                      border: "none",
                      borderRadius: 9,
                      color: soundEnabled ? "var(--text-muted)" : "var(--text-dim)",
                      cursor: "pointer",
                      opacity: soundEnabled ? 1 : 0.55,
                      transition: "background 0.12s, color 0.12s, opacity 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--bg-hover)";
                      e.currentTarget.style.color = "var(--text)";
                      e.currentTarget.style.opacity = "1";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "none";
                      e.currentTarget.style.color = soundEnabled
                        ? "var(--text-muted)"
                        : "var(--text-dim)";
                      e.currentTarget.style.opacity = soundEnabled ? "1" : "0.55";
                    }}
                  >
                    {soundEnabled ? (
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
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                      </svg>
                    ) : (
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
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <line x1="23" y1="9" x2="17" y2="15" />
                        <line x1="17" y1="9" x2="23" y2="15" />
                      </svg>
                    )}
                  </button>
                )}
                {isMobile && controlsMenuOpen && (
                  <button
                    type="button"
                    title={t("input.collapseControls")}
                    aria-label={t("input.collapseControls")}
                    aria-expanded={true}
                    onClick={() => {
                      setToolDropdownOpen(false);
                      setThinkingDropdownOpen(false);
                      setControlsMenuOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 36,
                      height: 32,
                      padding: 0,
                      marginLeft: 0,
                      background: "var(--bg-hover)",
                      border: "none",
                      borderLeft: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
                      borderRadius: "0 9px 9px 0",
                      color: "var(--text)",
                      cursor: "pointer",
                      transition: "background 0.12s, color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--bg-selected)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--bg-hover)";
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }),
);
