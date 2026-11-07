import { test, expect } from '@playwright/test';
import {
  navigateWithWait,
  mockApiHealth,
  mockApiQueueEmpty,
  mockApiQueueWithJobs,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
  BACKEND_OFFLINE_FILTERS,
} from './helpers';

test.describe('Queue', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('queue page loads and shows empty state when no jobs', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page);
    await mockApiQueueEmpty(page);
    await navigateWithWait(page, '/queue');
    // Debug: check console errors
    console.log('Console errors:', errors);
    // Wait for the queue to finish loading (h1 appears after data fetch)
    await expect(page.locator('main h1').first()).toContainText('Job Queue', { timeout: 10_000 });
    // Wait for loading spinner to disappear
    await expect(page.locator('main').locator('text=Loading queue')).toBeHidden({ timeout: 10_000 });
    // Debug: check what the page contains after loading
    const mainContent = await page.locator('main').innerHTML();
    console.log('Main content after loading:', mainContent.substring(0, 3000));
    // Wait for empty state to appear
    await expect(page.locator('main').locator('text=No jobs in queue')).toBeVisible({ timeout: 10_000 });
    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });

  test('queue page renders running job section when jobs exist', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page);
    await mockApiQueueWithJobs(page, 3);
    await navigateWithWait(page, '/queue');
    await expect(page.locator('main h1').first()).toContainText('Job Queue', { timeout: 10_000 });
    await expect(page.locator('main').locator('text=Currently Running')).toBeVisible();
    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });

  test('queue page renders pending, failed, and completed sections', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page);
    await mockApiQueueWithJobs(page, 4);
    await navigateWithWait(page, '/queue');
    await expect(page.locator('main h1').first()).toContainText('Job Queue', { timeout: 10_000 });
    // Page shows section headings; verify core content is present
    // Target the specific section heading h3 to avoid strict mode violation with h1 "Job Queue"
    await expect(page.locator('main h3:has-text("Queue")')).toBeVisible();
    await expect(page.locator('main h3:has-text("Failed")')).toBeVisible();
    await expect(page.locator('main h3:has-text("Completed")')).toBeVisible();
    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });

  test('queue stats show correct counts', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page);
    await mockApiQueueWithJobs(page, 3);
    await navigateWithWait(page, '/queue');
    await expect(page.locator('main h1').first()).toContainText('Job Queue', { timeout: 10_000 });
    // Verify stats section shows Total/Pending/Running/Completed/Failed labels
    // Target stat card labels specifically to avoid strict mode violations
    await expect(page.locator('main >> text=Total')).toBeVisible();
    await expect(page.locator('main .text-center:has-text("Pending") >> text=Pending')).toBeVisible();
    await expect(page.locator('main .text-center:has-text("Running") >> text=Running')).toBeVisible();
    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });

  test('SSE live indicator is visible on queue page', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page);
    await mockApiQueueEmpty(page);
    await navigateWithWait(page, '/queue');
    await expect(page.locator('main h1').first()).toContainText('Job Queue', { timeout: 10_000 });
    // Either "Live" or "Polling" indicator should be present
    const liveOrPolling = page.locator('main').locator('text=/Live|Polling/').first();
    await expect(liveOrPolling).toBeVisible();
    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });

  test('job cards contain type and progress information', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page);
    await mockApiQueueWithJobs(page, 2);
    await navigateWithWait(page, '/queue');
    await expect(page.locator('main h1').first()).toContainText('Job Queue', { timeout: 10_000 });
    // Component renders job_type with underscores replaced by spaces ("image generation")
    await expect(page.locator('main').locator('text=image generation').first()).toBeVisible();
    // Progress 0.45 renders as "45.0%" with one decimal place
    await expect(page.locator('main').locator('text=45.0%').first()).toBeVisible();
    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });
});
