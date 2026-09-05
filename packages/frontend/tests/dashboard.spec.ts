import { test, expect } from '@playwright/test';
import {
  navigateWithWait,
  mockApiHealth,
  mockApiQueueEmpty,
  mockApiQueueWithJobs,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
} from './helpers';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('renders hero headline and CTA', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/');
    // Scope to main content to avoid matching the sidebar's h1
    await expect(page.locator('main h1').first()).toContainText('Drop your song');
    await expect(page.locator('main h1').first()).toContainText('Get your video');
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('shows drop zone with accessible label', async ({ page }) => {
    await navigateWithWait(page, '/');
    const dropZone = page.locator('[aria-label="Drop audio file here or click to browse"]');
    await expect(dropZone).toBeVisible();
  });

  test('drop zone accepts keyboard activation', async ({ page }) => {
    await navigateWithWait(page, '/');
    const dropZone = page.locator('[aria-label="Drop audio file here or click to browse"]');
    await dropZone.focus();
    await page.keyboard.press('Enter');
    // Should not throw; Playwright auto-dismisses the file picker.
    await page.waitForTimeout(300);
  });

  test('shows 3-step instruction grid', async ({ page }) => {
    await navigateWithWait(page, '/');
    // Scope to the step grid container to avoid matching sidebar text
    const stepGrid = page.locator('.grid.grid-cols-3').first();
    await expect(stepGrid.getByText('Drop song', { exact: true })).toBeVisible();
    await expect(stepGrid.getByText('Pick style', { exact: true })).toBeVisible();
    await expect(stepGrid.getByText('Export', { exact: true })).toBeVisible();
  });

  test('shows first-time guidance when no outputs and no active jobs', async ({ page }) => {
    await mockApiHealth(page, 200);
    await mockApiQueueEmpty(page);
    await navigateWithWait(page, '/');
    await expect(page.locator('text=First time? Use the Happyshrimp demo')).toBeVisible();
  });

  test('shows active jobs card when jobs are in progress', async ({ page }) => {
    await mockApiHealth(page, 200);
    await mockApiQueueWithJobs(page, 1);
    await navigateWithWait(page, '/');
    await expect(page.locator('text=Jobs in progress')).toBeVisible();
    await expect(page.locator('text=View Queue')).toBeVisible();
  });

  test('drop zone accepts drag-and-drop', async ({ page }) => {
    await navigateWithWait(page, '/');
    const dropZone = page.locator('[aria-label="Drop audio file here or click to browse"]');
    await expect(dropZone).toBeVisible();
    // Simulate dragover event (the handler calls preventDefault + setDragOver)
    await dropZone.evaluate((el) => {
      const event = new DragEvent('dragover', { bubbles: true, cancelable: true });
      el.dispatchEvent(event);
    });
    // Simulate drop event
    await dropZone.evaluate((el) => {
      const event = new DragEvent('drop', { bubbles: true, cancelable: true });
      el.dispatchEvent(event);
    });
    // Should not throw; navigation may or may not occur depending on handler.
  });

  test('no console errors on initial load', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/');
    await page.waitForTimeout(1000);
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });
});
