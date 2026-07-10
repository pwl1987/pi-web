// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the scroll wrapper at the seam so we can observe calls.
const mockScrollIntoView = vi.fn();
vi.mock("@/lib/scroll-into-view", () => ({
  scrollIntoView: vi.fn((el: HTMLElement | null | undefined) => mockScrollIntoView(el)),
}));

import { useState } from "react";
import { InspectorTaskRow } from "./InspectorTaskRow";
import { useScrollToEntry } from "@/hooks/useScrollToEntry";
import { useMessageScroll } from "@/hooks/useMessageScroll";

/**
 * S6 end-to-end smoke test: InspectorTaskRow click → useScrollToEntry
 * fires onJump → scrollToMessage called → scrollIntoView wrapper invoked
 * with the right element.
 *
 * This isn't a full AppShell render (that would need a forest of mocks).
 * Instead it exercises the actual contract chain with a small test
 * harness that wires the same pieces the real AppShell wires. Each
 * individual link (useScrollToEntry, useMessageScroll, scrollIntoView,
 * InspectorTaskRow) has its own unit tests; this test verifies they
 * connect without surprises.
 */
function TestHarness({ tasks, entryIds }: {
  tasks: { id: number; subject: string; status: "in_progress" | "completed" | "pending" }[];
  entryIds: Record<number, string>;
}) {
  // Simulate AppShell state: entryId held in state, cleared after scroll.
  const [entryId, setEntryId] = useState<string | null>(null);

  // ChatWindow's scroll machinery.
  const { register, scrollTo } = useMessageScroll();
  // AppShell's bridge: fires when entryId changes, calls scrollTo.
  useScrollToEntry(entryId, (eid) => {
    scrollTo(eid);
    // After firing, clear the trigger (matches the AppShell clear-and-reclick flow).
    setEntryId(null);
  });

  return (
    <ul>
      {tasks.map((task) => (
        <InspectorTaskRow
          key={task.id}
          task={task}
          variant="active"
          entryId={entryIds[task.id]}
          onTaskClick={(eid) => setEntryId(eid)}
        />
      ))}
      <li data-testid="fake-message" ref={(el) => { if (el) register("entry-task-1", el); }}>
        fake message for entry-task-1
      </li>
    </ul>
  );
}

describe("click-to-jump end-to-end (S6)", () => {
  beforeEach(() => {
    mockScrollIntoView.mockClear();
  });

  it("clicking a task row scrolls its message into view", async () => {
    const user = userEvent.setup();
    const fakeMessageEl = document.createElement("div");
    mockScrollIntoView.mockImplementation((el) => {
      // Capture for assertion
      (fakeMessageEl as { lastScrolled?: HTMLElement }).lastScrolled = el ?? undefined;
    });

    render(
      <TestHarness
        tasks={[{ id: 1, subject: "jump to me", status: "in_progress" }]}
        entryIds={{ 1: "entry-task-1" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /jump to me/i }));

    // scrollIntoView was called with the message element we registered.
    expect(mockScrollIntoView).toHaveBeenCalledTimes(1);
    const calledWith = mockScrollIntoView.mock.calls[0][0];
    expect(calledWith).toBeDefined();
    // The element should be the <li> we set ref on.
    expect((calledWith as HTMLElement).getAttribute("data-testid")).toBe("fake-message");
  });

  it("clicking a task without a registered entryId is a no-op", async () => {
    const user = userEvent.setup();
    render(
      <TestHarness
        tasks={[{ id: 99, subject: "orphan task", status: "in_progress" }]}
        // no entryId mapping for task 99
        entryIds={{}}
      />,
    );

    // Row renders as disabled button (entryId undefined), so user.click won't fire it.
    const btn = screen.getByRole("button", { name: /orphan task/i });
    expect(btn).toBeDisabled();

    await user.click(btn).catch(() => {
      // user-event throws on disabled click; that's fine.
    });
    expect(mockScrollIntoView).not.toHaveBeenCalled();
  });

  it("clicking two tasks in sequence scrolls each (clear-and-reclick flow)", async () => {
    const user = userEvent.setup();

    render(
      <TestHarness
        tasks={[
          { id: 1, subject: "first", status: "in_progress" },
          { id: 2, subject: "second", status: "in_progress" },
        ]}
        entryIds={{ 1: "entry-task-1", 2: "entry-task-2" }}
      />,
    );

    // Register a second message element for entry-task-2 by clicking once
    // to mount, then re-rendering with the second message ref.
    // We can just rely on the fact that only the first li exists in JSX;
    // for the second click we just verify it doesn't throw even if the
    // element isn't registered.
    await user.click(screen.getByRole("button", { name: /first/i }));
    expect(mockScrollIntoView).toHaveBeenCalledTimes(1);

    // Second click: AppShell cleared entryId after first scroll, so the
    // hook is ready to fire again on the new value.
    await user.click(screen.getByRole("button", { name: /second/i }));
    expect(mockScrollIntoView).toHaveBeenCalledTimes(2);
  });
});