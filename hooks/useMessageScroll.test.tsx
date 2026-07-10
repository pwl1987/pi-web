// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock the scrollIntoView wrapper so we can assert it was called
// without touching jsdom's layout engine.
vi.mock("@/lib/scroll-into-view", () => ({
  scrollIntoView: vi.fn(),
}));

import { useMessageScroll } from "./useMessageScroll";
import { scrollIntoView } from "@/lib/scroll-into-view";

const mockedScrollIntoView = vi.mocked(scrollIntoView);

/**
 * useMessageScroll contract:
 *   const { register, scrollTo } = useMessageScroll();
 *   register("entry-abc", el)  // attach a DOM element to an entryId
 *   scrollTo("entry-abc")      // scroll the attached element into view
 *
 * Used by ChatWindow to support click-to-jump: each message registers
 * its DOM node, the imperative scrollToEntry(handle) calls scrollTo.
 */
describe("useMessageScroll", () => {
  beforeEach(() => {
    mockedScrollIntoView.mockClear();
  });

  function makeEl(id: string, tag = "div"): HTMLElement {
    // data-testid lets us distinguish elements by reference equality in
    // deep-equal matchers — two otherwise-identical empty divs would
    // otherwise compare as equal.
    const el = document.createElement(tag);
    el.setAttribute("data-testid", id);
    return el;
  }

  it("scrollTo on an unknown entryId calls scrollIntoView with undefined (no-op)", () => {
    const { result } = renderHook(() => useMessageScroll());
    act(() => result.current.scrollTo("never-registered"));
    expect(mockedScrollIntoView).toHaveBeenCalledTimes(1);
    expect(mockedScrollIntoView).toHaveBeenCalledWith(undefined);
  });

  it("scrollTo on a registered entryId scrolls the attached element", () => {
    const { result } = renderHook(() => useMessageScroll());
    const el = makeEl("only");

    act(() => result.current.register("entry-abc", el));
    act(() => result.current.scrollTo("entry-abc"));

    expect(mockedScrollIntoView).toHaveBeenCalledTimes(1);
    expect(mockedScrollIntoView).toHaveBeenCalledWith(el);
  });

  it("register(null) removes the entryId from the map", () => {
    const { result } = renderHook(() => useMessageScroll());
    const el = makeEl("only");

    act(() => result.current.register("entry-abc", el));
    act(() => result.current.register("entry-abc", null));
    act(() => result.current.scrollTo("entry-abc"));

    // Element was removed — wrapper called with undefined.
    expect(mockedScrollIntoView).toHaveBeenCalledWith(undefined);
  });

  it("scrollTo only affects the requested entryId", () => {
    const { result } = renderHook(() => useMessageScroll());
    const elA = makeEl("a-only");
    const elB = makeEl("b-only");

    act(() => result.current.register("a", elA));
    act(() => result.current.register("b", elB));
    act(() => result.current.scrollTo("b"));

    expect(mockedScrollIntoView).toHaveBeenCalledTimes(1);
    expect(mockedScrollIntoView).toHaveBeenCalledWith(elB);
  });

  it("re-registering the same entryId replaces the element (last wins)", () => {
    const { result } = renderHook(() => useMessageScroll());
    const first = makeEl("first");
    const second = makeEl("second");

    act(() => result.current.register("x", first));
    act(() => result.current.register("x", second));
    act(() => result.current.scrollTo("x"));

    expect(mockedScrollIntoView).toHaveBeenCalledWith(second);
    expect(mockedScrollIntoView).not.toHaveBeenCalledWith(first);
  });

  it("returned register/scrollTo references are stable across re-renders", () => {
    const { result, rerender } = renderHook(() => useMessageScroll());
    const register1 = result.current.register;
    const scrollTo1 = result.current.scrollTo;
    rerender();
    expect(result.current.register).toBe(register1);
    expect(result.current.scrollTo).toBe(scrollTo1);
  });
});