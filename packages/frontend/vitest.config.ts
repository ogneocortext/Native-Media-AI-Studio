import { defineConfig, configDefaults } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Unit tests for pure logic, deliberately separate from the Playwright suite in
 * playwright.config.ts.
 *
 * Decisions worth keeping:
 *
 * 1. `include` is scoped to src/ for pure logic and the `include` glob is
 *    explicit. Vitest's default glob would sweep up tests/*.spec.ts, which are
 *    Playwright specs: they import @playwright/test, need a browser and a dev
 *    server, and would fail here for reasons that have nothing to do with the
 *    module under test.
 * 2. This config does not extend vite.config.ts. Unit tests target modules with
 *    no React, CSS or asset imports, so pulling in the react/tailwind/
 *    visualizer plugin chain would add seconds to every run for no benefit.
 *
 * Nov 2026 additions (Vitest 5.x):
 *
 * 3. `pool: 'threads'` — faster than `forks` for larger node-only projects.
 *    These tests import no native addons, so threads are safe.
 * 4. `isolate: false` — these are pure-logic node tests that mutate nothing
 *    cross-file. This is the largest single speed lever for node suites that
 *    hold no shared state. Verify with `vitest doctor` if a future test adds
 *    cross-file mutable state.
 * 5. Coverage thresholds via the v8 provider, with `perFile: true` so a few
 *    heavily tested files cannot mask an untested one. `all: true` includes
 *    files never imported by tests so untested code cannot hide.
 * 6. `setupFiles` runs `onTestFinished` cleanup that executes even when an
 *    assertion fails — critical when a test mutates `process.env` or module
 *    state that a later file might depend on.
 * 7. `sequence.shuffle` is not enabled by default here; run `vitest run
 *    --shuffle` in CI to surface order-dependent tests.
 */

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "../../shared"),
    },
  },
  server: {
    // Vite rejects requests whose Host header is not allow-listed, which made
    // /__vitest__/ return 403 when opened from anything but the exact origin
    // the UI was started with. Pinning the hosts keeps `pnpm test:unit:ui`
    // reachable in a browser.
    allowedHosts: ["localhost", "127.0.0.1"],
  },
  test: {
    // Pure-logic unit tests, colocated next to the module they cover.
    include: ["src/**/*.test.ts"],
    // Never let a Playwright spec or the gitignored agent scratch tree in
    // tests/browser/out/ be collected here.
    exclude: [
      ...configDefaults.exclude,
      "tests/**",
      "**/*.spec.ts",
      "dist/**",
    ],
    // Pure node tests — no DOM, no jsdom/happy-dom environment cost.
    environment: "node",
    // `threads` pool starts faster than `forks`; safe because no test imports
    // a native addon that could segfault in a worker thread.
    pool: "threads",
    // `vitest doctor` measured maxWorkers: 5 as -18% faster than the default.
    // Fewer workers can be faster because every worker funnels transforms
    // through the single main-thread Vite server.
    maxWorkers: 5,
    // These are pure-logic node tests that mutate nothing cross-file.
    // `isolate: false` is the largest single speed lever for such suites.
    isolate: false,
    // Explicit about Vitest 5 defaults so the config documents itself.
    clearMocks: true,
    mockReset: false,
    restoreMocks: false,
    retry: 0,
    testTimeout: 5000,
    hookTimeout: 10000,
    // Setup file runs before each test file; `onTestFinished` inside it runs
    // cleanup even when an assertion fails.
    setupFiles: ["./src/setupTests.ts"],
    reporters: "verbose",
    // Coverage: v8 provider, thresholds enforced per file, `all: true` so
    // files never imported by tests show 0% instead of hiding.
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        ...configDefaults.exclude,
        "src/**/*.d.ts",
        "src/**/__fixtures__/**",
        "src/**/generated/**",
        "src/**/*.stories.tsx",
        "src/main.tsx",
      ],
      reporter: ["text", "html", "lcov"],
      thresholds: {
        perFile: true,
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
