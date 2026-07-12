// Unified environment detection, compatibility validation and dependency
// provisioning for MCP servers and pi plugins.
//
// The pipeline is intentionally uniform across both capability kinds so that the
// UI, error handling and trigger logic stay identical:
//
//   1. detect   — identify the required base runtime and whether it is present
//   2. compat   — validate version compatibility (npm engines, docker daemon…)
//   3. install  — download/fetch the capability's own dependency (npx/uvx pkg,
//                 docker image pull) — this is the "auto install" step
//   4. init     — capability-specific one-time setup (e.g. `codegraph init`)
//
// Base runtimes (Node/Python/uv/Docker/Bun/Deno) are NOT auto-installed — doing
// so from a web server is unsafe and usually requires system privileges. When a
// base runtime is missing we return a clear, actionable error instead.

import { execFile } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type {
  CapabilityEnv,
  DependencyCheck,
  EnvScanItem,
  EnvScanResult,
  EnvStep,
  ProvisionResult,
  ProvisionStatus,
  RuntimeName,
  RuntimeStatus,
} from "./env-types";
import { detectPluginDependencies } from "./plugin-deps";

// Generous ceiling: `codegraph init` can index a whole project tree.
const PROVISION_TIMEOUT_MS = 300_000;

interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  enoent: boolean;
}

/** Run a command with a hard SIGKILL watchdog. No execFile-internal timeout so
 *  that long-lived stdio servers can be cleanly killed and reported as "started". */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = opts.timeout ?? 60_000;
    const child = execFile(
      cmd,
      args,
      { cwd: opts.cwd, windowsHide: true },
      (err, stdout, stderr) => {
        if (settled) return;
        settled = true;
        const s = (stdout ?? "").trim();
        const e = (stderr ?? "").trim();
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            resolve({ ok: false, code: null, stdout: s, stderr: e, timedOut: false, enoent: true });
            return;
          }
          // Any other failure (non-zero exit, killed) — surface captured output.
          resolve({ ok: false, code: null, stdout: s, stderr: e, timedOut: false, enoent: false });
          return;
        }
        resolve({ ok: true, code: 0, stdout: s, stderr: e, timedOut: false, enoent: false });
      },
    );
    const killer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* noop */
      }
      resolve({ ok: false, code: null, stdout: "", stderr: "", timedOut: true, enoent: false });
    }, timeout + 2_000);
    killer.unref();
  });
}

function cap(s: string, n = 2000): string {
  return s.length > n ? s.slice(0, n) + "\n…(truncated)" : s;
}

