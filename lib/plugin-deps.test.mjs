import assert from "node:assert/strict";
import test from "node:test";

const { PLUGIN_DEPENDENCIES, getPluginDependencySpec, buildInstallCommandForAll } =
  await import("./plugin-deps.ts");

test("pi-shazam manifest covers the three language servers with correct packages", () => {
  const spec = getPluginDependencySpec("npm:pi-shazam");
  assert.ok(spec, "expected a manifest for npm:pi-shazam");
  const binaries = spec.globals.map((g) => g.binary);
  assert.deepEqual(binaries, [
    "vscode-json-language-server",
    "typescript-language-server",
    "yaml-language-server",
  ]);
  // typescript-language-server must pull in its `typescript` peer.
  const ts = spec.globals.find((g) => g.binary === "typescript-language-server");
  assert.deepEqual(ts.npmPackages, ["typescript-language-server", "typescript"]);
  // vscode-langservers-extracted is the package behind the json server binary.
  const json = spec.globals.find((g) => g.binary === "vscode-json-language-server");
  assert.deepEqual(json.npmPackages, ["vscode-langservers-extracted"]);
});

test("unknown plugin returns no spec", () => {
  assert.equal(getPluginDependencySpec("npm:does-not-exist"), undefined);
});

test("buildInstallCommandForAll dedups packages and lists all globals", () => {
  const cmd = buildInstallCommandForAll("npm:pi-shazam");
  assert.ok(cmd.startsWith("npm install -g "));
  // vscode-langservers-extracted + typescript-language-server + typescript +
  // yaml-language-server, with `typescript` de-duplicated.
  for (const pkg of [
    "vscode-langservers-extracted",
    "typescript-language-server",
    "typescript",
    "yaml-language-server",
  ]) {
    assert.ok(cmd.includes(pkg), `expected ${pkg} in ${cmd}`);
  }
  // `typescript` must appear exactly once as a token despite being required by
  // two deps (the substring also occurs inside `typescript-language-server`).
  const tokens = cmd.replace("npm install -g ", "").split(/\s+/);
  assert.equal(tokens.filter((t) => t === "typescript").length, 1);
  assert.ok(tokens.includes("typescript-language-server"));
});

test("buildInstallCommandForAll is empty for unknown plugins", () => {
  assert.equal(buildInstallCommandForAll("npm:nope"), "");
});

test("registry is keyed by source id and extensible", () => {
  assert.ok(PLUGIN_DEPENDENCIES["npm:pi-shazam"]);
});
