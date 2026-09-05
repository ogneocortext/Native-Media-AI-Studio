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
      const win = window as any;
      win.__VIZ_TEST__?.setMode?.('2d');
    });

    // Wait for canvas to render
    const canvas = page.locator('canvas');
    await expect(canvas.first()).toBeVisible({ timeout: 15_000 });

    // Cycle through 2D sub-modes via the harness
    const modes = ['bars', 'waveform', 'radial', 'spectrogram', 'lissajous', 'constellation', 'particles'] as const;
    for (const mode of modes) {
      await page.evaluate((m) => { (window as any).__VIZ_TEST__?.set2DMode?.(m); }, mode);
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
});
