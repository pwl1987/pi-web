import { test } from "node:test";
import assert from "node:assert/strict";
import { nextReconnectDelay, RECONNECT_BASE_MS, RECONNECT_MAX_MS } from "./sse-backoff.ts";

test("starts at base and doubles", () => {
  assert.equal(nextReconnectDelay(0), RECONNECT_BASE_MS);
  assert.equal(nextReconnectDelay(RECONNECT_BASE_MS), 2000);
  assert.equal(nextReconnectDelay(2000), 4000);
});

test("caps at max and stays stable", () => {
  let prev = RECONNECT_BASE_MS;
  for (let i = 0; i < 20; i++) prev = nextReconnectDelay(prev);
  assert.equal(prev, RECONNECT_MAX_MS);
  assert.equal(nextReconnectDelay(prev), RECONNECT_MAX_MS);
});

test("invalid input falls back to base", () => {
  assert.equal(nextReconnectDelay(NaN), RECONNECT_BASE_MS);
  assert.equal(nextReconnectDelay(-5), RECONNECT_BASE_MS);
});
