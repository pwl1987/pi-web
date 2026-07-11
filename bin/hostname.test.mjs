// node:test tests for bin/pi-web.js hostname resolution.
//
// resolveHostname is a pure function extracted from the CLI so the
// default-listen policy (127.0.0.1) is unit-testable without spawning next.
import assert from "node:assert/strict";
import test from "node:test";

const { resolveHostname } = await import("./pi-web.js");

test("resolveHostname defaults to 127.0.0.1 when no flag or env is set", () => {
  assert.equal(resolveHostname({}, {}), "127.0.0.1");
});

test("resolveHostname honours an explicit --host/-H flag over env and default", () => {
  assert.equal(resolveHostname({ hostname: "0.0.0.0" }, { PI_WEB_HOST: "1.2.3.4" }), "0.0.0.0");
});

test("resolveHostname falls back to PI_WEB_HOST env when no flag is given", () => {
  assert.equal(resolveHostname({}, { PI_WEB_HOST: "10.0.0.5" }), "10.0.0.5");
});

test("resolveHostname ignores the shell-set HOSTNAME env var (machine name, not bind addr)", () => {
  // Many shells export HOSTNAME=<machine-name>. Using it as a bind address
  // would either fail or, worse, bind to a public interface. It must NOT be
  // used as the default.
  assert.equal(resolveHostname({}, { HOSTNAME: "workstation-42" }), "127.0.0.1");
});
