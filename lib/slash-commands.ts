import type { SlashCommandInfo } from "@/hooks/useAgentSession";

export type SlashCommandPaletteItem =
  | SlashCommandInfo
  | {
      name: string;
      description: string;
      source: "builtin";
    };

export type SlashCommandSource = SlashCommandPaletteItem["source"];

/** Built-in slash commands — descriptions are localized at call time. */
export function buildBuiltinSlashCommands(t: (key: string) => string): SlashCommandPaletteItem[] {
  return [
    { name: "compact", description: t("slash.compact"), source: "builtin" },
    { name: "reload", description: t("slash.reload"), source: "builtin" },
    { name: "name", description: t("slash.name"), source: "builtin" },
    { name: "session", description: t("slash.session"), source: "builtin" },
    { name: "copy", description: t("slash.copy"), source: "builtin" },
  ];
}

export const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];

export const SLASH_SOURCE_GROUP_LABEL: Record<SlashCommandSource, string> = {
  builtin: "slashGroup.builtin",
  extension: "slashGroup.extension",
  prompt: "slashGroup.prompt",
  skill: "slashGroup.skill",
};

export const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
};

export function slashMatchRank(command: SlashCommandPaletteItem, query: string): number {
  const name = command.name.toLowerCase();
  const description = command.description?.toLowerCase() ?? "";
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}
