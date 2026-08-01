#!/usr/bin/env node
/* eslint-disable no-console -- CLI 脚本以 console 输出进度是其预期 UX */
/**
 * sync-vendor.mjs — 上游 vendoring 同步脚本（Vendor 拷贝 + 补丁重放机制）
 *
 * 设计目标：让 pi-web 在「对上游源码做深度改造」的同时，能平滑跟进上游迭代。
 *
 * 核心约束（来自融合方案）：
 *  1. vendor/<repo> 是上游在 VENDOR.lock 钉选 commit 的【原样镜像】，禁止直接编辑；
 *     所有本地行为改动集中在 lib/unified-engine 适配层，或 vendor/patches/<repo>/*.patch。
 *  2. 上游视为【不可信供应链】：本脚本仅做 checkout + 应用补丁，绝不执行上游任意代码。
 *  3. 补丁分层：00xx-compat（兼容补丁，必选）/ 01xx-fusion（融合补丁，可选）。
 *  4. 同步后执行 tsc 类型检查与冲突检测，提前暴露上游 break change。
 *
 * 用法：
 *   node scripts/sync-vendor.mjs                  # 同步全部 repo
 *   node scripts/sync-vendor.mjs autoplan         # 仅同步指定 repo
 *   node scripts/sync-vendor.mjs --check          # 仅校验 lock 与补丁一致性，不改动
 *   node scripts/sync-vendor.mjs --dry            # 演算但不落盘
 *   node scripts/sync-vendor.mjs --typecheck      # 同步后运行 `npm run type-check` 校验适配层
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const VENDOR_DIR = join(ROOT, "vendor");
const LOCK_PATH = join(VENDOR_DIR, "VENDOR.lock");
const PATCHES_DIR = join(VENDOR_DIR, "patches");

// ---------- 极简 YAML 解析（仅覆盖 VENDOR.lock 的"顶层 key: + 嵌套 2 空格缩进"结构） ----------
function parseLock(text) {
  /** @type {Record<string, Record<string, any>>} */
  const repos = {};
  let cur = null;
  const listKeys = new Set(); // 处于列表收集状态的 key
  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 0 && /^[A-Za-z0-9_-]+:/.test(line) && !line.includes(" ")) {
      const name = line.slice(0, -1);
      cur = name;
      repos[cur] = {};
      listKeys.clear();
      continue;
    }
    if (!cur) continue;
    if (line.includes(":")) {
      const idx = line.indexOf(":");
      const key = line.slice(0, idx).trim();
      const bareVal = line
        .slice(idx + 1)
        .trim()
        .replace(/^"|"$/g, "");
      if (bareVal === "" || bareVal === "[]" || bareVal === "{}") {
        // 列表/对象开始
        repos[cur][key] = [];
        listKeys.add(key);
      } else {
        repos[cur][key] = bareVal;
        listKeys.delete(key);
      }
    } else if (line.startsWith("- ") && listKeys.size) {
      const key = [...listKeys].pop();
      repos[cur][key].push(line.slice(2).replace(/^"|"$/g, ""));
    }
  }
  return repos;
}

function sh(cmd, args, cwd = ROOT) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function git(args, cwd) {
  return sh("git", args, cwd);
}

/** 拉取上游最新并 checkout 钉选 commit（保留 .git 供后续增量同步） */
function checkoutRepo(name, meta) {
  const target = join(VENDOR_DIR, name);
  if (!existsSync(target)) {
    git(["clone", "--depth", "1", meta.remote, name], VENDOR_DIR);
  }
  // 取上游最新（不切换本地分支，仅把 HEAD 指向钉选 commit）
  git(["fetch", "--depth", "1", "origin", meta.commit], target);
  git(["checkout", "--force", meta.commit], target);
  git(["clean", "-fd"], target);
  return target;
}

/** 应用 vendor/patches/<repo>/ 下的补丁（按文件名排序），分层 compat → fusion */
function applyPatches(name, target) {
  const dir = join(PATCHES_DIR, name);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".patch"))
    .sort();
  const applied = [];
  for (const f of files) {
    const p = join(dir, f);
    try {
      git(["apply", "--whitespace=nowarn", p], target);
      applied.push(f);
    } catch (e) {
      console.error(`[sync-vendor] ✗ 补丁冲突：${name}/${f}`);
      console.error(
        String(e.stderr || e.message)
          .split("\n")
          .slice(0, 8)
          .join("\n"),
      );
      throw new Error(`patch conflict: ${name}/${f}`);
    }
  }
  return applied;
}

