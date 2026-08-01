import test from "node:test";
import assert from "node:assert/strict";
import {
  clampPanelWidth,
  getSidebarMaxWidth,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
} from "./panel-layout.ts";

test("clampPanelWidth bounds", () => {
  assert.equal(clampPanelWidth(100, 180, 480), 180);
  assert.equal(clampPanelWidth(999, 180, 480), 480);
  assert.equal(clampPanelWidth(260, 180, 480), 260);
});

test("clampPanelWidth non-finite falls back to min", () => {
  assert.equal(clampPanelWidth(NaN, 180, 480), 180);
  assert.equal(clampPanelWidth(Infinity, 180, 480), 180);
});

test("getSidebarMaxWidth caps on mobile", () => {
  assert.equal(getSidebarMaxWidth({ viewportWidth: 400 }), SIDEBAR_MAX_WIDTH);
});

test("getSidebarMaxWidth leaves room for chat on desktop", () => {
  assert.equal(getSidebarMaxWidth({ viewportWidth: 1000 }), 480);
  assert.equal(getSidebarMaxWidth({ viewportWidth: 700 }), 380);
  assert.equal(getSidebarMaxWidth({ viewportWidth: 641 }), 321);
});

test("getSidebarMaxWidth never below min", () => {
  assert.ok(getSidebarMaxWidth({ viewportWidth: 1000 }) >= SIDEBAR_MIN_WIDTH);
});
