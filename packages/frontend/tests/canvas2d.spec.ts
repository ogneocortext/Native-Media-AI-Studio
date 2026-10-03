import { test, expect } from '@playwright/test';
import { navigateWithWait, cleanupRoutes, setupConsoleErrorCapture, expectNoConsoleErrors } from './helpers';

test.describe('Canvas2D Visualizer', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('renders 2D mode canvas and cycles modes', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/visualizer');

    // Wait for the track selector to appear
    const trackSelect = page.locator('[data-testid="viz-track-select"]');
    await expect(trackSelect).toBeVisible({ timeout: 15_000 });

    // Pick the first available track if any
    const optionCount = await trackSelect.locator('option').count();
    if (optionCount > 1) {
      await trackSelect.selectOption({ index: 1 });
    }

    // Use the test harness to switch to 2D mode reliably
    await page.evaluate(() => {
      const win = window as unknown as { __VIZ_TEST__?: { setMode?: (mode: string) => void } };
      win.__VIZ_TEST__?.setMode?.('2d');
    });

    // Wait for canvas to render
    const canvas = page.locator('canvas');
    await expect(canvas.first()).toBeVisible({ timeout: 15_000 });

    // Cycle through 2D sub-modes via the harness
    const modes = ['bars', 'waveform', 'radial', 'spectrogram', 'lissajous', 'constellation', 'particles'] as const;
    for (const mode of modes) {
      await page.evaluate((m) => { (window as unknown as { __VIZ_TEST__?: { set2DMode?: (mode: string) => void } }).__VIZ_TEST__?.set2DMode?.(m); }, mode);
      await expect(canvas.first()).toBeVisible({ timeout: 5_000 });
    }

    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('visualizer page loads without console errors', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/visualizer');
    await page.waitForTimeout(1000);
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  /**
   * Regression guard for the `aurora` outage: that mode was fully implemented,
   * budgeted and unit-tested, but the picker's hardcoded `<option>` list never
   * included it, so no user could reach it. A harness-driven cycle still passed,
   * which is how it stayed hidden.
   *
   * This asserts against the **UI**, not the harness: every mode the runtime
   * knows about must be selectable, and every selectable value must be a real
   * mode. It also caught `value="stereo-split-bands"`, an option whose value was
   * not a mode at all.
   */
  test('2D mode picker offers exactly the modes the runtime supports', async ({ page }) => {
    await navigateWithWait(page, '/visualizer');
    const trackSelect = page.locator('[data-testid="viz-track-select"]');
    await expect(trackSelect).toBeVisible({ timeout: 15_000 });
    const optionCount = await trackSelect.locator('option').count();
    if (optionCount > 1) await trackSelect.selectOption({ index: 1 });

    await page.evaluate(() => {
      const win = window as unknown as { __VIZ_TEST__?: { setMode?: (mode: string) => void } };
      win.__VIZ_TEST__?.setMode?.('2d');
    });
    // The compact "More" menu holds the 2D mode picker in the V2 UI.
    await page.click('button[aria-label="More controls"]');
    const select = page.locator('select.viz-2d-mode-select');
    await expect(select).toBeVisible({ timeout: 5_000 });

    const values = await select.locator('option').evaluateAll((os) =>
      os.map((o) => (o as HTMLOptionElement).value),
    );

    // Every mode the runtime can render must be reachable from the UI.
    // The canonical list is read from the *served* source rather than hardcoded
    // here: a literal copy would just re-assert whatever the source said when
    // this test was written. (A literal `import('/src/...')` is not an option —
    // tsconfig.tests.json has no mapping for Vite-rooted paths, and the spec
    // has to type-check.)
    const runtimeModes: string[] = await page.evaluate(async () => {
      const src = await fetch('/src/features/visualizer/visualizerHelpers.ts').then((r) => r.text());
      // Match up to the closing bracket only. The served module is transpiled,
      // so `as const` is gone — anchoring on it makes the regex silently
      // return an empty list and the test passes vacuously.
      const body = src.match(/CANVAS_2D_MODES\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
      return body
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter((s) => /^[a-z]/.test(s));
    });
    expect(runtimeModes.length).toBeGreaterThan(0);
    for (const mode of runtimeModes) {
      expect(values, `mode "${mode}" is implemented but not selectable`).toContain(mode);
    }
    // And nothing selectable may be a value the runtime does not know.
    for (const v of values) {
      expect(runtimeModes, `picker offers unknown mode "${v}"`).toContain(v);
    }

    // The specific historical defects, named so the failure is legible.
    expect(values).toContain('aurora');
    expect(values).not.toContain('stereo-split-bands');

    // Selecting through the UI must actually change state (not just the <option>).
    await select.selectOption('aurora');
    await page.waitForTimeout(500);
    const mode = await page.evaluate(() => {
      const win = window as unknown as { __VIZ_TEST__?: { getState?: () => { canvas2DMode?: string } } };
      return win.__VIZ_TEST__?.getState?.()?.canvas2DMode;
    });
    expect(mode).toBe('aurora');
  });
});
