#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn, execSync } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("os");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const { values: cliArgs, positionals } = parseArgs({
  options: {
    port: { type: "string", short: "p" },
    hostname: { type: "string", short: "H" },
    host: { type: "string" },
  },
  allowPositionals: true,
  strict: false,
});

const port = cliArgs.port ?? process.env.PORT ?? "30141";

/**
 * Resolve the bind hostname for the dev/start server.
 *
 * Precedence (highest first):
 *   1. CLI flag: --host <addr>  (or the legacy -H/--hostname <addr>)
 *   2. PI_WEB_HOST environment variable
 *   3. "127.0.0.1" (loopback only — safe default for an unauthenticated local tool)
 *
 * NOTE: the shell-set `HOSTNAME` env var is intentionally NOT consulted.
 * Many shells export HOSTNAME=<machine-name>, which is not a bind address —
 * using it as a default would either fail to bind or, worse, expose the
 * unauthenticated server on a public interface.
 *
 * @param {{ hostname?: string; host?: string }} cli - parsed CLI values
 * @param {NodeJS.ProcessEnv} env - environment (typically process.env)
 * @returns {string} the address to bind
 */
function resolveHostname(cli, env) {
  const flag = cli.hostname ?? cli.host;
  if (flag) return flag;
  const envHost = env.PI_WEB_HOST;
  if (envHost) return envHost;
  return "127.0.0.1";
}

const hostname = resolveHostname(cliArgs, process.env);
const subcommand = positionals[0]; // "install" | "uninstall" | undefined (= start)

// ============================================================================
// Subcommands: install / uninstall — register pi-web as a system service so it
// auto-starts on login and restarts on crash. Linux uses a systemd user unit;
// macOS uses a launchd plist.
// ============================================================================

const SERVICE_NAME = "pi-web";
const LABEL = "com.pi-web";

/** Absolute path to this bin script — used as ExecStart in service files. */
function binAbsPath() {
  // process.argv[1] is the script path when invoked via node; __dirname is a
  // reliable fallback for bundled/packed scenarios.
  return fs.realpathSync(process.argv[1] || __filename);
}

/** Run a shell command, throwing on failure with a readable message. */
function run(cmd, opts) {
  try {
    return execSync(cmd, { stdio: "pipe", ...opts })
      .toString()
      .trim();
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : e.message;
    throw new Error(`Command failed: ${cmd}\n${stderr}`);
  }
}

