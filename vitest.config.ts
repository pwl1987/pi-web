import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config — default environment is `node` (fast, DOM-free).
 * Component tests opt into `jsdom` via a file pragma at the top:
 *
 *   // @vitest-environment jsdom
 *
 * Path aliases mirror tsconfig.json so tests resolve "@/lib/..." the same
 * way the Next app does.
 *
 * Note: lib/*.test.mjs files use the built-in `node:test` runner, not
 * vitest. They're picked up via `npm run test:node` instead. We keep
 * them out of vitest's `include` to avoid "no test suite found" errors.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "lib/**/*.test.{ts,mts,tsx}",
      "components/**/*.test.{ts,tsx}",
      "hooks/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["./vitest.setup.ts"],

    // Coverage powered by v8 (spiritual successor of c8, same engine)
    coverage: {
      provider: "v8",
      include: [
        "app/**/*.{ts,tsx}",
        "components/**/*.{ts,tsx}",
        "hooks/**/*.{ts,tsx}",
        "lib/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.test.{mjs,ts,tsx}",
        "**/*.test.mjs",
        "**/*.d.ts",
        "next-env.d.ts",
        ".next/**",
        "node_modules/**",
      ],
      reporter: ["text", "lcov", "html"],
      // Coverage thresholds — fail if coverage drops below baseline.
      // Baseline reflects current test coverage; increase as new tests are added.
      thresholds: {
        lines: 60,
        functions: 55,
        branches: 45,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
