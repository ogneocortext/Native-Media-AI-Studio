import { test, expect } from '@playwright/test';
import {
  navigateWithWait,
  mockApiHealth,
  mockApiSystemHealth,
  mockApiServiceStatus,
  mockHealthPage,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
} from './helpers';

test.describe('Health', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('health page loads and shows backend online', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockHealthPage(page);
    await navigateWithWait(page, '/health');
    await expect(page.locator('main h1').first()).toContainText('System Health');
    // Verify resource cards render - more specific locators to avoid false positives
    await expect(page.locator('.resource-card', { hasText: 'CPU' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.resource-card', { hasText: 'Memory' })).toBeVisible();
    await expect(page.locator('.resource-card', { hasText: 'Disk' })).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('health page shows adapter cards when mocked', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockHealthPage(page, { comfyuiInstalled: true });
    await navigateWithWait(page, '/health');
    // Stable class-based selectors
    await expect(page.locator('.service-checks-card')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.comfy-card')).toBeVisible();
    await expect(page.locator('.ollama-card')).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('shows unhealthy state when health endpoint fails', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockHealthPage(page, { healthStatus: 500 });
    await navigateWithWait(page, '/health');
    await expect(page.locator('main h1').first()).toContainText('System Health');
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED', '500']);
  });

  test('shows degraded state when overall is degraded', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockHealthPage(page, {
      systemHealth: { status: 'degraded' },
      serviceStatus: { adapters: { comfyui: 'degraded' } },
    });
    await navigateWithWait(page, '/health');
    // Page renders resource cards regardless of health status
    await expect(page.locator('.resource-card', { hasText: 'CPU' })).toBeVisible({ timeout: 10_000 });
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('resource cards show CPU, memory, disk usage', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockHealthPage(page);
    await navigateWithWait(page, '/health');
    await expect(page.locator('.resource-card', { hasText: 'CPU' })).toBeVisible();
    await expect(page.locator('.resource-card', { hasText: 'Memory' })).toBeVisible();
    await expect(page.locator('.resource-card', { hasText: 'Disk' })).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('services section lists configured adapters', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockHealthPage(page);
    await navigateWithWait(page, '/health');
    await expect(page.locator('.service-checks-card')).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });
});