function parseVersion(v: string): number[] | null {
  const m = v.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Naive semver-range check supporting >=, >, ^, ~, || (first clause) and exact. */
function satisfiesRange(range: string, installed: number[]): boolean | null {
  const r = range.trim();
  if (!r) return null;
  const first = r.split("||")[0].trim();
  if (first.startsWith(">=")) {
    const v = parseVersion(first.slice(2));
    return v ? cmp(installed, v) >= 0 : null;
  }
  if (first.startsWith(">")) {
    const v = parseVersion(first.slice(1));
    return v ? cmp(installed, v) > 0 : null;
  }
  if (first.startsWith("^")) {
    const base = parseVersion(first.slice(1));
    if (!base) return null;
    const upper = base[0] === 0 ? [0, base[1] + 1, 0] : [base[0] + 1, 0, 0];
    return cmp(installed, base) >= 0 && cmp(installed, upper) < 0;
  }
  if (first.startsWith("~")) {
    const base = parseVersion(first.slice(1));
    if (!base) return null;
    return cmp(installed, base) >= 0 && cmp(installed, [base[0], base[1] + 1, 0]) < 0;
  }
  const v = parseVersion(first);
  return v ? cmp(installed, v) === 0 : null;
}

const RUNTIME_VERSION_ARGS: Record<RuntimeName, [string, string[]]> = {
  node: ["node", ["--version"]],
  uv: ["uv", ["--version"]],
  python3: ["python3", ["--version"]],
  bun: ["bun", ["--version"]],
  deno: ["deno", ["--version"]],
  docker: ["docker", ["--version"]],
};

export async function detectRuntime(name: RuntimeName): Promise<RuntimeStatus> {
  const [cmd, args] = RUNTIME_VERSION_ARGS[name];
  const r = await run(cmd, args, { timeout: 15_000 });
  if (r.enoent) {
    return { name, available: false, error: `runtime ${name} not found` };
  }
  if (!r.ok) {
    return { name, available: false, error: r.stderr || r.stdout || "runtime check failed" };
  }
  const version = (r.stdout || r.stderr).trim();
  return { name, available: true, version: parseVersion(version) ? version : version };
}

export function runtimeForCommand(command?: string): RuntimeName {
  const c = (command ?? "").toLowerCase();
  if (c === "uvx" || c === "uv") return "uv";
  if (c === "python3" || c === "python") return "python3";
  if (c === "bun") return "bun";
  if (c === "deno") return "deno";
  if (c === "docker") return "docker";
  return "node"; // npx, npm, node, bunx, default
}

/** Extract the package/image name from a command's args.
 *  - npx/uvx: first positional arg after -y/--yes that isn't a flag or "." */
function extractPackage(command?: string, args: string[] = []): string | undefined {
  const c = (command ?? "").toLowerCase();
  if (c !== "npx" && c !== "uvx" && c !== "uv" && c !== "npm") return undefined;
  const filtered = args.filter((a) => a !== "-y" && a !== "--yes");
  const positional = filtered.find((a) => !a.startsWith("-"));
  if (!positional || positional === "." || positional === "..") return undefined;
  return positional;
}

function extractImage(args: string[] = []): string | undefined {
  // docker run -i --rm <image> ...  → first positional not a flag
  const positional = args
    .filter((a) => !a.startsWith("-"))
    .find((a) => a.includes(":") || /[\w.-]+\/[\w.-]+/.test(a));
  return positional;
}

function isCodeGraph(command?: string, args: string[] = []): boolean {
  const c = (command ?? "").toLowerCase();
  const a = (args ?? []).join(" ").toLowerCase();
  return c.includes("codegraph") || a.includes("codegraph");
}

async function checkCompatibility(
  env: CapabilityEnv,
  rt: RuntimeStatus,
  packageName: string | undefined,
): Promise<{ steps: EnvStep[]; failed: boolean; version?: string; engine?: string }> {
  const steps: EnvStep[] = [];
  let failed = false;
  let version: string | undefined;
  let engine: string | undefined;

  if (env.kind === "mcp" && !env.command) return { steps, failed, version, engine }; // remote

  if (rt.name === "docker") {
    const daemon = await run("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: 15_000,
    });
    if (!daemon.ok) {
      steps.push({
        key: "env.dockerDaemonDown",
        status: "error",
        detail: cap(daemon.stderr || daemon.stdout),
      });
      failed = true;
    } else {
      steps.push({
        key: "env.dockerDaemonUp",
        args: { version: daemon.stdout.trim() },
        status: "ok",
      });
    }
    return { steps, failed, version, engine };
  }

  if (rt.name === "node" && packageName) {
    const [verRes, engRes] = await Promise.all([
      run("npm", ["view", packageName, "version"], { timeout: 30_000 }),
      run("npm", ["view", packageName, "engines.node"], { timeout: 30_000 }),
    ]);
    if (verRes.ok) {
      version = verRes.stdout.trim();
      steps.push({ key: "env.packageResolved", args: { pkg: packageName, version }, status: "ok" });
    } else {
      steps.push({
        key: "env.registryUnreachable",
        args: { pkg: packageName },
        status: "info",
        detail: cap(verRes.stderr || verRes.stdout),
      });
    }
    const eng = (engRes.stdout ?? "").trim();
    if (engRes.ok && eng && eng !== "undefined") {
      engine = eng;
      if (rt.version) {
        const installed = parseVersion(rt.version);
        const ok = installed ? satisfiesRange(eng, installed) : null;
        if (ok === false) {
          steps.push({
            key: "env.incompatibleEngine",
            args: { pkg: packageName, required: eng, have: rt.version },
            status: "error",
          });
          failed = true;
        } else if (ok === true) {
          steps.push({
            key: "env.compatible",
            args: { pkg: packageName, required: eng },
            status: "ok",
          });
        } else {
          steps.push({
            key: "env.engineUnknown",
            args: { pkg: packageName, required: eng },
            status: "info",
          });
        }
      }
    }
  }

  return { steps, failed, version, engine };
}

