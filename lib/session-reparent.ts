/**
 * Rewrite only the `parentSession` field in the first line (session header) of
 * a `.jsonl` session file, returning the new file contents.
 *
 * The rest of the file is preserved **byte-for-byte** — every message,
 * compaction, and session_info entry after the header is returned verbatim.
 * This matters because the previous DELETE handler split the entire file into
 * lines, re-serialized the header, and `join("\n")`-rewrote the whole file,
 * which (a) normalized any original line endings and (b) fully rewrote large
 * session files just to change one header field.
 *
 * Used by `DELETE /api/sessions/[id]` to cascade re-parent children.
 *
 * @param fileContents - the full original `.jsonl` file text
 * @param newParentSession - the new `parentSession` value (absolute path), or
 *   `undefined` to detach the session from its parent.
 * @returns the new file contents, with only the header line changed. If the
 *   first line is not a valid `session` header JSON, the input is returned
 *   unchanged.
 */
export function reparentSessionHeader(
  fileContents: string,
  newParentSession: string | undefined,
): string {
  const newlineIdx = fileContents.indexOf("\n");
  // firstLine excludes the trailing newline; rest includes everything after it.
  const firstLine = newlineIdx === -1 ? fileContents : fileContents.slice(0, newlineIdx);
  const rest = newlineIdx === -1 ? "" : fileContents.slice(newlineIdx + 1);

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(firstLine) as Record<string, unknown>;
  } catch {
    // Malformed header — leave the file untouched rather than corrupt it.
    return fileContents;
  }

  if (header.type !== "session") {
    // First line isn't a session header (e.g. a file starting with a message).
    return fileContents;
  }

  header.parentSession = newParentSession;
  const newFirstLine = JSON.stringify(header);

  if (newlineIdx === -1) return newFirstLine;
  return newFirstLine + "\n" + rest;
}
