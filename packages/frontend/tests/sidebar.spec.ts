import { test, expect } from '@playwright/test';
import { cleanupRoutes, mockApiHealth, navigateAndWait } from './helpers';

test.describe('Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('sidebar renders with nav sections', async ({ page }) => {
    await mockApiHealth(page, 200);
    await navigateAndWait(page, '/');
    const sidebar = page.locator('aside.sidebar-container');
    await expect(sidebar).toBeVisible();
  });

  test('sidebar shows health status', async ({ page }) => {
    await mockApiHealth(page, 200);
    await navigateAndWait(page, '/');
    // Open the System footer to reveal the health status summary
    const systemToggle = page.locator('aside.sidebar-container .sidebar-footer-toggle');
    if (await systemToggle.count() > 0) {
      await systemToggle.first().click();
    }
    const healthSection = page.locator('aside.sidebar-container .system-status-summary');
    await expect(healthSection).toBeVisible({ timeout: 5_000 });
  });

  test('sidebar collapse toggle is accessible on desktop', async ({ page }) => {
    await mockApiHealth(page, 200);
    await navigateAndWait(page, '/');
    // Set desktop width via viewport
    await page.setViewportSize({ width: 1400, height: 900 });
    const toggle = page.locator('button.sidebar-toggle, button[aria-label*="Collapse" i], button[aria-label*="Expand" i]');
    await expect(toggle.first()).toBeVisible();
    await toggle.first().click();
  });

  test('sidebar navigates to health page', async ({ page }) => {
    await mockApiHealth(page, 200);
    await navigateAndWait(page, '/');
    const healthLink = page.locator('a[href="/health"], nav a:has-text("Health")').first();
    await expect(healthLink).toBeVisible();
    await healthLink.click();
    await expect(page).toHaveURL(/\/health/);
  });
});
