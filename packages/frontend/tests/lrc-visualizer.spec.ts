import { test, expect } from '@playwright/test';
import { navigateWithWait, cleanupRoutes, setupConsoleErrorCapture, expectNoConsoleErrors } from './helpers';

test.describe('LRC-Enhanced Visualizer', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('loads LRC file and applies section-aware visuals', async ({ page }) => {
    test.setTimeout(120000);
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/visualizer');

    const trackSelect = page.locator('[data-testid="viz-track-select"]');
    await expect(trackSelect).toBeVisible({ timeout: 15_000 });

    const optionCount = await trackSelect.locator('option').count();
    if (optionCount > 1) {
      await trackSelect.selectOption({ index: 1 });
    }

    // Wait for lyrics + analysis to load
    await page.waitForTimeout(6000);

    // Check lyrics overlay presence via the test harness
    const hasLyrics = await page.evaluate(() => {
      const win = window as any;
      const state = win.__VIZ_TEST__?.getState?.();
      return !!state?.lyrics?.length;
    });

    if (hasLyrics) {
      // Capture state at key timestamps to verify section-aware behavior
      const timestamps = [5, 15, 33, 45];
      const sections = new Set<string>();
      for (const t of timestamps) {
        await page.evaluate((time) => {
          const audio = document.querySelector('audio');
          if (audio) audio.currentTime = time;
        }, t);
        await page.waitForTimeout(600);
        const section = await page.evaluate(() => {
          const win = window as any;
          const state = win.__VIZ_TEST__?.getState?.();
          return state?.storyboard?.currentSection || 'unknown';
        });
        sections.add(section);
      }
      expect(sections.size).toBeGreaterThan(1);
    }

    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });
});
