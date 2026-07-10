import { describe, it, expect } from "vitest";
import { getEntryIdForTask } from "./inspector-task-id";

describe("getEntryIdForTask", () => {
  it("returns undefined for an empty map", () => {
    expect(getEntryIdForTask({}, 1)).toBeUndefined();
  });

  it("returns the entryId for an existing taskId (numeric key)", () => {
    const map = { 1: "entry-aaa", 2: "entry-bbb" } as Record<number, string>;
    expect(getEntryIdForTask(map, 1)).toBe("entry-aaa");
    expect(getEntryIdForTask(map, 2)).toBe("entry-bbb");
  });

  it("returns undefined for a missing taskId", () => {
    const map = { 1: "entry-aaa" } as Record<number, string>;
    expect(getEntryIdForTask(map, 99)).toBeUndefined();
  });

  it("handles JSON-style string keys (the API response shape after JSON.parse)", () => {
    // /api/task-list returns entryIds as a JSON object — numeric keys come
    // back as strings after JSON.parse({1: "x"}). The helper must coerce.
    const map = { "1": "entry-aaa", "2": "entry-bbb" } as unknown as Record<number, string>;
    expect(getEntryIdForTask(map, 1)).toBe("entry-aaa");
    expect(getEntryIdForTask(map, 2)).toBe("entry-bbb");
    expect(getEntryIdForTask(map, 3)).toBeUndefined();
  });

  it("returns undefined when the map itself is missing/null-ish", () => {
    // Defensive — the API could omit entryIds on older sessions.
    expect(getEntryIdForTask(undefined as unknown as Record<number, string>, 1)).toBeUndefined();
    expect(getEntryIdForTask(null as unknown as Record<number, string>, 1)).toBeUndefined();
  });
});