function installLinux(port) {
  const systemdDir = path.join(os.homedir(), ".config", "systemd", "user");
  const unitFile = path.join(systemdDir, `${SERVICE_NAME}.service`);
  fs.mkdirSync(systemdDir, { recursive: true });

  const execStart = `${binAbsPath()} start -p ${port}`;
  const unit = [
    "[Unit]",
    "Description=Pi Agent Web",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${execStart}`,
    "Restart=on-failure",
    "RestartSec=3",
    "Environment=NODE_ENV=production",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");

  fs.writeFileSync(unitFile, unit, "utf8");
  console.log(`Written ${unitFile}`);

  run("systemctl --user daemon-reload");
  run(`systemctl --user enable ${SERVICE_NAME}`);
  run(`systemctl --user restart ${SERVICE_NAME}`);

  // Enable lingering so the user service runs even when not logged in.
  try {
    run(`loginctl enable-linger ${os.userInfo().username}`);
    console.log("Enabled lingering (service runs without active login).");
  } catch {
    console.warn("Could not enable linger — service will only run while you are logged in.");
  }

  console.log(`\n✓ pi-web installed. Auto-starts on login, restarts on crash.`);
  console.log(`  Status:  systemctl --user status ${SERVICE_NAME}`);
  console.log(`  Stop:    systemctl --user stop ${SERVICE_NAME}`);
  console.log(`  Logs:    journalctl --user -u ${SERVICE_NAME} -f`);
}

function uninstallLinux() {
  try {
    run(`systemctl --user stop ${SERVICE_NAME}`);
  } catch {
    /* not running */
  }
  try {
    run(`systemctl --user disable ${SERVICE_NAME}`);
  } catch {
    /* not enabled */
  }

  const unitFile = path.join(os.homedir(), ".config", "systemd", "user", `${SERVICE_NAME}.service`);
  if (fs.existsSync(unitFile)) {
    fs.unlinkSync(unitFile);
    console.log(`Removed ${unitFile}`);
  }
  run("systemctl --user daemon-reload");
  console.log("\n✓ pi-web uninstalled.");
}

function installMac(port) {
  const plistDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistFile = path.join(plistDir, `${LABEL}.plist`);
  fs.mkdirSync(plistDir, { recursive: true });

  const binPath = binAbsPath();
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    `  <key>Label</key><string>${LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${binPath}</string>`,
    "    <string>start</string>",
    "    <string>-p</string>",
    `    <string>${port}</string>`,
    "  </array>",
    "  <key>RunAtLoad</key><true/>",
    "  <key>KeepAlive</key><true/>",
    "  <key>StandardOutPath</key><string>/tmp/pi-web.log</string>",
    "  <key>StandardErrorPath</key><string>/tmp/pi-web.err.log</string>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");

  fs.writeFileSync(plistFile, plist, "utf8");
  console.log(`Written ${plistFile}`);

  try {
    run(`launchctl unload ${plistFile}`);
  } catch {
    /* not loaded */
  }
  run(`launchctl load ${plistFile}`);
  console.log(`\n✓ pi-web installed. Auto-starts on login, restarts on crash.`);
  console.log(`  Status:  launchctl list | grep ${LABEL}`);
  console.log(`  Stop:    launchctl unload ${plistFile}`);
  console.log(`  Logs:    tail -f /tmp/pi-web.log`);
}

function uninstallMac() {
  const plistFile = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
  try {
    run(`launchctl unload ${plistFile}`);
  } catch {
    /* not loaded */
  }
  if (fs.existsSync(plistFile)) {
    fs.unlinkSync(plistFile);
    console.log(`Removed ${plistFile}`);
  }
  console.log("\n✓ pi-web uninstalled.");
}

// ============================================================================
// Main
// ============================================================================

if (subcommand === "install") {
  if (!fs.existsSync(nextDir)) {
    console.error(
      "Build artifacts not found. Run `pi-web` once first (or `npm run build`), then `pi-web install`.",
    );
    process.exit(1);
  }
  try {
    if (process.platform === "darwin") installMac(port);
    else if (process.platform === "linux") installLinux(port);
    else {
      console.error(`Auto-start is not supported on ${process.platform}.`);
      process.exit(1);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  process.exit(0);
}

if (subcommand === "uninstall") {
  try {
    if (process.platform === "darwin") uninstallMac();
    else if (process.platform === "linux") uninstallLinux();
    else {
      console.error(`Auto-start is not supported on ${process.platform}.`);
      process.exit(1);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  process.exit(0);
}

// Default: start the server (original behavior, unchanged)
// Guarded by import.meta.url === main so importing this module for tests
// does not spawn a server.
const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);

if (isMain) {
  startServer();
}

function startServer() {
  if (!fs.existsSync(nextDir)) {
    console.error("Build artifacts not found. Please report this issue.");
    process.exit(1);
  }

  // Security warning when binding to anything other than loopback.
  // pi-web has no authentication; non-loopback binding exposes the agent,
  // filesystem, and API keys to anyone who can reach the host.
  const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  if (!isLoopback) {
    console.warn(
      `\n⚠️  WARNING: pi-web is binding to "${hostname}" (non-loopback).\n` +
        `   pi-web has NO authentication. Anyone on this network can read your\n` +
        `   files, dispatch agent commands, and access your API keys.\n` +
        `   Only continue if you trust the network. Use 127.0.0.1 (the default)\n` +
        `   for single-user local use.\n`,
    );
  }

  const nextArgs = ["start", "-p", port];
  if (hostname) nextArgs.push("-H", hostname);

  // Always run next's JS entry with node directly — avoids .bin symlink issues
  // and path-with-spaces problems on Windows when shell: true is used.
  const child = spawn(process.execPath, [nextBin, ...nextArgs], {
    cwd: pkgDir,
    stdio: ["inherit", "pipe", "inherit"],
    env: { ...process.env },
  });

  let browserOpened = false;
  const url = `http://${hostname}:${port}`;

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (!browserOpened && text.includes("Ready")) {
      browserOpened = true;
      const isWindows = process.platform === "win32";
      const isMac = process.platform === "darwin";
      const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
      const opener = spawn(openCmd, [url], {
        shell: isWindows,
        stdio: "ignore",
        detached: true,
      });

      opener.on("error", (error) => {
        console.warn(`Could not open browser automatically: ${error.message}`);
      });

      opener.unref();
    }
  });

  child.on("exit", (code) => process.exit(code ?? 0));
}

// Exports for unit tests (bin/hostname.test.mjs). Only reachable when imported
// as a module; the start path above is guarded by isMain.
module.exports = { resolveHostname };
