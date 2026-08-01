import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldShowWindowsDrivePicker,
  getWindowsDriveCandidates,
  listWindowsDrives,
} from "./windows-drives.ts";

test("shouldShowWindowsDrivePicker only on win32 without directory", () => {
  assert.equal(shouldShowWindowsDrivePicker(undefined, "win32"), true);
  assert.equal(shouldShowWindowsDrivePicker("C:\\", "win32"), false);
  assert.equal(shouldShowWindowsDrivePicker(undefined, "linux"), false);
  assert.equal(shouldShowWindowsDrivePicker(undefined, "darwin"), false);
});

test("getWindowsDriveCandidates returns 26 drives", () => {
  const drives = getWindowsDriveCandidates();
  assert.equal(drives.length, 26);
  assert.deepEqual(drives[0], { name: "A:", path: "A:\\" });
  assert.deepEqual(drives[25], { name: "Z:", path: "Z:\\" });
});

test("listWindowsDrives resolves to an array on non-win32", async () => {
  const drives = await listWindowsDrives();
  assert.ok(Array.isArray(drives));
});