/** 按 VENDOR.lock 的 trim 规则裁剪非运行时目录/文件 */
function trimRepo(name, target, meta) {
  const rules = meta.trim || [];
  for (const rule of rules) {
    const p = join(target, rule);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
    }
  }
}

/** 仅演算补丁能否干净应用，提前暴露冲突（--check 模式使用） */
function checkPatches(name, target) {
  const dir = join(PATCHES_DIR, name);
  if (!existsSync(dir)) return;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".patch"))
    .sort();
  let ok = true;
  for (const f of files) {
    const p = join(dir, f);
    try {
      git(["apply", "--check", "--whitespace=nowarn", p], target);
    } catch (e) {
      ok = false;
      console.error(`[check] ✗ 补丁将冲突：${name}/${f}`);
      console.error(
        String(e.stderr || e.message)
          .split("\n")
          .slice(0, 6)
          .join("\n"),
      );
    }
  }
  if (ok) console.log(`[check] ✓ ${name} 补丁可干净应用（${files.length} 个）`);
}

/** 校验实际 checkout 的 HEAD 等于 VENDOR.lock 钉选 commit（供应链完整性） */
function verifyHead(name, target, meta) {
  const head = git(["rev-parse", "HEAD"], target).trim();
  if (head !== meta.commit) {
    throw new Error(`HEAD 漂移：${name} 实际 ${head} ≠ 锁定 ${meta.commit}`);
  }
  console.log(`[sync-vendor] ✓ ${name} HEAD 已锁定于 ${meta.commit}`);
}

/** 同步后运行宿主类型检查（vendor 已被 tsconfig 排除，仅校验宿主适配层） */
function runTypeCheck() {
  console.log("\n[sync-vendor] 运行宿主类型检查 `npm run type-check` …");
  try {
    execFileSync("npm", ["run", "type-check"], {
      cwd: ROOT,
      stdio: "inherit",
    });
    console.log("[sync-vendor] ✓ 类型检查通过");
  } catch {
    console.error("[sync-vendor] ✗ 类型检查失败，请查看上方输出并修复 lib/unified-engine 适配层");
    throw new Error("type-check failed after vendor sync");
  }
}

function main() {
  const argv = process.argv.slice(2);
  const only = argv.find((a) => !a.startsWith("--"));
  const dry = argv.includes("--dry");
  const check = argv.includes("--check");

  const text = readFileSync(LOCK_PATH, "utf8");
  const repos = parseLock(text);

  console.log(`[sync-vendor] 读取 ${LOCK_PATH}，待同步 repo：${Object.keys(repos).join(", ")}`);

  for (const [name, meta] of Object.entries(repos)) {
    if (only && name !== only) continue;
    console.log(`\n=== ${name} @ ${meta.commit} (${meta.license}) ===`);
    const target = join(VENDOR_DIR, name);
    if (check) {
      const hasGit = existsSync(join(target, ".git"));
      console.log(
        `[check] 镜像存在=${existsSync(target)} .git=${hasGit} patches=${(meta.patches || []).length}`,
      );
      if (hasGit) checkPatches(name, target);
      continue;
    }
    if (dry) {
      console.log(
        `[dry] 将 checkout ${meta.remote}@${meta.commit} 并应用 ${(meta.patches || []).length} 个补丁`,
      );
      continue;
    }
    checkoutRepo(name, meta);
    const applied = applyPatches(name, target);
    trimRepo(name, target, meta);
    verifyHead(name, target, meta);
    console.log(`[sync-vendor] ✓ ${name} 已同步，应用补丁 ${applied.length} 个`);
  }

  if (!check && !dry) {
    if (argv.includes("--typecheck") || argv.includes("--tc")) {
      runTypeCheck();
    } else {
      console.log(
        "\n[sync-vendor] 完成。建议运行 `node scripts/sync-vendor.mjs --typecheck` 做类型校验。",
      );
    }
  }
}

main();
