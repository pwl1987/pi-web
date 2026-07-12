// comet-cli.ts —— 白名单调用 comet 的 .mjs 脚本（不可信供应链隔离）
// 规则：仅允许调用 ALLOWED_SCRIPTS 内的脚本；cwd 必须为绝对路径；带超时与参数约束。
// 绝不 import() 上游 comet-runtime.mjs（471KB 运行时），全部经 child_process 隔离执行。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

// 真实运行时代码位于 assets/skills/comet/scripts/，8 个 .mjs 为薄壳
const COMET_SCRIPTS_DIR = join(
  process.cwd(),
  "vendor",
  "comet",
  "assets",
  "skills",
  "comet",
  "scripts",
);

const ALLOWED_SCRIPTS = new Set<string>([
  "comet-state.mjs",
  "comet-guard.mjs",
  "comet-handoff.mjs",
  "comet-archive.mjs",
  "comet-yaml-validate.mjs",
  "comet-env.mjs",
]);

export interface CometCliResult {
  stdout: string;
  code: number;
}

/** 以白名单方式生成 comet 脚本；任何越权或非法 cwd 直接拒绝。 */
export async function runCometScript(
  script: string,
  args: string[],
  cwd: string,
): Promise<CometCliResult> {
  if (!ALLOWED_SCRIPTS.has(script)) {
    throw new Error(`未授权的 comet 脚本：${script}`);
  }
  if (!cwd || !cwd.startsWith("/")) {
    throw new Error("comet 调用要求绝对路径 cwd");
  }
  // 约束 argv：禁止空参、禁止包含路径穿越片段
  for (const a of args) {
    if (a.includes("..") || a.includes("\0")) {
      throw new Error(`非法 comet 参数：${a}`);
    }
  }
  const scriptPath = join(COMET_SCRIPTS_DIR, script);
  try {
    const { stdout } = await execFileAsync("node", [scriptPath, ...args], {
      cwd,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: stdout.toString(), code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; code?: number };
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.toString();
    return { stdout: out, code: typeof err.code === "number" ? err.code : 1 };
  }
}

/** 读取 comet change 的单个字段（comet-state.mjs get <change> <field>） */
export async function cometGet(change: string, field: string, cwd: string): Promise<string> {
  const { stdout, code } = await runCometScript("comet-state.mjs", ["get", change, field], cwd);
  if (code !== 0) return "";
  return stdout.trim();
}
