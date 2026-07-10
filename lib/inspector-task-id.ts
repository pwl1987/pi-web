/**
 * Tiny lookup helper for the inspector task→entry mapping.
 *
 * The /api/task-list endpoint returns entryIds as a plain JSON object
 * keyed by taskId. JSON serialization turns numeric keys into strings, so
 * the runtime shape is actually `{ "1": "entry-aaa", ... }` rather than
 * `{ 1: "entry-aaa", ... }`. This helper centralizes the coercion and
 * handles missing data gracefully.
 *
 * Return undefined (not null) so callers can use `entryId ?? defaultValue`.
 */
export function getEntryIdForTask(
  entryIds: Record<number, string> | undefined | null,
  taskId: number,
): string | undefined {
  if (!entryIds) return undefined;
  // JSON keys are strings; numeric keys are coerced to strings on parse.
  const key = String(taskId);
  return entryIds[taskId] ?? entryIds[key as unknown as number];
}