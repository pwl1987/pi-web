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

/**
 * A single field-level validation failure for an mcpServers map.
 *
 * `server` is the offending server name (the map key). For the global
 * top-level shape it may be omitted. `field` points at the offending input so
 * the UI can render an inline error next to it. `message` is an i18n key
 * (resolved client-side via `t()`) so the same validator serves zh/en.
 */
export interface McpFieldError {
  server?: string;
  field:
    | "name"
    | "command"
    | "url"
    | "args"
    | "env"
    | "headers"
    | "lifecycle"
    | "idleTimeout"
    | "requestTimeoutMs"
    | "root";
  message: string;
}

const MCP_LIFECYCLES = new Set(["lazy", "eager", "onDemand"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Field-level validation of an `mcpServers` map. Returns every problem found
 * (not just the first), each tagged with the server name + field + i18n key,
 * so the UI can highlight precisely where config is broken.
 */
export function validateMcpServersDetailed(servers: unknown): McpFieldError[] {
  const errors: McpFieldError[] = [];
  if (!isRecord(servers)) {
    errors.push({ field: "root", message: "mcp.err.serversObject" });
    return errors;
  }
  for (const [name, entryRaw] of Object.entries(servers)) {
    if (!name.trim()) {
      errors.push({ server: name, field: "name", message: "mcp.err.nameEmpty" });
    } else if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      errors.push({ server: name, field: "name", message: "mcp.err.nameInvalid" });
    }
    if (!isRecord(entryRaw)) {
      errors.push({ server: name, field: "root", message: "mcp.err.entryObject" });
      continue;
    }
    const entry = entryRaw as Record<string, unknown>;
    const hasCommand = typeof entry.command === "string" && entry.command.length > 0;
    const hasUrl = typeof entry.url === "string" && entry.url.length > 0;
    if (!hasCommand && !hasUrl) {
      errors.push({ server: name, field: "root", message: "mcp.err.needCommandOrUrl" });
    }
    if (
      entry.command !== undefined &&
      (typeof entry.command !== "string" || entry.command.length === 0)
    ) {
      errors.push({ server: name, field: "command", message: "mcp.err.commandEmpty" });
    }
    if (entry.url !== undefined) {
      if (typeof entry.url !== "string" || entry.url.length === 0) {
        errors.push({ server: name, field: "url", message: "mcp.err.urlEmpty" });
      } else {
        try {
          const u = new URL(entry.url);
          if (u.protocol !== "http:" && u.protocol !== "https:") {
            throw new Error("bad protocol");
          }
        } catch {
          errors.push({ server: name, field: "url", message: "mcp.err.urlInvalid" });
        }
      }
    }
    if (entry.args !== undefined) {
      if (!Array.isArray(entry.args) || entry.args.some((a) => typeof a !== "string")) {
        errors.push({ server: name, field: "args", message: "mcp.err.argsType" });
      }
    }
    if (entry.env !== undefined && !isRecord(entry.env)) {
      errors.push({ server: name, field: "env", message: "mcp.err.envType" });
    }
    if (entry.headers !== undefined && !isRecord(entry.headers)) {
      errors.push({ server: name, field: "headers", message: "mcp.err.headersType" });
    }
    if (entry.lifecycle !== undefined && !MCP_LIFECYCLES.has(entry.lifecycle as string)) {
      errors.push({ server: name, field: "lifecycle", message: "mcp.err.lifecycleInvalid" });
    }
    for (const [field, key] of [
      ["idleTimeout", "mcp.err.timeoutPositive"],
      ["requestTimeoutMs", "mcp.err.timeoutPositive"],
    ] as const) {
      const v = entry[field];
      if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
        errors.push({ server: name, field, message: key });
      }
    }
  }
  return errors;
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
