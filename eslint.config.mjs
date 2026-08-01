import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

/**
 * ESLint v9 flat config.
 *
 * Layers (last wins):
 *  1. eslint-config-next/core-web-vitals — React, accessibility, Core Web Vitals
 *  2. eslint-config-next/typescript   — @typescript-eslint rules for Next.js
 *  3. Custom overrides                 — project-specific rule tuning
 *  4. eslint-config-prettier           — disables all rules that conflict with
 *     Prettier (semi, quotes, comma-dangle, …). Must be LAST so it wins.
 *     Prettier owns formatting; ESLint owns logic/style. Without this, any
 *     eslint-config-next upgrade could silently introduce rules that fight
 *     `prettier --write` in lint-staged.
 */
const eslintConfig = [
  // Flat-config compatible presets from Next.js 16
  ...coreWebVitals,
  ...typescript,

  // Global settings
  {
    name: "pi-web/global",
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },

  // Project-specific rule overrides
  {
    name: "pi-web/rules",
    rules: {
      // ---- React Hooks relaxations ----
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",

      // ---- @typescript-eslint additional strictness ----
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/array-type": ["warn", { default: "array-simple" }],
      "@typescript-eslint/no-non-null-assertion": "warn",
      // Note: type-aware rules (e.g. prefer-optional-chain, no-misused-promises)
      // are NOT enabled here. They require parserOptions.project, which
      // conflicts with eslint-config-next and would force a full type-check on
      // every lint run. Type safety is instead enforced by `tsc --noEmit` in
      // the pipeline (CI / pre-commit `npm run typecheck`).

      // ---- General code quality ----
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Ignore patterns (flat-config equivalent of .eslintignore).
  // .codebuddy / .zcode hold IDE/agent session memory and plans — they are
  // not project source and must not affect lint or format gates.
  {
    name: "pi-web/ignores",
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "*.min.js",
      ".codebuddy/**",
      ".zcode/**",
      // vendor/ 为第三方 vendored 代码（如 vendor/comet），不参与本仓库的 lint 与格式门禁。
      "vendor/**",
    ],
  },

  // Must be last — turns off every ESLint rule that is unnecessary or might
  // conflict with Prettier. Owns no rules of its own; purely subtractive.
  prettier,
];

export default eslintConfig;
