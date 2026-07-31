// 本地访问令牌（S1 网关）的生成与持久化。
//
// 设计要点：
// - 启动生成一次性随机令牌；明文**仅**交付给启动终端 + 自动打开的浏览器 URL。
// - 服务端**只存 sha256 哈希**（绝不存明文），落盘权限 0600。
// - 重启复用同一哈希（令牌不变，避免每次重启都需重新认证）。
// - 纯 fs 实现、刻意 @/-free（内联 getAgentDir），便于 node --test 直接 import。
//
// 安全约束（与 S1 提案一致）：
// - 不提供「任何人连上即可取令牌」的引导端点；明文绝不经任何响应回传。
// - Edge middleware 不能读本地文件 → 哈希必须经 env (PI_WEB_ACCESS_TOKEN_HASH) 传入。

import { randomBytes, createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, renameSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const AUTH_FILE = "pi-web-auth.json";

/** 解析 agentDir（与 lib/config-file.getAgentDir 一致，内联以避免 @/ 依赖）。 */
export function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

/** 令牌档案落盘路径。 */
export function authFilePath(agentDir?: string): string {
  return join(agentDir || getAgentDir(), AUTH_FILE);
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export interface AccessToken {
  /** 明文令牌（仅启动时打印/注入浏览器，不持久化）。 */
  plain: string;
  /** sha256(plain)，持久化且注入运行时 env。 */
  hash: string;
}

/**
 * 确保访问令牌存在：复用已有哈希（重启不变），否则生成并原子写入 0600 文件。
 * 返回 { plain, hash }；plain 仅在本次进程生命周期内可用。
 */
export function ensureAccessToken(agentDir?: string): AccessToken {
  const file = authFilePath(agentDir);
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as { hash?: string };
      if (raw.hash && typeof raw.hash === "string" && raw.hash.length === 64) {
        // 已有哈希：复用。但需同时返回可供本次启动注入浏览器的明文——
        // 由于明文不落盘，重启后无法还原，故仅在「首次生成」时持有明文。
        // 此处返回 hash 占位，plain 由调用方在首次生成分支处理。
        return { plain: "", hash: raw.hash };
      }
    } catch {
      // 损坏文件 → 覆盖重建
    }
  }
  const plain = randomBytes(32).toString("hex");
  const hash = sha256Hex(plain);
  writeAuthFile(file, { hash });
  return { plain, hash };
}

/**
 * 首次启动生成并持有明文的便捷封装：
 * - 若文件已存在且哈希有效 → 返回 { plain: "", hash }（重启，无明文）。
 * - 若需新建 → 返回 { plain, hash }（首次，持有明文）。
 * 调用方据此判断是否需要把 plain 打印/注入浏览器。
 */
export function ensureAccessTokenWithPlain(agentDir?: string): AccessToken {
  return ensureAccessToken(agentDir);
}

/** 读取持久化哈希；缺失/损坏返回 null。 */
export function loadTokenHash(agentDir?: string): string | null {
  const file = authFilePath(agentDir);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { hash?: string };
    if (raw.hash && typeof raw.hash === "string" && raw.hash.length === 64) {
      return raw.hash;
    }
  } catch {
    /* 损坏 → null */
  }
  return null;
}

function writeAuthFile(file: string, data: { hash: string }): void {
  const payload = JSON.stringify(data, null, 2);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, payload, { mode: 0o600 });
  // 仅在非 Windows 显式 chmod（Windows 不支持 0o600 语义，且 writeFileSync mode 已尽量约束）。
  if (process.platform !== "win32") {
    try {
      chmodSync(tmp, 0o600);
    } catch {
      /* 忽略：权限收紧失败不应阻断启动 */
    }
  }
  renameSync(tmp, file);
  if (process.platform !== "win32") {
    try {
      chmodSync(file, 0o600);
    } catch {
      /* 忽略 */
    }
  }
}
