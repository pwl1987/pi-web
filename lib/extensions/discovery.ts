// Server-side extension discovery.
//
// Scans two roots for extension packages:
// 1. Bundled: <repoRoot>/extensions/  (shipped with pi-web, source="bundled")
// 2. Local:   ~/.pi-web/extensions/   (user-installed, symlinks for dev, source="local")
//
// Each extension dir must have a package.json with:
//   { "piWeb": { "extensions": [{ "id": "my-ext", "module": "index.js" }] } }
//
// The module path must be a safe relative path within the package dir (no "..",
// no absolute). The file must exist and be a file (not directory).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve, relative, isAbsolute } from "path";
import type { ExtensionManifest, ExtensionManifestEntry, ExtensionRecord, ExtensionSource } from "./types";

/** Get the user-level extensions dir (~/.pi-web/extensions/). */
export function getExtensionsDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return join(home, ".pi-web", "extensions");
}

/** Get the bundled extensions dir (<repoRoot>/extensions/). */
function getBundledDir(): string {
  // In dev, process.cwd() is the repo root. In production (next start), it's
  // also the repo root. __dirname is unreliable because Next.js compiles to .next/.
  return resolve(process.cwd(), "extensions");
}

/** Safe relative path check: no "..", not absolute, non-empty. */
function isSafeRelativePath(p: string): boolean {
  if (!p || isAbsolute(p) || p.includes("..")) return false;
  return true;
}

interface RawExtensionEntry {
  id: string;
  module: string;
}

/** Parse piWeb.extensions from a package.json. Returns [] if none/invalid. */
function parseExtensionEntries(pkgPath: string): RawExtensionEntry[] {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const entries = pkg?.piWeb?.extensions;
    if (!Array.isArray(entries)) return [];
    return entries.filter(
      (e): e is RawExtensionEntry =>
        typeof e === "object" && e !== null &&
        typeof e.id === "string" && typeof e.module === "string",
    );
  } catch {
    return [];
  }
}

/** Read extension enabled state from ~/.pi-web/config.json. */
function readEnabledState(): Record<string, boolean> {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const configPath = join(home, ".pi-web", "config.json");
    if (!existsSync(configPath)) return {};
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const ext = config?.extensions;
    if (typeof ext !== "object" || ext === null) return {};
    const result: Record<string, boolean> = {};
    for (const [id, val] of Object.entries(ext)) {
      if (typeof val === "object" && val !== null && typeof (val as { enabled?: unknown }).enabled === "boolean") {
        result[id] = (val as { enabled: boolean }).enabled;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Write extension enabled state to ~/.pi-web/config.json. */
export function setExtensionEnabled(id: string, enabled: boolean): void {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const configDir = join(home, ".pi-web");
  const configPath = join(configDir, "config.json");

  let config: Record<string, unknown> = {};
  try {
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, "utf8"));
    }
  } catch { /* start fresh */ }

  const ext = (config.extensions ?? {}) as Record<string, { enabled?: boolean; settings?: unknown }>;
  ext[id] = { ...ext[id], enabled };
  config.extensions = ext;

  try {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  } catch { /* best-effort */ }
}

/** Scan a single root dir for extension packages. */
function scanRoot(rootDir: string, source: ExtensionSource): ExtensionRecord[] {
  const records: ExtensionRecord[] = [];
  if (!existsSync(rootDir)) return records;

  let entries: string[];
  try {
    entries = readdirSync(rootDir);
  } catch {
    return records;
  }

  for (const name of entries) {
    const dir = join(rootDir, name);
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    if (!statSync(dir).isDirectory()) continue;

    const pkgEntries = parseExtensionEntries(pkgPath);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const pkgName = typeof pkg?.name === "string" ? pkg.name : undefined;

    for (const entry of pkgEntries) {
      if (!isSafeRelativePath(entry.module)) continue;
      const modulePath = resolve(dir, entry.module);
      if (!existsSync(modulePath) || !statSync(modulePath).isFile()) continue;

      const version = Math.floor(statSync(modulePath).mtimeMs);
      records.push({
        id: entry.id,
        modulePath,
        moduleRelative: entry.module,
        source,
        dir,
        name: pkgName,
        version,
      });
    }
  }

  return records;
}

/** Discover all extensions from all roots. Deduplicates by id (first wins). */
export function discoverExtensions(): ExtensionRecord[] {
  const bundled = scanRoot(getBundledDir(), "bundled");
  const local = scanRoot(getExtensionsDir(), "local");

  // Deduplicate: bundled takes precedence over local for same id.
  const seen = new Set<string>();
  const result: ExtensionRecord[] = [];
  for (const record of [...bundled, ...local]) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    result.push(record);
  }
  return result;
}

/** Build the manifest for the browser, filtering out disabled extensions. */
export function buildManifest(): ExtensionManifest {
  const records = discoverExtensions();
  const enabledState = readEnabledState();

  const extensions: ExtensionManifestEntry[] = records
    .filter((r) => enabledState[r.id] !== false) // default enabled
    .map((r) => ({
      id: r.id,
      module: `/api/extensions/${r.id}/${r.moduleRelative}?v=${r.version}`,
      source: r.source,
      name: r.name,
    }));

  return { extensions };
}

/** Resolve a relative asset path within an extension's dir. Returns null if not found or unsafe. */
export function resolveExtensionAsset(
  extensionId: string,
  assetPath: string,
): { absPath: string; record: ExtensionRecord } | null {
  const records = discoverExtensions();
  const record = records.find((r) => r.id === extensionId);
  if (!record) return null;

  if (!isSafeRelativePath(assetPath)) return null;
  const absPath = resolve(record.dir, assetPath);

  // Security: ensure resolved path is within the extension dir.
  const rel = relative(record.dir, absPath);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;

  if (!existsSync(absPath) || !statSync(absPath).isFile()) return null;
  return { absPath, record };
}
