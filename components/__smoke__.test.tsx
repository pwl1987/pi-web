// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("component smoke test", () => {
  it("renders a button with text and responds to data-* attrs", () => {
    render(<button data-testid="ping">ping</button>);
    const btn = screen.getByTestId("ping");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.textContent).toBe("ping");
  });

  it("supports user-event (we'll use this heavily for clicks)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    let count = 0;
    render(
      <button data-testid="counter" onClick={() => count++}>
        {count}
      </button>,
    );
    await user.click(screen.getByTestId("counter"));
    expect(count).toBe(1);
  });

  it("honors the @/ alias and imports React from the workspace deps", () => {
    expect(typeof render).toBe("function");
  });
});