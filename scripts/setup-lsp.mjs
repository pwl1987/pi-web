#!/usr/bin/env node
// 检测并补齐编辑器所需的 LSP 语言服务器（json / typescript / yaml）。
// 仅在全局缺失对应可执行文件时才安装对应 npm 包，已安装则跳过。
// 用法: node scripts/setup-lsp.mjs  （或 npm run setup:lsp）

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// 每项: 编辑器需要的可执行文件名 -> 提供它的全局 npm 包名
const LSP_TARGETS = [
  { bin: "vscode-json-language-server", pkg: "vscode-langservers-extracted" },
  { bin: "typescript-language-server", pkg: "typescript-language-server" },
  // typescript-language-server 依赖 peer typescript，一并安装
  { bin: "yaml-language-server", pkg: "yaml-language-server" },
];

// 额外随 typescript-language-server 一起安装的依赖
const EXTRA_PKGS = ["typescript"];

// 取 npm 全局 bin 目录（不依赖 shell 内建命令，跨平台更稳）
function globalBinDir() {
  const prefix = execFileSync("npm", ["prefix", "-g"], { encoding: "utf8" }).trim();
  return path.join(prefix, process.platform === "win32" ? "." : "bin");
}

function hasBin(name) {
  const dir = globalBinDir();
  const candidates = process.platform === "win32" ? [name + ".cmd", name + ".ps1", name] : [name];
  return candidates.some((c) => {
    try {
      return fs.existsSync(path.join(dir, c));
    } catch {
      return false;
    }
  });
}

function installGlobal(pkgs) {
  console.log(`\n[npm] 全局安装: ${pkgs.join(" ")}`);
  execFileSync("npm", ["install", "-g", ...pkgs], { stdio: "inherit" });
}

function main() {
  const missing = LSP_TARGETS.filter((t) => !hasBin(t.bin));

  if (missing.length === 0) {
    console.log("✅ 所有 LSP 语言服务器均已安装，无需操作。");
    return;
  }

  console.log("检测到缺失的 LSP 语言服务器:");
  for (const t of missing) console.log(`  - ${t.bin} (需要包: ${t.pkg})`);

  const pkgs = new Set(missing.map((t) => t.pkg));
  for (const p of EXTRA_PKGS) pkgs.add(p);

  installGlobal([...pkgs]);

  // 校验
  const stillMissing = LSP_TARGETS.filter((t) => !hasBin(t.bin));
  if (stillMissing.length === 0) {
    console.log("\n✅ LSP 语言服务器已全部安装完成。");
  } else {
    console.warn(
      "\n⚠️ 以下语言服务器仍未找到，请检查 PATH 或手动安装:",
      stillMissing.map((t) => t.bin).join(", "),
    );
    process.exitCode = 1;
  }
}

main();
