// 同步生成/复用访问令牌，供 bin/pi-web.js（CommonJS）经 execFileSync 调用。
// 输出纯 JSON：{ "plain": "<首次生成的明文或空>", "hash": "<sha256>" }
// 明文仅在首次生成时返回；重启复用分支 plain 为空。
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AUTH_FILE = "pi-web-auth.json";
const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const file = join(agentDir, AUTH_FILE);

function sha256Hex(s) {
  return createHash("sha256").update(s).digest("hex");
}

function writeAuth(hash) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ hash }, null, 2), { mode: 0o600 });
  if (process.platform !== "win32") {
    try {
      chmodSync(tmp, 0o600);
    } catch {
      /* ignore */
    }
  }
  renameSync(tmp, file);
  if (process.platform !== "win32") {
    try {
      chmodSync(file, 0o600);
    } catch {
      /* ignore */
    }
  }
}

function main() {
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      if (raw.hash && typeof raw.hash === "string" && raw.hash.length === 64) {
        process.stdout.write(JSON.stringify({ plain: "", hash: raw.hash }));
        return;
      }
    } catch {
      /* 损坏 → 重建 */
    }
  }
  const plain = randomBytes(32).toString("hex");
  const hash = sha256Hex(plain);
  writeAuth(hash);
  process.stdout.write(JSON.stringify({ plain, hash }));
}

main();
