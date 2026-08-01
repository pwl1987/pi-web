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
        // Vendored / adapter layers that are deliberately untested by the
        // host: lib/pi is the SDK decoupling shim over @earendil-works/pi-*,
        // lib/agent-orchestrator and lib/unified-engine wrap the vendored
        // autoplan/comet mirrors (see docs/VENDOR-INTEGRATION.md). AGENTS.md
        // excludes vendor/ from tsconfig; counting these against coverage
        // would dilute the host-code signal to near-zero.
        "lib/pi/**",
        "lib/agent-orchestrator/**",
        "lib/unified-engine/**",
      ],
      reporter: ["text", "lcov", "html"],
      // Coverage thresholds — fail if coverage drops below baseline.
      // Values are calibrated to the CURRENT measured baseline (after
      // excluding the vendored adapter layers above) so the gate prevents
      // regression rather than blocking present-day commits.
      // Raise these as test coverage grows (target: lines 60 / fn 55 / br 45).
      thresholds: {
        lines: 6,
        functions: 6,
        branches: 4,
        statements: 6,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
