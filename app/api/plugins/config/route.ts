// GET/PUT per-plugin configuration values.
//
// Values are persisted as a per-source key/value map in the agent-dir
// sidecar `plugins-config.json`:
//
//   {
//     "npm:context-mode": { "compressionLevel": "balanced", ... },
//     "npm:pi-rtk":       { "maxOutputTokens": 2000, ... }
//   }
//
// This is the storage layer for the data-driven config pages in
// components/PluginConfigPage.tsx. Plugins that own their own config file can
// read these values via pi-web's settings bridge; the descriptor's `storage`
// hint documents where the value ultimately lands.

import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@/lib/config-file";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse } from "@/lib/api-utils";
import { applyDefaults, getPluginConfigDescriptor } from "@/lib/plugin-config-descriptors";

export const dynamic = "force-dynamic";

const CONFIG_FILE = "plugins-config.json";

function configPath(): string {
  return join(getAgentDir(), CONFIG_FILE);
}

function readAll(): Record<string, Record<string, unknown>> {
  try {
    if (!existsSync(configPath())) return {};
    const parsed = JSON.parse(readFileSync(configPath(), "utf8")) as Record<
      string,
      Record<string, unknown>
    >;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Record<string, unknown>>): void {
  const dir = getAgentDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(all, null, 2), "utf8");
}

// GET /api/plugins/config?source=npm:context-mode
// Returns the descriptor-merged config for one plugin.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const source = searchParams.get("source");
  if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });

  const descriptor = getPluginConfigDescriptor(source);
  if (!descriptor) {
    return NextResponse.json({ error: `No config descriptor for ${source}` }, { status: 404 });
  }

  const all = readAll();
  const merged = applyDefaults(descriptor, all[source.trim()]);
  return NextResponse.json({ source: descriptor.source, values: merged });
}

// PUT /api/plugins/config?source=npm:context-mode  body: { values: {...} }
// Persists the provided values (merged onto existing ones).
export async function PUT(req: Request) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const { searchParams } = new URL(req.url);
    const source = searchParams.get("source");
    if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });

    const descriptor = getPluginConfigDescriptor(source);
    if (!descriptor) {
      return NextResponse.json({ error: `No config descriptor for ${source}` }, { status: 404 });
    }

    const body = (await req.json()) as { values?: Record<string, unknown> };
    const incoming = body.values ?? {};
    const knownKeys = new Set(descriptor.fields.map((f) => f.key));

    // Only persist keys declared by the descriptor; ignore anything else.
    const next: Record<string, unknown> = {};
    for (const field of descriptor.fields) {
      if (field.key in incoming) next[field.key] = incoming[field.key];
    }
    // Preserve previously-stored keys not present in this PUT.
    const all = readAll();
    const existing = all[source.trim()] ?? {};
    for (const k of Object.keys(existing)) {
      if (knownKeys.has(k) && !(k in next)) next[k] = existing[k];
    }

    all[source.trim()] = next;
    writeAll(all);

    const merged = applyDefaults(descriptor, next);
    return NextResponse.json({ source: descriptor.source, values: merged });
  } catch (error) {
    return errorResponse(error);
  }
}
