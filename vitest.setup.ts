/**
 * Vitest setup — registers @testing-library/jest-dom matchers
 * (toBeInTheDocument, toHaveAccessibleName, etc.) globally for all test
 * files. Imported by vitest.config.ts's `setupFiles`.
 */
import "@testing-library/jest-dom/vitest";