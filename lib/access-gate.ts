// S1 访问网关的核心校验逻辑（纯函数，Node + Edge 双兼容）。
// 抽离自 app/middleware.ts，便于无 Next 依赖的单测覆盖。
//
// 三源令牌任选其一：Authorization: Bearer / __Host-pi-access cookie / ?token=
// 与 expectedHash(sha256) 做定时安全比较。
import { timingSafeEqual } from "crypto";

/** 用 Web Crypto 计算 sha256 hex（Edge 可用）。 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(new Uint8Array(digest)).toString("hex");
}

/** 长度安全 + 定时安全的哈希比较（不等长直接 false，避免异常）。 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/**
 * 从请求表示中提取提供的令牌（三源）。
 * req 为最小接口，便于测试 mock：
 *   { authorization?: string|null, cookieToken?: string|null, queryToken?: string|null }
 */
export function extractProvidedToken(req: {
  authorization?: string | null;
  cookieToken?: string | null;
  queryToken?: string | null;
}): string | null {
  const fromAuth = req.authorization?.replace(/^Bearer\s+/i, "");
  if (fromAuth) return fromAuth;
  if (req.cookieToken) return req.cookieToken;
  if (req.queryToken) return req.queryToken;
  return null;
}

/**
 * 校验访问令牌。
 * - expectedHash 为空（未配置）→ 返回 "no-token-configured"（D2 强制拒绝）。
 * - 无提供令牌 → "missing-token"。
 * - 哈希不匹配 → "bad-token"。
 * - 匹配 → null（放行）。
 */
export async function verifyAccessToken(
  provided: string | null,
  expectedHash: string | undefined,
): Promise<string | null> {
  if (!expectedHash) return "no-token-configured";
  if (!provided) return "missing-token";
  const h = await sha256Hex(provided);
  if (!safeEqualHex(h, expectedHash)) return "bad-token";
  return null;
}
