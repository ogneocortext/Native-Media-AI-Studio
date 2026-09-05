import { test, expect } from '@playwright/test';
import {
  navigateWithWait,
  mockApiHealth,
  mockApiQueueEmpty,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
} from './helpers';

test.describe('App Shell', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('home route loads dashboard', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/');
    // Scope to main content to avoid matching the sidebar's h1
    await expect(page.locator('main h1').first()).toContainText('Drop your song');
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('sidebar navigation exists with key sections', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/');
    const sidebar = page.locator('aside.sidebar-container');
    await expect(sidebar).toBeVisible();
    // Verify all nav sections are present
    const sections = page.locator('.nav-section-title');
    const count = await sections.count();
    expect(count).toBeGreaterThanOrEqual(4);
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('footer renders version and copyright', async ({ page }) => {
    await navigateWithWait(page, '/');
    const footer = page.locator('footer.layout-footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText('v1.0.0');
    await expect(footer).toContainText('2026');
  });

  test('unknown route shows NotFound or redirects', async ({ page }) => {
    await navigateWithWait(page, '/this-route-does-not-exist');
    // The app either renders 404 or redirects; both are acceptable.
    const has404 = await page.getByText(/404|Not Found|Page not found/).count();
    if (has404 === 0) {
      const url = page.url();
      expect(url).not.toContain('/this-route-does-not-exist');
    }
  });

  test('layout main content area is visible', async ({ page }) => {
    await navigateWithWait(page, '/');
    const main = page.locator('main.layout-main');
    await expect(main).toBeVisible();
  });

  test('redirect routes resolve correctly', async ({ page }) => {
    await navigateWithWait(page, '/music-video');
    expect(page.url()).toContain('/music-video-wizard');
  });

  test('sidebar CTA navigates to music video wizard', async ({ page }) => {
    await navigateWithWait(page, '/');
    const cta = page.locator('.sidebar-cta, a[href*="music-video-wizard"]').first();
    if (await cta.count() > 0) {
      await cta.click();
      await expect(page).toHaveURL(/\/music-video-wizard/);
    }
  });
});
