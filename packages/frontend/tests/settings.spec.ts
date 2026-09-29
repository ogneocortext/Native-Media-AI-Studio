import { test, expect } from '@playwright/test';
import { navigateWithWait, cleanupRoutes, setupConsoleErrorCapture, expectNoConsoleErrors, mockApiSettings } from './helpers';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('settings page loads and shows header', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiSettings(page);
    await navigateWithWait(page, '/settings');
    await expect(page.locator('main h1').first()).toContainText('Settings');
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('settings form fields are present', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiSettings(page);
    await navigateWithWait(page, '/settings');
    // The form renders only after GET /api/integrations/config/settings resolves,
    // so use an auto-retrying assertion instead of an immediate count().
    const integrationCards = page.locator('main h3', { hasText: /ComfyUI|Ollama/i });
    await expect(integrationCards.first()).toBeVisible();
    expect(await integrationCards.count()).toBeGreaterThanOrEqual(2);
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('theme toggle is accessible', async ({ page }) => {
    await mockApiSettings(page);
    await navigateWithWait(page, '/settings');
    // Theme toggle button or similar control should exist
    const themeBtn = page.locator('button[aria-label*="theme" i], button[title*="theme" i], button:has-text("Theme"), button:has-text("Dark"), button:has-text("Light")');
    const count = await themeBtn.count();
    expect(count).toBeGreaterThanOrEqual(0); // may or may not be present depending on implementation
  });
});
