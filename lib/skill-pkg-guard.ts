// S4 加固：npm 包名格式白名单（纯函数，无 Next 依赖，可单测）。
// skills/install 经 `npx skills add <pkg>` 执行，pkg 若含空格/选项前缀/路径
// 分隔符，会被解释为 npx 选项或任意命令，导致选项注入/命令执行。此处收敛为
// 标准 npm 包名格式：<name> | @scope/name | name@version | @scope/name@version。
// 同时调用方须拒绝含 "--" 的包名（防 npx 选项注入）。

// 允许：name / @scope/name / name@version / @scope/name@version
export const SAFE_PKG_RE =
  /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[a-z0-9][a-z0-9._+-]*)?$/i;

export function isPackageNameSafe(pkg: string): boolean {
  const trimmed = pkg?.trim();
  if (!trimmed) return false;
  if (trimmed.includes("--")) return false; // 拒绝 npx 选项注入
  return SAFE_PKG_RE.test(trimmed);
}
