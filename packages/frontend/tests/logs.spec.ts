import { test, expect } from '@playwright/test';
import {
  navigateWithWait,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
  mockLogAnalytics,
  BACKEND_OFFLINE_FILTERS,
} from './helpers';

test.describe('Logs', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('logs page loads and shows header', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockLogAnalytics(page);
    await navigateWithWait(page, '/logs');
    await expect(page.locator('main h1').first()).toContainText('Log Analytics');
    expectNoConsoleErrors(errors, [...BACKEND_OFFLINE_FILTERS, 'Failed to fetch']);
  });

  test('log analytics summary renders the mocked counts', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockLogAnalytics(page);
    await navigateWithWait(page, '/logs');
    // The old version of this test asserted only `expect(body).toBeVisible()`,
    // which passes for an error state or an empty page as readily as for a
    // working one. The helper mocks /api/logs/analytics/summary with exactly
    // two ERROR and INFO-level events (LogAnalytics renders those levels as
    // the Errors/Info stat cards), so assert those values are on screen.
    const errorsCard = page.locator('main .card', { hasText: 'Errors' }).first();
    const infoCard = page.locator('main .card', { hasText: 'Info' }).first();
    await expect(errorsCard).toContainText('1', { timeout: 10_000 });
    await expect(infoCard).toContainText('2', { timeout: 10_000 });
    expectNoConsoleErrors(errors, [...BACKEND_OFFLINE_FILTERS, 'Failed to fetch']);
  });
});
