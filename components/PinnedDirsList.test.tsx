// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PinnedDirsList, type PinnedDir } from "./PinnedDirsList";

const sample: PinnedDir[] = [
  { path: "/Users/me/projects/pi-web", alias: "pi-web", pinnedAt: 1700000000000 },
  { path: "/Users/me/projects/scratch", pinnedAt: 1700000001000 },
];

describe("PinnedDirsList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

function mockFetchSequence(responses: { body: unknown; status?: number }[]) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: (r.status ?? 200) === 200,
      status: r.status ?? 200,
      json: async () => r.body,
    } as unknown as Response);
  }
  globalThis.fetch = fn as unknown as typeof fetch;
}

  it("renders the pinned dirs from /api/pinned-dirs on mount", async () => {
    mockFetchSequence([{ body: { pinnedDirs: sample } }]);
    render(<PinnedDirsList onCwdChange={() => {}} />);
    // Two list items, one per pinned dir. Use data-pinned-label to avoid
    // collisions with the basename span shown when alias is set.
    const labels = await screen.findAllByText("pi-web");
    expect(labels.length).toBeGreaterThan(0);
    // "scratch" has no alias, so the label is the basename.
    expect(screen.getByText("scratch")).toBeInTheDocument();
    // Title attribute should expose the full path for screen-readers.
    expect(screen.getByTitle("/Users/me/projects/scratch")).toBeInTheDocument();
  });

  it("calls onCwdChange with the path when a pinned dir is clicked", async () => {
    mockFetchSequence([{ body: { pinnedDirs: sample } }]);
    const onCwdChange = vi.fn();
    render(<PinnedDirsList onCwdChange={onCwdChange} />);
    // Wait for the two rows to appear.
    await waitFor(() => {
      expect(document.querySelectorAll("[data-pinned-row]").length).toBe(2);
    });
    const rows = document.querySelectorAll("[data-pinned-row]");
    fireEvent.click(rows[0]!); // click the pi-web row
    expect(onCwdChange).toHaveBeenCalledWith(
      "/Users/me/projects/pi-web",
      "/Users/me/projects/pi-web",
    );
  });

  it("removes the dir from the list after unpin is clicked", async () => {
    mockFetchSequence([
      { body: { pinnedDirs: sample } }, // initial GET
      { body: { removed: true } },        // DELETE response
    ]);
    render(<PinnedDirsList onCwdChange={() => {}} />);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-pinned-row]").length).toBe(2);
    });
    const firstRow = document.querySelectorAll("[data-pinned-row]")[0]!;
    const unpinBtn = firstRow.querySelector("[data-unpin]")!;
    fireEvent.click(unpinBtn);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-pinned-row]").length).toBe(1);
    });
    // The remaining dir should still be visible (alias-less, label is basename).
    expect(screen.getByText("scratch")).toBeInTheDocument();
  });

  it("renders nothing when the pinned list is empty (no header)", async () => {
    mockFetchSequence([{ body: { pinnedDirs: [] } }]);
    render(<PinnedDirsList onCwdChange={() => {}} />);
    // Wait a microtask for the fetch resolution.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/pinned/i)).toBeNull();
  });

  it("does not crash on a 500 response", async () => {
    mockFetchSequence([{ body: { error: "boom" }, status: 500 }]);
    const onCwdChange = vi.fn();
    expect(() => render(<PinnedDirsList onCwdChange={onCwdChange} />)).not.toThrow();
  });
});