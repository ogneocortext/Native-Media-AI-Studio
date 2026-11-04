/**
 * Global test setup for the visualizer unit-test suite.
 *
 * Runs before every test file. Registers `afterEach` cleanup that executes
 * even when an assertion fails — critical when a test mutates `process.env`
 * or module state that a later file might depend on.
 *
 * Pure-logic node tests share nothing between files, so `isolate: false`
 * is safe here. If a future test adds cross-file mutable state, flip
 * `isolate` back to `true` and run `vitest doctor` to verify.
 */

import { afterEach, vi } from "vitest";

afterEach(() => {
  // Put process.env back the way we found it, in case a test stubbed it.
  vi.unstubAllEnvs();
  // Drop any module copies evaluated under a stub so the next test file
  // evaluates its own copy rather than inheriting a stale one.
  vi.resetModules();
});
