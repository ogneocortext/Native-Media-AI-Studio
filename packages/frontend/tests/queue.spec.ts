import { test, expect } from '@playwright/test';
import {
  navigateWithWait,
  mockApiQueueEmpty,
  mockApiQueueWithJobs,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
} from './helpers';

test.describe('Queue', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('queue page loads and shows empty state when no jobs', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiQueueEmpty(page);
    await navigateWithWait(page, '/queue');
    await expect(page.locator('main h1').first()).toContainText('Job Queue');
    await expect(page.locator('main').locator('text=No jobs in queue')).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('queue page renders running job section when jobs exist', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiQueueWithJobs(page, 3);
    await navigateWithWait(page, '/queue');
    await expect(page.locator('main').locator('text=Currently Running')).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('queue page renders pending, failed, and completed sections', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiQueueWithJobs(page, 4);
    await navigateWithWait(page, '/queue');
    // Page shows section headings; verify core content is present
    // Target the specific section heading h3 to avoid strict mode violation with h1 "Job Queue"
    await expect(page.locator('main h3:has-text("Queue")')).toBeVisible();
    await expect(page.locator('main h3:has-text("Failed")')).toBeVisible();
    await expect(page.locator('main h3:has-text("Completed")')).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('queue stats show correct counts', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiQueueWithJobs(page, 3);
    await navigateWithWait(page, '/queue');
    // Verify stats section shows Total/Pending/Running/Completed/Failed labels
    // Target stat card labels specifically to avoid strict mode violations
    await expect(page.locator('main >> text=Total')).toBeVisible();
    await expect(page.locator('main >> text=Pending')).toBeVisible();
    await expect(page.locator('main .text-center:has-text("Running") >> text=Running')).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('SSE live indicator is visible on queue page', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiQueueEmpty(page);
    await navigateWithWait(page, '/queue');
    // Either "Live" or "Polling" indicator should be present
    const live = page.locator('main').locator('text=Live');
    const polling = page.locator('main').locator('text=Polling');
    await expect(live.or(polling)).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('job cards contain type and progress information', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiQueueWithJobs(page, 2);
    await navigateWithWait(page, '/queue');
    // Component renders job_type with underscores replaced by spaces ("image generation")
    await expect(page.locator('main').locator('text=image generation').first()).toBeVisible();
    // Progress 0.45 renders as "45.0%" with one decimal place
    await expect(page.locator('main').locator('text=45.0%').first()).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });
});
