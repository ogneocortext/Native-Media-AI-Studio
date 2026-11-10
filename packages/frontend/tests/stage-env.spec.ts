import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupRoutes,
  expectNoConsoleErrors,
  navigateWithWait,
  setupConsoleErrorCapture,
  BACKEND_OFFLINE_FILTERS,
} from "./helpers";

// T-VIZ-54 acceptance artifact. The stage-env style is a 3D visualization
// style selected through the dev-only __VIZ_TEST__.setStyle harness; the
// screenshot lands at the repo-root output/tests/ path the task file cites
// (output/ is gitignored — the PNG is evidence on disk, not in git).
const ARTIFACT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../output/tests/stage-env-v2.png",
);

test.describe("Stage Environment visualizer (T-VIZ-54)", () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test("stage-env style renders and captures the acceptance screenshot", async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, "/visualizer");

    const trackSelect = page.locator('[data-testid="viz-track-select"]');
    await expect(trackSelect).toBeVisible({ timeout: 15_000 });
    // Same async-store race as canvas2d.spec.ts: the select renders before
    // the shared audio library store resolves, so wait for real options.
    await expect
      .poll(() => trackSelect.locator("option").count(), { timeout: 20_000 })
      .toBeGreaterThan(1);
    await trackSelect.selectOption({ index: 1 });

    await page.evaluate(() => {
      const win = window as unknown as {
        __VIZ_TEST__?: { setMode?: (mode: string) => void; setStyle?: (style: string) => void };
      };
      win.__VIZ_TEST__?.setMode?.("3d");
      win.__VIZ_TEST__?.setStyle?.("stage-env");
    });

    // Prove the style actually applied — a harness call that silently failed
    // would still leave a visible canvas behind.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const win = window as unknown as {
            __VIZ_TEST__?: {
              getState?: () => { vizMode?: string; visualizationStyle?: string };
            };
          };
          const s = win.__VIZ_TEST__?.getState?.();
          return `${s?.vizMode}:${s?.visualizationStyle}`;
        }),
      )
      .toBe("3d:stage-env");

    const canvas = page.locator("canvas");
    await expect(canvas.first()).toBeVisible({ timeout: 15_000 });

    // GLB props load through per-prop Suspense after the style mounts; give
    // them a beat to resolve before the evidence frame is taken.
    await page.waitForTimeout(4_000);

    fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
    await page.screenshot({ path: ARTIFACT_PATH });
    expect(fs.existsSync(ARTIFACT_PATH), `artifact written to ${ARTIFACT_PATH}`).toBe(true);

    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });
});