async function installPackage(
  env: CapabilityEnv,
  rt: RuntimeStatus,
  packageName: string | undefined,
  version?: string,
): Promise<{ steps: EnvStep[] }> {
  const steps: EnvStep[] = [];
  if (env.kind === "mcp" && !env.command) return { steps };

  if (rt.name === "node" && packageName) {
    // Real dependency install: download + install the package into a throwaway
    // prefix. Avoids running the server (which would block on stdio) and works
    // uniformly for packages that treat `--version` as a positional argument.
    const tmp = mkdtempSync(join(tmpdir(), "pi-mcp-"));
    const r = await run("npm", ["install", "--no-save", "--prefix", tmp, packageName], {
      timeout: 120_000,
    });
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* noop */
    }
    if (r.enoent) {
      steps.push({ key: "env.missing.node", status: "error" });
    } else if (r.ok) {
      steps.push({
        key: "env.packageFetched",
        args: { pkg: packageName, version: version ?? "" },
        status: "ok",
      });
    } else {
      steps.push({
        key: "env.packageFetchWarn",
        args: { pkg: packageName },
        status: "warn",
        detail: cap(r.stdout || r.stderr),
      });
    }
  } else if (rt.name === "uv" && packageName) {
    const r = await run("uvx", [packageName, "--help"], { timeout: 120_000 });
    if (r.timedOut)
      steps.push({ key: "env.packageStarted", args: { pkg: packageName }, status: "info" });
    else if (r.ok)
      steps.push({ key: "env.packageFetched", args: { pkg: packageName }, status: "ok" });
    else
      steps.push({
        key: "env.packageFetchWarn",
        args: { pkg: packageName },
        status: "warn",
        detail: cap(r.stdout || r.stderr),
      });
  } else if (rt.name === "docker") {
    const image = extractImage(env.args);
    if (image) {
      const r = await run("docker", ["pull", image], { timeout: PROVISION_TIMEOUT_MS });
      if (r.ok) steps.push({ key: "env.imagePulled", args: { image }, status: "ok" });
      else
        steps.push({
          key: "env.imagePullFailed",
          args: { image },
          status: "error",
          detail: cap(r.stderr || r.stdout),
        });
    }
  }
  return { steps };
}

async function runInitSteps(env: CapabilityEnv): Promise<{ steps: EnvStep[] }> {
  const steps: EnvStep[] = [];
  if (env.kind === "mcp" && isCodeGraph(env.command, env.args) && env.cwd) {
    const r = await run("npx", ["-y", "@colbymchenry/codegraph", "init"], {
      cwd: env.cwd,
      timeout: PROVISION_TIMEOUT_MS,
    });
    if (r.ok) steps.push({ key: "env.codegraphInitDone", status: "ok" });
    else
      steps.push({
        key: "env.codegraphInitFailed",
        status: "error",
        detail: cap(r.stdout || r.stderr),
      });
  }
  return { steps };
}

/** Resolve the runtime + package name for a capability (uniform across kinds). */
function resolveTarget(env: CapabilityEnv): { runtimeName: RuntimeName; packageName?: string } {
  if (env.kind === "plugin") {
    let packageName: string | undefined;
    if (env.source?.startsWith("npm:")) packageName = env.source.slice(4);
    return { runtimeName: "node", packageName };
  }
  return {
    runtimeName: runtimeForCommand(env.command),
    packageName: extractPackage(env.command, env.args),
  };
}

/** Detect + validate + install a single capability and return a full
 *  per-dependency breakdown. This is the unified unit of work shared by the
 *  single-capability endpoint and the comprehensive integrity scan. */
