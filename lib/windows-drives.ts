import { stat } from "fs/promises";

export interface BrowsableDirectory {
  name: string;
  path: string;
}

// 仅在 Windows 且未提供初始目录时，才展示盘符选择器（F3 纯函数，仅移植逻辑，UI 接入留专项）。
export function shouldShowWindowsDrivePicker(
  directory?: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" && !directory;
}

export function getWindowsDriveCandidates(): BrowsableDirectory[] {
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => ({
    name: `${letter}:`,
    path: `${letter}:\\`,
  }));
}

export async function listWindowsDrives(): Promise<BrowsableDirectory[]> {
  const candidates = await Promise.all(
    getWindowsDriveCandidates().map(async (drive) => {
      try {
        const driveStat = await stat(drive.path);
        return driveStat.isDirectory() ? drive : null;
      } catch {
        return null;
      }
    }),
  );
  return candidates.filter((drive): drive is BrowsableDirectory => drive !== null);
}
