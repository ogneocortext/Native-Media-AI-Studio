import { test, expect } from '@playwright/test';
import {
  navigateWithWait,
  mockApiHealth,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
  dispatchSseEvent,
} from './helpers';

test.describe('SSE & Realtime', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('layout initializes SSE connection without crashing', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page, 200);
    await navigateWithWait(page, '/');

    // The Layout connects SSE on mount; verify the global store exists and has
    // a boolean sseConnected property regardless of whether the real backend responded.
    const sseConnected = await page.evaluate(() => {
      const win = window as any;
      const store = win.__healthStore;
      return typeof store?.getState?.()?.sseConnected === 'boolean';
    });
    expect(sseConnected).toBe(true);
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('health store reflects mocked API response', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page, 200);
    await navigateWithWait(page, '/');

    const overall = await page.evaluate(() => {
      const win = window as any;
      const store = win.__healthStore;
      return store?.getState?.()?.overall;
    });
    expect(['healthy', 'degraded', 'unhealthy']).toContain(overall);
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('no unhandled SSE errors on navigation and close', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page, 200);
    await navigateWithWait(page, '/');
    await page.waitForTimeout(500);
    // Navigate away to trigger disconnect
    await page.goto('about:blank');
    await page.waitForTimeout(200);
    const hasSseError = errors.some((e) => e.includes('SSE') || e.includes('EventSource'));
    expect(hasSseError).toBe(false);
  });

  test('SSE health_changed event updates store', async ({ page }) => {
    await mockApiHealth(page, 200);
    await navigateWithWait(page, '/');

    // Dispatch a synthetic SSE event that should update the health store.
    await dispatchSseEvent(page, {
      type: 'system.health_changed',
      data: {
        backend: 'online',
        overall: 'degraded',
        adapters: { comfyui: { name: 'ComfyUI', status: 'offline' } },
        timestamp: new Date().toISOString(),
      },
    });

    const overall = await page.evaluate(() => {
      const win = window as any;
      const store = win.__healthStore;
      return store?.getState?.()?.overall;
    });
    expect(overall).toBe('degraded');
  });
});
