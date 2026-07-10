// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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