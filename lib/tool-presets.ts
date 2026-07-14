export interface ToolEntry {
  name: string;
  description: string;
  active: boolean;
}

export type ToolPreset = "none" | "default" | "full";

export const PRESET_NONE: string[] = [];
export const PRESET_DEFAULT: string[] = ["read", "bash", "edit", "write"];
export const PRESET_FULL: string[] = ["bash", "read", "edit", "write", "grep", "find", "ls"];

/** Names of the built-in coding tools — everything else is an extension tool. */
export const BUILTIN_TOOL_NAMES = new Set(PRESET_FULL);

/**
 * Return the active tool names from a list of ToolEntry. Used by the per-tool
 * config panel: the UI passes the full list (with toggled `active` flags) and
 * this extracts just the enabled names for set_tools / new-session creation.
 */
export function toolsToToolNames(tools: ToolEntry[]): string[] {
  return tools.filter((t) => t.active).map((t) => t.name);
}

/**
 * Build a default ToolEntry[] for new sessions (before get_tools is available).
 * Starts from the DEFAULT preset (read/bash/edit/write active); extension tools
 * are discovered and merged in after the session is created, via loadTools().
 */
export function defaultToolEntries(): ToolEntry[] {
  const active = new Set(PRESET_DEFAULT);
  return PRESET_FULL.map((name) => ({
    name,
    description: "",
    active: active.has(name),
  }));
}

export function getPresetFromTools(tools: ToolEntry[]): ToolPreset {
  const activeTools = tools.filter((t) => t.active);
  if (activeTools.length === 0) return "none";

  const active = activeTools
    .map((t) => t.name)
    .filter((name) => BUILTIN_TOOL_NAMES.has(name))
    .sort()
    .join(",");

  if (active === [...PRESET_DEFAULT].sort().join(",")) return "default";
  if (active === [...PRESET_FULL].sort().join(",")) return "full";
  return "default";
}

export function getToolNamesForPreset(preset: ToolPreset): string[] {
  if (preset === "none") return [...PRESET_NONE];
  if (preset === "full") return [...PRESET_FULL];
  return [...PRESET_DEFAULT];
}

/**
 * Apply a preset's tool-name set to the current tool list, preserving the list
 * shape and order. Tools named in `activeNames` become active, others inactive.
 */
export function applyPresetToTools(tools: ToolEntry[], activeNames: string[]): ToolEntry[] {
  const active = new Set(activeNames);
  return tools.map((tool) => ({ ...tool, active: active.has(tool.name) }));
}
