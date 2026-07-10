// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InspectorTaskRow } from "./InspectorTaskRow";

const sampleTask = {
  id: 1,
  subject: "Click me",
  status: "in_progress" as const,
  activeForm: "clicking",
};

describe("InspectorTaskRow click behavior", () => {
  it("calls onTaskClick with the row's entryId when clicked", async () => {
    const onTaskClick = vi.fn();
    const user = userEvent.setup();
    render(
      <ul>
        <InspectorTaskRow
          task={sampleTask}
          variant="active"
          entryId="entry-abc"
          onTaskClick={onTaskClick}
        />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: /click me/i }));
    expect(onTaskClick).toHaveBeenCalledExactlyOnceWith("entry-abc");
  });

  it("does NOT call onTaskClick when entryId is undefined (graceful no-op)", async () => {
    const onTaskClick = vi.fn();
    const user = userEvent.setup();
    render(
      <ul>
        <InspectorTaskRow
          task={sampleTask}
          variant="active"
          entryId={undefined}
          onTaskClick={onTaskClick}
        />
      </ul>,
    );
    // The row should not be focusable/clickable without an entryId.
    const btn = screen.getByRole("button", { name: /click me/i });
    expect(btn).toBeDefined();
    await user.click(btn);
    expect(onTaskClick).not.toHaveBeenCalled();
  });

  it("renders the task subject text", () => {
    render(
      <ul>
        <InspectorTaskRow task={sampleTask} variant="active" entryId="e1" onTaskClick={() => {}} />
      </ul>,
    );
    expect(screen.getByText("Click me")).toBeInTheDocument();
  });

  it("renders the activeForm as a subtitle for in_progress tasks", () => {
    render(
      <ul>
        <InspectorTaskRow task={sampleTask} variant="active" entryId="e1" onTaskClick={() => {}} />
      </ul>,
    );
    expect(screen.getByText(/clicking/i)).toBeInTheDocument();
  });
});

describe("InspectorTaskRow right-click copy", () => {
  let writeTextSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeTextSpy = vi.fn().mockResolvedValue(undefined);
    // jsdom's navigator.clipboard is undefined by default; install a stub.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextSpy },
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  it("right-click on a clickable row copies the subject to clipboard", () => {
    render(
      <ul>
        <InspectorTaskRow
          task={sampleTask}
          variant="active"
          entryId="e1"
          onTaskClick={() => {}}
        />
      </ul>,
    );
    const btn = screen.getByRole("button", { name: /click me/i });
    fireEvent.contextMenu(btn);
    expect(writeTextSpy).toHaveBeenCalledWith("Click me");
  });

  it("right-click does NOT copy when entryId is undefined (no-op rows are still no-op)", () => {
    render(
      <ul>
        <InspectorTaskRow
          task={sampleTask}
          variant="active"
          entryId={undefined}
          onTaskClick={() => {}}
        />
      </ul>,
    );
    const btn = screen.getByRole("button", { name: /click me/i });
    fireEvent.contextMenu(btn);
    expect(writeTextSpy).not.toHaveBeenCalled();
  });

  it("right-click does not fire the click handler (single action per gesture)", () => {
    const onTaskClick = vi.fn();
    render(
      <ul>
        <InspectorTaskRow
          task={sampleTask}
          variant="active"
          entryId="e1"
          onTaskClick={onTaskClick}
        />
      </ul>,
    );
    const btn = screen.getByRole("button", { name: /click me/i });
    fireEvent.contextMenu(btn);
    expect(onTaskClick).not.toHaveBeenCalled();
  });
});

describe("InspectorTaskRow click feedback", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("adds a 'task-row-clicked' class immediately after a click", () => {
    const onTaskClick = vi.fn();
    render(
      <ul>
        <InspectorTaskRow
          task={sampleTask}
          variant="active"
          entryId="e1"
          onTaskClick={onTaskClick}
        />
      </ul>,
    );
    const btn = screen.getByRole("button", { name: /click me/i });
    expect(btn.className).not.toContain("task-row-clicked");

    fireEvent.click(btn);
    expect(btn.className).toContain("task-row-clicked");
    expect(onTaskClick).toHaveBeenCalledWith("e1");
  });

  it("removes the 'task-row-clicked' class after the feedback duration", () => {
    render(
      <ul>
        <InspectorTaskRow
          task={sampleTask}
          variant="active"
          entryId="e1"
          onTaskClick={() => {}}
        />
      </ul>,
    );
    const btn = screen.getByRole("button", { name: /click me/i });
    fireEvent.click(btn);
    expect(btn.className).toContain("task-row-clicked");
    vi.advanceTimersByTime(400); // > feedback duration
    expect(btn.className).not.toContain("task-row-clicked");
  });

  it("does NOT add the click class when entryId is undefined (no-op rows)", () => {
    render(
      <ul>
        <InspectorTaskRow
          task={sampleTask}
          variant="active"
          entryId={undefined}
          onTaskClick={() => {}}
        />
      </ul>,
    );
    const btn = screen.getByRole("button", { name: /click me/i });
    expect(btn).toBeDisabled();
    // fireEvent still dispatches the event even on disabled buttons; we
    // just want to confirm the handler branch where entryId is undefined
    // does NOT add the class.
    fireEvent.click(btn);
    expect(btn.className).not.toContain("task-row-clicked");
  });
});