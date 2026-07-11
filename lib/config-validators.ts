/**
 * Pure validators for config-write endpoints (models.json, mcp.json).
 *
 * These endpoints persist user-supplied JSON to disk and, for MCP servers,
 * indirectly configure commands pi will later spawn. The validators enforce a
 * minimal shape so a malformed or hostile body cannot corrupt the registry or
 * inject nonsensical command entries.
 *
 * Each validator returns `null` when valid, or `{ error, status }` describing
 * the first validation failure (call sites return it as a JSON error response).
 */

export interface ValidationFailure {
  error: string;
  status: number;
}

/** True when `v` is a plain object (not null, not an array). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate the top-level models.json body.
 *
 * Accepts any plain JSON object — we do not over-constrain the provider/model
 * schema (it is forward-compatible with pi's registry) — but we require it be
 * an object so an array/null/string cannot be written to models.json and break
 * every session's model resolution on next load.
 */
export function validateModelsConfig(body: unknown): ValidationFailure | null {
  if (!isPlainObject(body)) {
    return { error: "models.json body must be a JSON object", status: 400 };
  }
  return null;
}

/**
 * Validate the `mcpServers` map of an mcp.json PUT body.
 *
 * Rules per entry:
 *  - The whole value must be a plain object keyed by server name.
 *  - Each server entry must be an object specifying either `command` (stdio)
 *    or `url` (remote) — otherwise pi cannot start it.
 *  - `command`, when present, must be a non-empty string.
 *  - `args`, when present, must be an array of strings.
 *  - `url`, when present, must be a non-empty string.
 */
export function validateMcpServers(servers: unknown): ValidationFailure | null {
  if (!isPlainObject(servers)) {
    return { error: "mcpServers must be a JSON object", status: 400 };
  }
  for (const [name, entryRaw] of Object.entries(servers)) {
    const entry = entryRaw as Record<string, unknown>;
    if (!isPlainObject(entry)) {
      return { error: `mcp server "${name}" must be an object`, status: 400 };
    }
    const hasCommand = typeof entry.command === "string" && entry.command.length > 0;
    const hasUrl = typeof entry.url === "string" && entry.url.length > 0;
    if (!hasCommand && !hasUrl) {
      return {
        error: `mcp server "${name}" must specify a non-empty "command" or "url"`,
        status: 400,
      };
    }
    if (entry.args !== undefined) {
      if (!Array.isArray(entry.args) || entry.args.some((a) => typeof a !== "string")) {
        return { error: `mcp server "${name}" args must be an array of strings`, status: 400 };
      }
    }
  }
  return null;
}
