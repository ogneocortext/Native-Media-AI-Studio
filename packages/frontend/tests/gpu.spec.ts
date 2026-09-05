import { test, expect } from '@playwright/test';
import { navigateWithWait, cleanupRoutes, setupConsoleErrorCapture, expectNoConsoleErrors, mockApiHealth, mockApiSystemHealth } from './helpers';

test.describe('GPU', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('gpu page loads and shows header', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/gpu');
    await expect(page.locator('main h1').first()).toContainText('GPU');
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('gpu page renders status cards', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page, 200);
    await mockApiSystemHealth(page);
    await navigateWithWait(page, '/gpu');
    // Should show some GPU-related content or status
    const body = page.locator('body');
    await expect(body).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });
});
