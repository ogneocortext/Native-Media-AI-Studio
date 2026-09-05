import { test, expect } from '@playwright/test';
import { navigateWithWait, cleanupRoutes, setupConsoleErrorCapture, expectNoConsoleErrors } from './helpers';

test.describe('File Upload', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('dashboard drop zone opens file picker on click', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/');
    const dropZone = page.locator('[aria-label="Drop audio file here or click to browse"]');
    await expect(dropZone).toBeVisible();

    // Clicking the drop zone creates an <input type="file"> and clicks it.
    // Playwright auto-dismisses the file chooser; we just verify no crash.
    await dropZone.click();
    await page.waitForTimeout(300);
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('dashboard drop zone handles Enter key', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/');
    const dropZone = page.locator('[aria-label="Drop audio file here or click to browse"]');
    await dropZone.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('dashboard drop zone handles Space key', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/');
    const dropZone = page.locator('[aria-label="Drop audio file here or click to browse"]');
    await dropZone.focus();
    await page.keyboard.press(' ');
    await page.waitForTimeout(300);
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });
});