export async function provisionOne(
  env: CapabilityEnv,
  opts: { install?: boolean } = {},
): Promise<EnvScanItem> {
  const install = opts.install !== false;
  const steps: EnvStep[] = [];
  const dependencies: DependencyCheck[] = [];
  const base: Omit<EnvScanItem, "status" | "ok" | "runtime" | "steps" | "dependencies"> = {
    kind: env.kind,
    id: env.id,
    label: env.label,
    command: env.command,
    transport: env.kind === "mcp" ? (env.url ? "url" : "stdio") : undefined,
  };

  if (env.kind === "mcp" && !env.command && env.url) {
    steps.push({ key: "env.remoteNoEnv", status: "info" });
    dependencies.push({ name: env.url, type: "other", installed: true, status: "skip" });
    return { ...base, status: "ready", ok: true, dependencies, steps };
  }

  const { runtimeName, packageName } = resolveTarget(env);
  const rt = await detectRuntime(runtimeName);
  dependencies.push({
    name: runtimeName,
    type: "runtime",
    installed: rt.available,
    version: rt.version,
    status: rt.available ? "ok" : "missing",
    detail: rt.error,
  });
  if (!rt.available) {
    steps.push({ key: `env.missing.${runtimeName}`, status: "error", detail: rt.error });
    return { ...base, status: "missing-runtime", ok: false, runtime: rt, dependencies, steps };
  }
  steps.push({
    key: "env.runtimeDetected",
    args: { runtime: runtimeName, version: rt.version ?? "" },
    status: "ok",
  });

  const compat = await checkCompatibility(env, rt, packageName);
  steps.push(...compat.steps);
  if (compat.failed) {
    // Record the failed package dependency before bailing out.
    if (packageName) {
      dependencies.push({
        name: packageName,
        type: "package",
        installed: false,
        required: compat.engine,
        status: "incompatible",
      });
    }
    return { ...base, status: "incompatible", ok: false, runtime: rt, dependencies, steps };
  }

  const installRes = install
    ? await installPackage(env, rt, packageName, compat.version)
    : { steps: [] };
  steps.push(...installRes.steps);

  const init = await runInitSteps(env);
  steps.push(...init.steps);

  // Plugin-specific associated dependencies (e.g. language servers required by
  // pi-shazam). Sourced from the extensible PLUGIN_DEPENDENCIES registry; plugins
  // without a manifest are unaffected. Wrapped so a probe failure cannot crash
  // the whole scan.
  if (env.kind === "plugin" && env.source) {
    try {
      const depReport = await detectPluginDependencies(env.source);
      for (const g of depReport.globals) {
        dependencies.push({
          name: g.name,
          type: "package",
          installed: g.installed,
          version: g.version,
          status: g.status,
          detail: g.installed ? g.detail : g.installCommand,
        });
      }
      if (!depReport.allOk) {
        // Precise, actionable error: list every missing package + full command.
        steps.push({
          key: "env.pluginDepsMissing",
          args: { pkgs: depReport.missingPackages.join(", "), cmd: depReport.installCommand },
          status: "error",
          detail: depReport.installCommand,
        });
      }
    } catch (error) {
      steps.push({
        key: "env.pluginDepCheckError",
        status: "warn",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Record the package / image dependency with its post-install status.
  if (rt.name === "node" && packageName) {
    const installed = installRes.steps.some((s) => s.status === "ok");
    dependencies.push({
      name: packageName,
      type: "package",
      installed,
      version: compat.version,
      required: compat.engine,
      status: compat.failed ? "incompatible" : installed ? "ok" : "warn",
    });
  } else if (rt.name === "uv" && packageName) {
    const installed = installRes.steps.some((s) => s.status === "ok");
    dependencies.push({
      name: packageName,
      type: "package",
      installed,
      status: installed ? "ok" : "warn",
    });
  } else if (rt.name === "docker") {
    const image = extractImage(env.args);
    if (image) {
      const pulled = installRes.steps.some((s) => s.status === "ok");
      dependencies.push({
        name: image,
        type: "image",
        installed: pulled,
        status: pulled ? "ok" : "missing",
      });
    }
  }

  const failed = steps.some((s) => s.status === "error");
  const didWork =
    installRes.steps.some((s) => s.status === "ok" || s.status === "info") ||
    init.steps.some((s) => s.status === "ok");
  const status: ProvisionStatus = failed ? "failed" : didWork ? "provisioned" : "ready";
  return { ...base, status, ok: !failed, runtime: rt, dependencies, steps };
}

/** Run a comprehensive integrity scan across many capabilities (all MCP
 *  services + all plugins), performing detection and optional installation for
 *  each, and returning every dependency check so the UI can show a complete
 *  per-item breakdown. Runs with bounded concurrency so a large inventory does
 *  not overwhelm the host. */
export async function scanAllEnvironments(
  capabilities: CapabilityEnv[],
  opts: { install?: boolean; concurrency?: number } = {},
): Promise<EnvScanResult> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, capabilities.length || 1));
  const items: EnvScanItem[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < capabilities.length) {
      const idx = cursor++;
      const env = capabilities[idx];
      try {
        items[idx] = await provisionOne(env, { install: opts.install });
      } catch (error) {
        items[idx] = {
          kind: env.kind,
          id: env.id,
          label: env.label,
          command: env.command,
          transport: env.kind === "mcp" ? (env.url ? "url" : "stdio") : undefined,
          status: "failed",
          ok: false,
          dependencies: [],
          steps: [
            {
              key: "raw",
              status: "error",
              detail: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { ok: items.every((i) => i.ok), items };
}

/** Backwards-compatible single-capability provisioning (used by the
 *  /api/mcp-config/env/setup endpoint). */
export async function provisionCapability(env: CapabilityEnv): Promise<ProvisionResult> {
  const item = await provisionOne(env, { install: true });
  return { ok: item.ok, status: item.status, runtime: item.runtime, steps: item.steps };
}
