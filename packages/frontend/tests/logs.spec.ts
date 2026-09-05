import { test, expect } from '@playwright/test';
import { navigateWithWait, cleanupRoutes, setupConsoleErrorCapture, expectNoConsoleErrors } from './helpers';

test.describe('Logs', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

test('logs page loads and shows header', async ({ page }) => {
     const errors = setupConsoleErrorCapture(page);
     await navigateWithWait(page, '/logs');
     await expect(page.locator('main h1').first()).toContainText('Log Viewer');
     expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED', 'Failed to fetch']);
   });

   test('logs viewer renders without crashing', async ({ page }) => {
     const errors = setupConsoleErrorCapture(page);
     await navigateWithWait(page, '/logs');
     // The page should render something — either log entries or an empty state
     const body = page.locator('body');
     await expect(body).toBeVisible();
     expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED', 'Failed to fetch']);
   });
});
