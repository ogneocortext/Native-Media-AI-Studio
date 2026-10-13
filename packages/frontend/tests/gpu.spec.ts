import { test, expect } from '@playwright/test';
import {
  navigateWithWait,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
  mockApiHealth,
  mockApiSystemHealth,
  mockGpuTelemetry,
  DEFAULT_GPU_SNAPSHOT,
  BACKEND_OFFLINE_FILTERS,
} from './helpers';

test.describe('GPU', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('gpu page loads and shows header', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockGpuTelemetry(page);
    await navigateWithWait(page, '/gpu');
    await expect(page.locator('main h1').first()).toContainText('GPU');
    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });

  test('gpu page renders the telemetry values from the snapshot', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page, 200);
    await mockApiSystemHealth(page);
    await mockGpuTelemetry(page);
    await navigateWithWait(page, '/gpu');
    // The old version of this test asserted only `expect(body).toBeVisible()`,
    // which is true for every page including an error or empty state. The page
    // renders the mocked snapshot (see GpuMetricCards/GpuMonitorHeader), so
    // assert the actual values flow through: device name in the header, the
    // utilisation percentage, the temperature, and the VRAM figure.
    await expect(page.getByText('Real-time telemetry for', { exact: false })).toBeVisible();
    await expect(page.locator('main')).toContainText(DEFAULT_GPU_SNAPSHOT.name);
    await expect(page.locator('main')).toContainText(`${DEFAULT_GPU_SNAPSHOT.gpu_utilization}%`);
    await expect(page.locator('main')).toContainText(`${DEFAULT_GPU_SNAPSHOT.temperature_c}°C`);
    await expect(page.locator('main')).toContainText('4.0 GB');
    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });
});
