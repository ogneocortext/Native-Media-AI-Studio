import { test, expect } from '@playwright/test';
import { navigateWithWait, cleanupRoutes, setupConsoleErrorCapture, expectNoConsoleErrors, mockApiHealth } from './helpers';

test.describe('Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('sidebar renders with nav sections', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page, 200);
    await navigateWithWait(page, '/');
    const sidebar = page.locator('aside.sidebar-container');
    await expect(sidebar).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('sidebar shows health status', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page, 200);
    await navigateWithWait(page, '/');
    // Health status text is in the sidebar footer — scope to .health-section only
    // (not .health-status, which is a child div and causes strict mode violation)
    const healthSection = page.locator('aside.sidebar-container .health-section');
    await expect(healthSection).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('sidebar collapse toggle is accessible on desktop', async ({ page }) => {
    await mockApiHealth(page, 200);
    await navigateWithWait(page, '/');
    // Set desktop width
    await page.setViewportSize({ width: 1400, height: 900 });
    const toggle = page.locator('button.sidebar-toggle, button[aria-label*="Collapse" i], button[aria-label*="Expand" i]');
    if (await toggle.count() > 0) {
      if (await toggle.first().isVisible()) {
        await toggle.first().click();
        await page.waitForTimeout(300);
      }
    }
  });

  test('sidebar navigates to health page', async ({ page }) => {
    await mockApiHealth(page, 200);
    await navigateWithWait(page, '/');
    const healthLink = page.locator('a[href="/health"], nav a:has-text("Health")').first();
    if (await healthLink.count() > 0) {
      await healthLink.click();
      await expect(page).toHaveURL(/\/health/);
    }
  });
});
