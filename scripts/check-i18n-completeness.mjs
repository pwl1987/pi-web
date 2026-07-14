#!/usr/bin/env node
// scripts/check-i18n-completeness.mjs
//
// 校验 lib/config-schema.ts 中声明的每个 i18nKey 字段在 lib/i18n/{en,zh}.ts 中都有对应翻译。
// 方案 A 节六.5 + 节九：i18n key 完整性强校验；缺 label 报错，其他段（description/placeholder/errorMessage）仅 warn。
//
// ponytail: 纯文本 + 正则，不引入 AST 解析；TS 文件格式稳定时足够。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SCHEMA_FILES = [resolve(ROOT, "lib/config-schema.ts"), resolve(ROOT, "lib/all-schemas.ts")];
const EN_FILE = resolve(ROOT, "lib/i18n/en.ts");
const ZH_FILE = resolve(ROOT, "lib/i18n/zh.ts");

function extractI18nKeys(src) {
  // 抓取 `i18nKey: "..."` 或 `i18nKey: '...'` 的字符串字面量
  const re = /i18nKey\s*:\s*["'`]([^"'`]+)["'`]/g;
  const out = new Set();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return [...out];
}

function extractDictionaryKeys(src) {
  // 抓取字典里的顶级 key："foo.bar": "..." （排除嵌套对象 / 不带引号的 key）
  const re = /^\s*"([a-zA-Z0-9_./@-][a-zA-Z0-9_./@-]*)"\s*:/gm;
  const out = new Set();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

function check(file, schemaKeys, dictKeys, required = [".label"]) {
  const errors = [];
  const warnings = [];
  for (const base of schemaKeys) {
    for (const suffix of required) {
      const full = base + suffix;
      if (!dictKeys.has(full)) errors.push(`${file} 缺必须 key: ${full}`);
    }
    // 可选段：warn 而非 fail
    for (const suffix of [".description", ".placeholder", ".errorMessage"]) {
      const full = base + suffix;
      if (!dictKeys.has(full)) warnings.push(`${file} 缺可选 key: ${full}`);
    }
  }
  return { errors, warnings };
}

function main() {
  const en = readFileSync(EN_FILE, "utf8");
  const zh = readFileSync(ZH_FILE, "utf8");

  const i18nKeySet = new Set();
  for (const f of SCHEMA_FILES) {
    const text = readFileSync(f, "utf8");
    for (const k of extractI18nKeys(text)) i18nKeySet.add(k);
  }
  const i18nKeys = [...i18nKeySet];
  if (i18nKeys.length === 0) {
    console.warn("[i18n-completeness] schema 文件无 i18nKey 声明，跳过");
    process.exit(0);
  }

  const enKeys = extractDictionaryKeys(en);
  const zhKeys = extractDictionaryKeys(zh);

  const enCheck = check("en.ts", i18nKeys, enKeys);
  const zhCheck = check("zh.ts", i18nKeys, zhKeys);

  const allErrors = [...enCheck.errors, ...zhCheck.errors];
  const allWarnings = [...enCheck.warnings, ...zhCheck.warnings];

  console.warn(`[i18n-completeness] 扫描到 ${i18nKeys.length} 个 i18nKey: ${i18nKeys.join(", ")}`);
  if (allWarnings.length > 0) {
    console.warn(`[warn] ${allWarnings.length} 项:`);
    allWarnings.forEach((w) => console.warn(`  - ${w}`));
  }
  if (allErrors.length > 0) {
    console.error(`[fail] ${allErrors.length} 项必须补齐:`);
    allErrors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.warn("[ok] i18n 完整性通过");
}

main();
