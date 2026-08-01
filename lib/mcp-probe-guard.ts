// S3 加固：MCP stdio 探针的命令/参数白名单（纯函数，无 Next 依赖，可单测）。
// probeStdio 经 execFile 数组式调用（无 shell），但 command 原本是用户完全
// 可控的任意可执行路径，可被篡改为 /bin/bash -c "..." 实现 RCE。此处收敛为
// 仅允许 PATH 基名白名单内的已知安全二进制，且拒绝任何含路径分隔符、shell
// 元字符或 "--" 选项注入的参数。

// stdio 探针常见二进制（MCP server 启动器）。如需扩展，显式加入此表。
export const ALLOWED_STDIO_COMMANDS = new Set([
  "node",
  "node.exe",
  "npx",
  "npx.cmd",
  "python",
  "python3",
  "python.exe",
  "uvx",
  "deno",
  "bun",
  "go",
  "java",
  "ruby",
  "php",
  "docker",
  "podman",
]);

// 拒绝含路径分隔符、父目录引用、shell 元字符或选项前缀的参数。
const ARG_DANGEROUS_RE = /[/\\]|^\.\.?$|--|;|&|\||<|>|`|\$|\n|\r|'/;

export function isCommandAllowed(command: string): boolean {
  if (!command || !command.trim()) return false;
  if (command.includes("/") || command.includes("\\")) return false; // 拒绝任何路径
  return ALLOWED_STDIO_COMMANDS.has(command);
}

export function isArgsSafe(args: unknown): boolean {
  if (!Array.isArray(args)) return args === undefined; // 允许缺省
  for (const a of args) {
    if (typeof a !== "string") return false;
    if (ARG_DANGEROUS_RE.test(a)) return false;
  }
  return true;
}
