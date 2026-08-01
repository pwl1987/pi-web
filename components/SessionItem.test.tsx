/**
 * TDD tests for components/SessionItem.tsx — the per-row session list item
 * extracted from SessionSidebar.tsx.
 *
 * Seams under test:
 *   1. Renders the session title, message count and relative time.
 *   2. Hover reveals action buttons (rename / delete).
 *   3. Delete flow shows an inline confirmation, then fires DELETE.
 *   4. Rename flow commits a PATCH with the trimmed name.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { SessionInfo } from "@/lib/types";

// --- Mocks ----------------------------------------------------------------
// useI18n returns the key verbatim so assertions can target stable strings.
vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

// SessionItem only reads getWorkspaceLabelItems — return none for the test.
vi.mock("@/hooks/useExtensions", () => ({
  useExtensions: () => ({ getWorkspaceLabelItems: () => [] }),
}));

// Mock the network seam the component actually depends on (csrfFetchJson),
// NOT the global fetch. The previous stubGlobal("fetch") was vulnerable to
// cross-file pollution: other test files in the same worker stub fetch too,
// and if their cleanup ran out of order the mock was reset mid-await, leaving
// onDeleted/onRenamed never called. Mocking the module-seam avoids any shared
// global entirely.
vi.mock("@/lib/csrf-fetch", () => ({
  csrfFetchJson: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
}));

import { csrfFetchJson } from "@/lib/csrf-fetch";
import { SessionItem } from "./SessionItem";

// Handle to the hoisted mock — typed as the real function via vi.mocked().
const csrfFetchJsonMock = vi.mocked(csrfFetchJson);

const baseSession: SessionInfo = {
  path: "/tmp/sessions/s1.jsonl",
  id: "s1",
  cwd: "/tmp/project",
  name: "My Session",
  created: "2026-07-11T10:00:00.000Z",
  modified: "2026-07-11T10:00:00.000Z",
  messageCount: 3,
  firstMessage: "Hello world",
};

beforeEach(() => {
  csrfFetchJsonMock.mockReset();
  csrfFetchJsonMock.mockResolvedValue({ ok: true, status: 200, data: {} });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SessionItem", () => {
  it("renders the session title and message count", () => {
    render(<SessionItem session={baseSession} onClick={() => {}} />);
    expect(screen.getByText("My Session")).toBeTruthy();
    expect(screen.getByText(/3 sidebar\.msgs/)).toBeTruthy();
  });

  it("reveals delete + rename buttons on hover", () => {
    const { container } = render(<SessionItem session={baseSession} onClick={() => {}} />);
    const row = container.firstChild as HTMLElement;
    fireEvent.mouseEnter(row);
    expect(screen.getByTitle("sidebar.delete")).toBeTruthy();
    expect(screen.getByTitle("sidebar.rename")).toBeTruthy();
  });

  it("fires DELETE after inline confirm", async () => {
    const onDeleted = vi.fn();
    const { container } = render(
      <SessionItem session={baseSession} onClick={() => {}} onDeleted={onDeleted} />,
    );
    const row = container.firstChild as HTMLElement;
    fireEvent.mouseEnter(row);

    // 1) hover delete → enters confirm mode (only the confirm button remains)
    fireEvent.click(screen.getByLabelText("sidebar.delete"));
    // 2) confirm → DELETE request
    fireEvent.click(screen.getByText("sidebar.delete"));

    expect(csrfFetchJsonMock).toHaveBeenCalledWith(
      "/api/sessions/s1",
      expect.objectContaining({ method: "DELETE" }),
    );
    // onDeleted is invoked after the awaited fetch resolves
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith("s1");
    });
  });

  it("commits a PATCH with the trimmed name on rename", async () => {
    const onRenamed = vi.fn();
    const { container } = render(
      <SessionItem session={baseSession} onClick={() => {}} onRenamed={onRenamed} />,
    );
    const row = container.firstChild as HTMLElement;
    fireEvent.mouseEnter(row);

    fireEvent.click(screen.getByLabelText("sidebar.rename"));
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "  Renamed Session  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(csrfFetchJsonMock).toHaveBeenCalledWith("/api/sessions/s1", {
      method: "PATCH",
      body: { name: "Renamed Session" },
    });
    await waitFor(() => {
      expect(onRenamed).toHaveBeenCalled();
    });
  });

  it("does not PATCH when the renamed value is unchanged", () => {
    const onRenamed = vi.fn();
    const { container } = render(
      <SessionItem session={baseSession} onClick={() => {}} onRenamed={onRenamed} />,
    );
    const row = container.firstChild as HTMLElement;
    fireEvent.mouseEnter(row);

    fireEvent.click(screen.getByTitle("sidebar.rename"));
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "My Session" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(csrfFetchJsonMock).not.toHaveBeenCalled();
  });
});
