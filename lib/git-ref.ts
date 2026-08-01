/**
 * 纯逻辑 git 辅助（无 IO、无 @/ 依赖，可由 node:test 直接覆盖）。
 */

const GIT_REF_NAME_RE = /^[A-Za-z0-9._/-]+$/;

/**
 * 校验 git 分支 / ref 名称。采用保守允许清单（字母数字、`._` `/` `-`），
 * 拒绝空白、控制字符、长度越界与 `..` 段（防止 ref 命名空间穿越）。
 */
export function isValidGitRefName(name: string): boolean {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 250) return false;
  if (!GIT_REF_NAME_RE.test(name)) return false;
  if (name.split("/").includes("..")) return false;
  if (name.startsWith("-") || name.endsWith("/") || name.endsWith(".lock")) {
    return false;
  }
  return true;
}
