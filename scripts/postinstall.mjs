#!/usr/bin/env node
// postinstall 守卫：仅在本项目本地开发仓库执行 npm install 时，
// 自动检测并补齐编辑器所需的 LSP 语言服务器。
//
// 跳过条件（避免污染发布包/全局安装者环境）：
//   - CI 环境（CI=true / npm_config_ci=true）
//   - 全局安装（npm install -g）npm_config_global=true
//   - 当前目录不是本项目仓库（找不到本仓库的 scripts/setup-lsp.mjs）

import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function shouldSkip() {
  if (process.env.CI === "true" || process.env.npm_config_ci === "true") {
    console.log("[postinstall] 检测到 CI 环境，跳过 LSP 环境检测。");
    return true;
  }
  if (process.env.npm_config_global === "true") {
    console.log("[postinstall] 检测到全局安装，跳过 LSP 环境检测。");
    return true;
  }
  const self = path.join(process.cwd(), "scripts", "setup-lsp.mjs");
  if (!existsSync(self)) {
    // 不是本仓库（如作为依赖被别人安装）
    return true;
  }
  return false;
}

function main() {
  if (shouldSkip()) return;
  console.log("[postinstall] 检测编辑器 LSP 环境...");
  // 复用检测脚本，缺失时自动补齐
  import("./setup-lsp.mjs");
}

main();
