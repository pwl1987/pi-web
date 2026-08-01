import test from "node:test";
import assert from "node:assert/strict";
import { shouldUseVisualViewportHeight } from "./useViewportHeight.ts";

test("shouldUseVisualViewportHeight returns false outside iOS", () => {
  // In a Node (non-DOM) environment, `window` is undefined, so the guard
  // short-circuits to false without touching navigator/visualViewport.
  assert.equal(shouldUseVisualViewportHeight(), false);
});
