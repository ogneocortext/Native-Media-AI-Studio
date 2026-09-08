import { test, expect } from '@playwright/test';
import {
  navigateWithWait,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
  mockHealthPage,
  mockGoServiceHealth,
  mockGoServiceHealthDegraded,
} from './helpers';

test.describe('GoServicesCard', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('renders Go services as all online when healthy', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockHealthPage(page);
    await mockGoServiceHealth(page);
    await navigateWithWait(page, '/health');

    const card = page.locator('.card:has(h3:has-text("Go Sidecars"))');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator('h3')).toContainText('5/5 online');

    const services = ['Go Dashboard', 'Go Media', 'Go Worker', 'Go Gateway', 'Go Ports'];
    for (const svc of services) {
      await expect(page.locator(`.text-white:has-text("${svc}")`)).toBeVisible();
    }

    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('shows degraded state when some Go services are offline', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockHealthPage(page);
    await mockGoServiceHealthDegraded(page, ['go-media', 'go-ports']);
    await navigateWithWait(page, '/health');

    const card = page.locator('.card:has(h3:has-text("Go Sidecars"))');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator('h3')).toContainText('3/5 online');

    await expect(page.locator('text=Offline').first()).toBeVisible();

    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('shows all offline when no Go services respond', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockHealthPage(page);
    await mockGoServiceHealthDegraded(page, [
      'go-dashboard',
      'go-media',
      'go-worker',
      'go-gateway',
      'go-ports',
    ]);
    await navigateWithWait(page, '/health');

    const card = page.locator('.card:has(h3:has-text("Go Sidecars"))');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator('h3')).toContainText('0/5 online');

    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('GoServicesCard does not throw when backend health is failing', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockHealthPage(page, { healthStatus: 500 });
    await mockGoServiceHealth(page);
    await navigateWithWait(page, '/health');

    const card = page.locator('.card:has(h3:has-text("Go Sidecars"))');
    await expect(card).toBeVisible({ timeout: 10_000 });

    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED', '500']);
  });
});
