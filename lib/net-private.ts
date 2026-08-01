// SSRF 防护：判定主机是否指向私有/回环/链路本地/保留地址。
// 纯逻辑模块，不依赖 next/server，便于 node:test 直接单测。

import { lookup } from "node:dns/promises";

/** 判断字符串是否为合法 IPv4 字面量（四个 0-255 十进制段）。 */
export function isIpv4Literal(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

/** 判断字符串是否为 IP 字面量（IPv6 含冒号；IPv4 需四段合法）。 */
export function isIpLiteral(ip: string): boolean {
  if (ip.includes(":")) return true;
  return isIpv4Literal(ip);
}

/** 判断 IPv4 是否落在私有/回环/链路本地/保留段。
 *  仅对合法 IPv4 字面量生效；非字面量（如域名）返回 false，交由 DNS 解析判定。 */
export function isPrivateIpv4(ip: string): boolean {
  if (!isIpv4Literal(ip)) return false;
  const parts = ip.split(".").map((n) => Number(n));
  const [a, b, c] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // 127.0.0.0/8 回环
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 链路本地/元数据
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a >= 240) return true; // 240.0.0.0/4 保留
  return false;
}

/** 判断 IPv6 是否私有/回环/链路本地/保留，含 IPv4 映射地址回退检查。 */
export function isPrivateIpv6(ip: string): boolean {
  const v = ip.toLowerCase().split("%")[0]; // 去掉 zone id
  if (v === "::1" || v === "::") return true; // 回环 / 未指定
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // fc00::/7 ULA
  if (v.startsWith("fe80")) return true; // fe80::/10 链路本地
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4 映射
  if (mapped) return isPrivateIpv4(mapped[1]);
  const compat = v.match(/^::(\d+\.\d+\.\d+\.\d+)$/); // IPv4 兼容（已废弃）
  if (compat) return isPrivateIpv4(compat[1]);
  return false;
}

/** 判断任意 IP 字面量是否私有；非 IP 字面量（如域名）返回 false。 */
export function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) return isPrivateIpv6(ip);
  return isIpLiteral(ip) ? isPrivateIpv4(ip) : false;
}

type LookupAddress = { address: string; family: number };
type LookupFn = (hostname: string) => Promise<LookupAddress[]>;

/** 解析主机名并拒绝解析到私有/保留段的地址（SSRF 防护）。
 *  DNS 解析失败时失败闭环（视为被禁止），既不泄漏 DNS 错误也不放行。
 *  resolve 默认使用 dns.lookup，可注入以便单测。 */
export async function isHostBlocked(
  hostname: string,
  resolve: LookupFn = (h) => lookup(h, { all: true }),
): Promise<boolean> {
  // 仅对 IP 字面量直接判定；域名交给 DNS 解析后逐地址检查。
  if (isIpLiteral(hostname) && isPrivateIp(hostname)) return true;
  try {
    const results = await resolve(hostname);
    return results.some((r) => isPrivateIp(r.address));
  } catch {
    return true;
  }
}
