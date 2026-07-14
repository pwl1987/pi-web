import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { validateCsrf } from "@/lib/csrf";
import { safeJsonBody } from "@/lib/api-utils";
import { isHostBlocked } from "@/lib/net-private";

export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 8000;

interface McpProbeRequest {
  transport: "stdio" | "url";
  command?: string;
  args?: string[];
  url?: string;
}

interface McpProbeResult {
  reachable: boolean;
  detail: string;
  latencyMs?: number;
}

// Lightweight reachability probe — NOT a full MCP handshake.
//  - stdio: spawn the command with --version and confirm it runs within the
//    timeout (ENOENT / timeout => unreachable). No side effects.
//  - url: issue a request and confirm the connection establishes (any 2xx/3xx
//    response counts as reachable; only network errors/timeouts fail).
export async function POST(req: Request) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  const [body, parseError] = await safeJsonBody<McpProbeRequest>(req);
  if (parseError) return parseError;

  const transport = body.transport;
  if (transport !== "stdio" && transport !== "url") {
    return NextResponse.json({ error: "transport must be stdio or url" }, { status: 400 });
  }

  try {
    const result: McpProbeResult =
      transport === "stdio" ? await probeStdio(body.command, body.args) : await probeUrl(body.url);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { reachable: false, detail: error instanceof Error ? error.message : String(error) },
      { status: 200 },
    );
  }
}

function probeStdio(command?: string, args?: string[]): Promise<McpProbeResult> {
  return new Promise((resolve) => {
    if (!command || !command.trim()) {
      resolve({ reachable: false, detail: "mcp.probe.noCommand" });
      return;
    }
    const start = Date.now();
    const childArgs = [...(Array.isArray(args) ? args : []), "--version"];
    const child = execFile(
      command,
      childArgs,
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
      (err) => {
        const latencyMs = Date.now() - start;
        if (err) {
          // ENOENT => command not found. Any other error (non-zero exit) still
          // means the binary exists and ran, so treat as reachable.
          const detail =
            err.message.includes("ENOENT") || (err as NodeJS.ErrnoException).code === "ENOENT"
              ? "mcp.probe.commandNotFound"
              : "mcp.probe.commandFailed";
          resolve({
            reachable: err.message.includes("ENOENT") ? false : true,
            detail,
            latencyMs,
          });
          return;
        }
        resolve({ reachable: true, detail: "mcp.probe.reachable", latencyMs });
      },
    );
    // Hard kill on timeout in case execFile's timeout didn't reap it.
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* noop */
      }
    }, PROBE_TIMEOUT_MS + 500).unref();
  });
}

async function probeUrl(url?: string): Promise<McpProbeResult> {
  if (!url || !url.trim()) return { reachable: false, detail: "mcp.probe.noUrl" };
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { reachable: false, detail: "mcp.probe.urlInvalid" };
    }
  } catch {
    return { reachable: false, detail: "mcp.probe.urlInvalid" };
  }
  // SSRF 防护：拒绝指向内网/回环/链路本地/保留地址的主机。
  if (await isHostBlocked(parsed.hostname)) {
    return { reachable: false, detail: "mcp.probe.blocked" };
  }
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    await fetch(parsed.toString(), {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    // 连接已建立（含 3xx）即视为可达；manual 不跟随重定向，阻断内网跳转侦察。
    return { reachable: true, detail: "mcp.probe.reachable", latencyMs };
  } catch {
    const latencyMs = Date.now() - start;
    return { reachable: false, detail: "mcp.probe.unreachable", latencyMs };
  }
}
