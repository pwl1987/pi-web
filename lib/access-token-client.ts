// 客户端访问令牌（S1 网关）的 localStorage 存取。
// 令牌明文仅由启动终端经 ?token= 交付给浏览器首屏，存于 localStorage 后由
// csrf-client 统一注入 Authorization 头。浏览器侧绝不向任何端点回传明文以外的信息。

const STORAGE_KEY = "pi-web-access-token";

/** 读取访问令牌；SSR / 未设置时返回 null。 */
export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 写入访问令牌。 */
export function setAccessToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* 忽略：隐私模式等写入失败不应阻断 */
  }
}

/** 删除访问令牌（登出/切换）。 */
export function clearAccessToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}
