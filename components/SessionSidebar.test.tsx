/**
 * TDD tests for lib/session-utils.ts — session utility functions
 * extracted from SessionSidebar.tsx.
 *
 * Seams under test:
 *   1. loadUnreadSessionIds() — localStorage parsing with error resilience
 *   2. saveUnreadSessionIds() — localStorage write/clear
 *   3. formatRelativeTime() — relative time display with i18n
 *   4. getRecentProjects() — dedup project roots by most recent
 *   5. displayCwd() — home dir substitution
 *   6. buildSessionTree() — session tree from flat list with parent chains
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";

// We'll import after defining the module

describe("session-utils (TDD)", () => {
  // --- loadUnreadSessionIds ---
  describe("loadUnreadSessionIds", () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it("returns empty set when localStorage is empty", async () => {
      const mod = await import("../lib/session-utils");
      expect(mod.loadUnreadSessionIds().size).toBe(0);
    });

    it("parses a valid JSON array of session IDs", async () => {
      window.localStorage.setItem(
        "pi-web:unread-session-ids",
        JSON.stringify(["abc-123", "def-456"]),
      );
      const mod = await import("../lib/session-utils");
      const result = mod.loadUnreadSessionIds();
      expect(result.size).toBe(2);
      expect(result.has("abc-123")).toBe(true);
      expect(result.has("def-456")).toBe(true);
    });

    it("filters out non-string items from the array", async () => {
      window.localStorage.setItem(
        "pi-web:unread-session-ids",
        JSON.stringify(["valid", 42, null, "also-valid"]),
      );
      const mod = await import("../lib/session-utils");
      const result = mod.loadUnreadSessionIds();
      expect(result.size).toBe(2);
      expect(result.has("valid")).toBe(true);
      expect(result.has("also-valid")).toBe(true);
      expect(result.has(42 as unknown as string)).toBe(false);
    });

    it("returns empty set on corrupt JSON", async () => {
      window.localStorage.setItem("pi-web:unread-session-ids", "{{broken");
      const mod = await import("../lib/session-utils");
      expect(mod.loadUnreadSessionIds().size).toBe(0);
    });

    it("returns empty set when item is not an array", async () => {
      window.localStorage.setItem("pi-web:unread-session-ids", '"just a string"');
      const mod = await import("../lib/session-utils");
      expect(mod.loadUnreadSessionIds().size).toBe(0);
    });
  });

  // --- saveUnreadSessionIds ---
  describe("saveUnreadSessionIds", () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it("saves non-empty set to localStorage", async () => {
      const mod = await import("../lib/session-utils");
      mod.saveUnreadSessionIds(new Set(["a", "b"]));
      const raw = window.localStorage.getItem("pi-web:unread-session-ids");
      expect(JSON.parse(raw!)).toEqual(["a", "b"]);
    });

    it("removes the key when set is empty", async () => {
      window.localStorage.setItem("pi-web:unread-session-ids", '["old"]');
      const mod = await import("../lib/session-utils");
      mod.saveUnreadSessionIds(new Set());
      expect(window.localStorage.getItem("pi-web:unread-session-ids")).toBeNull();
    });

    it("does not throw on empty set first save (key didn't exist)", async () => {
      const mod = await import("../lib/session-utils");
      expect(() => mod.saveUnreadSessionIds(new Set())).not.toThrow();
    });
  });

  // --- formatRelativeTime ---
  describe("formatRelativeTime", () => {
    const t = (key: string, vars?: Record<string, string | number>) => {
      const map: Record<string, string> = {
        "sidebar.justNow": "just now",
        "sidebar.minutesAgo": "{{count}}m ago",
        "sidebar.hoursAgo": "{{count}}h ago",
        "sidebar.daysAgo": "{{count}}d ago",
      };
      let s = map[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replace(`{{${k}}}`, String(v));
        }
      }
      return s;
    };

    it('returns "just now" for times within 1 minute', async () => {
      const mod = await import("../lib/session-utils");
      const now = new Date();
      const result = mod.formatRelativeTime(now.toISOString(), t);
      expect(result).toBe("just now");
    });

    it("returns minutes ago format", async () => {
      const mod = await import("../lib/session-utils");
      const minsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(mod.formatRelativeTime(minsAgo, t)).toBe("5m ago");
    });

    it("returns hours ago format", async () => {
      const mod = await import("../lib/session-utils");
      const hoursAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
      expect(mod.formatRelativeTime(hoursAgo, t)).toBe("3h ago");
    });

    it("returns days ago format", async () => {
      const mod = await import("../lib/session-utils");
      const daysAgo = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
      expect(mod.formatRelativeTime(daysAgo, t)).toBe("2d ago");
    });

    it("returns locale date string for dates older than 7 days", async () => {
      const mod = await import("../lib/session-utils");
      const oldDate = new Date(Date.now() - 10 * 86400 * 1000).toISOString();
      const result = mod.formatRelativeTime(oldDate, t);
      // Should be a date string, not a relative format
      expect(result).not.toContain("m ago");
      expect(result).not.toContain("h ago");
      expect(result).not.toContain("d ago");
      expect(result).not.toBe("just now");
    });
  });

  // --- getRecentProjects ---
  describe("getRecentProjects", () => {
    function makeSession(
      overrides: Partial<{
        cwd: string;
        projectRoot: string;
        modified: string;
      }>,
    ): { cwd: string; projectRoot?: string; modified: string } {
      return {
        cwd: overrides.cwd ?? "/tmp/test",
        projectRoot: overrides.projectRoot,
        modified: overrides.modified ?? new Date().toISOString(),
      };
    }

    it("returns projects deduped by projectRoot, sorted by recent", async () => {
      const mod = await import("../lib/session-utils");
      const sessions = [
        makeSession({ projectRoot: "/repo/a", modified: "2025-01-01T00:00:00Z" }),
        makeSession({ projectRoot: "/repo/b", modified: "2025-06-01T00:00:00Z" }),
        makeSession({ projectRoot: "/repo/a", modified: "2025-03-01T00:00:00Z" }),
      ] as Array<{ cwd: string; projectRoot?: string; modified: string }>;
      const result = mod.getRecentProjects(sessions as Parameters<typeof mod.getRecentProjects>[0]);
      // /repo/b is most recent (June), then /repo/a (March)
      expect(result).toEqual(["/repo/b", "/repo/a"]);
    });

    it("falls back to cwd when projectRoot is missing", async () => {
      const mod = await import("../lib/session-utils");
      const sessions = [makeSession({ cwd: "/direct/path", projectRoot: undefined })] as Array<{
        cwd: string;
        projectRoot?: string;
        modified: string;
      }>;
      const result = mod.getRecentProjects(sessions as Parameters<typeof mod.getRecentProjects>[0]);
      expect(result).toEqual(["/direct/path"]);
    });

    it("skips sessions without cwd or projectRoot", async () => {
      const mod = await import("../lib/session-utils");
      const sessions = [
        makeSession({ cwd: "", projectRoot: undefined }),
        makeSession({ cwd: "/valid", modified: "2025-01-01T00:00:00Z" }),
      ] as Array<{ cwd: string; projectRoot?: string; modified: string }>;
      const result = mod.getRecentProjects(sessions as Parameters<typeof mod.getRecentProjects>[0]);
      expect(result).toEqual(["/valid"]);
    });
  });

  // --- displayCwd ---
  describe("displayCwd", () => {
    it("substitutes home dir prefix with ~", async () => {
      const mod = await import("../lib/session-utils");
      expect(mod.displayCwd("/home/user/projects/myapp", "/home/user")).toBe("~/projects/myapp");
    });

    it("returns cwd as-is when homeDir is not provided", async () => {
      const mod = await import("../lib/session-utils");
      expect(mod.displayCwd("/some/path", undefined)).toBe("/some/path");
    });

    it("returns cwd as-is when cwd does not start with homeDir", async () => {
      const mod = await import("../lib/session-utils");
      expect(mod.displayCwd("/other/path", "/home/user")).toBe("/other/path");
    });
  });

  // --- buildSessionTree ---
  describe("buildSessionTree", () => {
    type SessionInfoLike = {
      id: string;
      parentSessionId?: string;
      modified: string;
    };

    function makeSession(id: string, parentId?: string, modified?: string): SessionInfoLike {
      return {
        id,
        parentSessionId: parentId,
        modified: modified ?? new Date().toISOString(),
      };
    }

    it("returns flat list as single root when no parent relationships", async () => {
      const mod = await import("../lib/session-utils");
      const sessions = [
        makeSession("s1"),
        makeSession("s2"),
        makeSession("s3"),
      ] as unknown as Parameters<typeof mod.buildSessionTree>[0];
      const tree = mod.buildSessionTree(sessions);
      expect(tree.length).toBe(3);
      tree.forEach((node: { children: unknown[] }) => expect(node.children.length).toBe(0));
    });

    it("builds parent-child relationships from parentSessionId", async () => {
      const mod = await import("../lib/session-utils");
      const sessions = [
        makeSession("parent"),
        makeSession("child1", "parent"),
        makeSession("child2", "parent"),
      ] as unknown as Parameters<typeof mod.buildSessionTree>[0];
      const tree = mod.buildSessionTree(sessions);
      expect(tree.length).toBe(1);
      expect(tree[0].session.id).toBe("parent");
      expect(tree[0].children.length).toBe(2);
    });

    it("sorts by modified date (descending)", async () => {
      const mod = await import("../lib/session-utils");
      const sessions = [
        makeSession("old", undefined, "2024-01-01T00:00:00Z"),
        makeSession("new", undefined, "2025-01-01T00:00:00Z"),
      ] as unknown as Parameters<typeof mod.buildSessionTree>[0];
      const tree = mod.buildSessionTree(sessions);
      expect(tree[0].session.id).toBe("new");
      expect(tree[1].session.id).toBe("old");
    });

    it("resolves multi-level parent chains", async () => {
      const mod = await import("../lib/session-utils");
      const sessions = [
        makeSession("root"),
        makeSession("level1", "root"),
        makeSession("level2", "level1"),
      ] as unknown as Parameters<typeof mod.buildSessionTree>[0];
      const tree = mod.buildSessionTree(sessions);
      expect(tree.length).toBe(1);
      expect(tree[0].session.id).toBe("root");
      expect(tree[0].children[0].session.id).toBe("level1");
      expect(tree[0].children[0].children[0].session.id).toBe("level2");
    });

    it("handles nodes whose parent is missing (becomes root)", async () => {
      const mod = await import("../lib/session-utils");
      const sessions = [makeSession("orphan", "nonexistent-parent")] as unknown as Parameters<
        typeof mod.buildSessionTree
      >[0];
      const tree = mod.buildSessionTree(sessions);
      expect(tree.length).toBe(1);
      expect(tree[0].session.id).toBe("orphan");
    });
  });
});
