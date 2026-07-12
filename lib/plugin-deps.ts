// Plugin dependency detection.
//
// Beyond the core npm package, many pi plugins rely on global tooling that must
// be present on the host (language servers, CLIs, …). This module provides a
// robust, extensible way to verify those associated dependencies and to surface
// a precise, copy-pasteable install command when they are missing.
//
// Design goals (per requirements):
//   1. Verify each dependency's availability individually.
//   2. On a miss, list the exact missing package name(s) and the full
//      `npm install -g …` command.
//   3. Be extensible — add an entry to PLUGIN_DEPENDENCIES keyed by the plugin's
//      source id (e.g. "npm:pi-shazam").
//   4. Never crash — every check is wrapped so a single failing probe cannot
//      take down the whole environment scan.
//
// The module reuses the hardened exec helper from mcp-env so timeouts,
// non-zero exits and ENOENT are handled uniformly.

import { execFile } from "node:child_process";
import type { DependencyStatus } from "./env-types";

// Self-contained, hardened exec wrapper. Declared locally (rather than imported
// from mcp-env) so this module stays dependency-free and node-testable without
// forcing `.ts` extension imports app-wide. Mirrors mcp-env's `run` semantics:
// ENOENT → { enoent:true }, hard SIGKILL watchdog, captured output.
interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  enoent: boolean;
}

function run(cmd: string, args: string[], timeoutMs = 10_000): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false;
    const child = execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (settled) return;
      settled = true;
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") {
        resolve({ ok: false, stdout: "", stderr: "", enoent: true });
        return;
      }
      resolve({
        ok: !err,
        stdout: (stdout ?? "").trim(),
        stderr: (stderr ?? "").trim(),
        enoent: false,
      });
    });
    const killer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* noop */
      }
      resolve({ ok: false, stdout: "", stderr: "", enoent: false });
    }, timeoutMs + 2_000);
    killer.unref();
  });
}

/** A single associated global dependency a plugin needs. */
export interface PluginGlobalDependency {
  /** Binary used to verify availability (e.g. `vscode-json-language-server`). */
  binary: string;
  /** npm package(s) to install when the binary is missing. Joined by space for
   *  the install command. May be more than one (e.g. the typescript LSP needs
   *  both `typescript-language-server` and its `typescript` peer). */
  npmPackages: string[];
  /** Optional human label; defaults to `binary`. */
  label?: string;
}

/** Dependency specification for one plugin, keyed by its source id. */
export interface PluginDependencySpec {
  /** Optional label for the core package check (defaults to source). */
  coreLabel?: string;
  /** Associated global/tool dependencies to verify. */
  globals: PluginGlobalDependency[];
}

/** Result of probing one global dependency. */
export interface PluginDepCheck {
  /** Display name (binary or label). */
  name: string;
  binary: string;
  installed: boolean;
  version?: string;
  status: DependencyStatus;
  /** Explanatory detail: the install command when missing, version when present. */
  detail?: string;
  /** Full `npm install -g …` command for this single dependency. */
  installCommand: string;
}

/** Full report for a plugin's associated dependencies. */
export interface PluginDepReport {
  globals: PluginDepCheck[];
  /** Every global dependency is present. */
  allOk: boolean;
  /** Flattened npm package names of every missing dependency. */
  missingPackages: string[];
  /** Combined `npm install -g …` command covering all missing dependencies. */
  installCommand: string;
}

// ---------------------------------------------------------------------------
// Extensible registry. Add a new plugin by appending a keyed entry here.
// ---------------------------------------------------------------------------
export const PLUGIN_DEPENDENCIES: Record<string, PluginDependencySpec> = {
  "npm:pi-shazam": {
    coreLabel: "pi-shazam",
    globals: [
      {
        binary: "vscode-json-language-server",
        npmPackages: ["vscode-langservers-extracted"],
      },
      {
        binary: "typescript-language-server",
        npmPackages: ["typescript-language-server", "typescript"],
      },
      {
        binary: "yaml-language-server",
        npmPackages: ["yaml-language-server"],
      },
    ],
  },
  // To add another plugin's dependencies, append an entry keyed by its source,
  // e.g. "npm:pi-foo": { coreLabel: "pi-foo", globals: [ … ] }.
};

export function getPluginDependencySpec(source: string): PluginDependencySpec | undefined {
  return PLUGIN_DEPENDENCIES[source];
}

/** Build the combined `npm install -g …` command for *all* of a plugin's global
 *  dependencies, regardless of install state. Pure (no shell), handy for letting
 *  the user install everything at once. Returns "" when the plugin has no spec
 *  or no global dependencies. */
export function buildInstallCommandForAll(source: string): string {
  const spec = PLUGIN_DEPENDENCIES[source];
  if (!spec || spec.globals.length === 0) return "";
  const pkgs = Array.from(new Set(spec.globals.flatMap((d) => d.npmPackages)));
  return `npm install -g ${pkgs.join(" ")}`;
}

/** Verify a single binary exists on PATH and capture its version. Never throws. */
async function checkBinary(binary: string): Promise<{ ok: boolean; version?: string }> {
  // `command -v` is the portable existence check; it is a POSIX shell builtin,
  // so invoke it through `sh -c`. Binary names come from our own manifest (not
  // user input), so the quoting is a safety net rather than a requirement.
  const which = await run("sh", ["-c", `command -v '${binary}'`], 10_000);
  if (!which.ok) return { ok: false };

  // Best-effort version capture; ignore failures/timeouts (tool still present).
  let version: string | undefined;
  try {
    const v = await run(binary, ["--version"], 8_000);
    if (v.ok) {
      const m = (v.stdout || v.stderr).match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/);
      if (m) version = m[1];
    }
  } catch {
    /* version probe is best-effort */
  }
  return { ok: true, version };
}

/** Detect all associated global dependencies for a plugin. Robust against
 *  partial registry entries and individual probe failures — it will not throw. */
export async function detectPluginDependencies(source: string): Promise<PluginDepReport> {
  const spec = PLUGIN_DEPENDENCIES[source];
  const empty: PluginDepReport = {
    globals: [],
    allOk: true,
    missingPackages: [],
    installCommand: "",
  };
  if (!spec) return empty;

  const globals: PluginDepCheck[] = [];
  for (const dep of spec.globals) {
    let res: { ok: boolean; version?: string };
    try {
      res = await checkBinary(dep.binary);
    } catch {
      res = { ok: false };
    }
    const installCommand = `npm install -g ${dep.npmPackages.join(" ")}`;
    globals.push({
      name: dep.label ?? dep.binary,
      binary: dep.binary,
      installed: res.ok,
      version: res.version,
      status: res.ok ? "ok" : "missing",
      detail: res.ok ? (res.version ? `v${res.version}` : undefined) : installCommand,
      installCommand,
    });
  }

  const missing = globals.filter((g) => !g.installed);
  const missingPackages = spec.globals
    .filter((d) => missing.some((g) => g.binary === d.binary))
    .flatMap((d) => d.npmPackages);
  const installCommand = missingPackages.length
    ? `npm install -g ${missingPackages.join(" ")}`
    : "";
  return { globals, allOk: missing.length === 0, missingPackages, installCommand };
}
