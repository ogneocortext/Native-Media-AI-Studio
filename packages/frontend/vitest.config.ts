import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Unit tests for pure logic, deliberately separate from the Playwright suite in
 * playwright.config.ts.
 *
 * Two decisions worth keeping:
 *
 * 1. `include` is scoped to src/ for pure logic and the `include` glob is
 *    explicit. Vitest's default glob would sweep up tests/*.spec.ts, which are
 *    Playwright specs: they import @playwright/test, need a browser and a dev
 *    server, and would fail here for reasons that have nothing to do with the
 *    module under test.
 * 2. This config does not extend vite.config.ts. Unit tests target modules with
 *    no React, CSS or asset imports, so pulling in the react/tailwind/
 *    visualizer plugin chain would add seconds to every run for no benefit.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "../../shared"),
    },
  },
  test: {
    // Pure-logic unit tests, colocated next to the module they cover.
    include: ["src/**/*.test.ts"],
    // Never let a Playwright spec or the gitignored agent scratch tree in
    // tests/browser/out/ be collected here.
    exclude: [
      "**/node_modules/**",
      "tests/**",
      "**/*.spec.ts",
      "dist/**",
    ],
    environment: "node",
    reporters: process.env.CI ? "dot" : "verbose",
  },
});