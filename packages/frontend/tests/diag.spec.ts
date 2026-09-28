import { test } from '@playwright/test';
import { navigateWithWait, cleanupRoutes, mockHealthPage, mockGoServiceHealth } from './helpers';

test('diagnose health page state', async ({ page }) => {
  await cleanupRoutes(page);
  const failures: string[] = [];
  page.on('requestfailed', (req) => failures.push(`FAILED ${req.method()} ${req.url()} :: ${req.failure()?.errorText}`));
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('events')) failures.push(`HTTP ${res.status()} ${res.url()}`);
  });
  await mockHealthPage(page);
  await mockGoServiceHealth(page);
  await navigateWithWait(page, '/health');
  await page.waitForTimeout(6000);
  const state = await page.evaluate(() => {
    const win = window as unknown as {
      __healthStore?: { getState?: () => unknown };
    };
    const s = win.__healthStore?.getState?.() as Record<string, unknown> | undefined;
    return s
      ? { loading: s.isLoading, error: s.error, systemHealth: !!s.systemHealth, serviceStatus: !!s.serviceStatus, overall: s.overall }
      : 'NO STORE';
  });
  console.log('STORE STATE:', JSON.stringify(state));
  console.log('NETWORK ISSUES:\n' + failures.join('\n'));
  const mainText = await page.locator('main').innerText().catch(() => '(no main)');
  console.log('MAIN TEXT:', mainText.slice(0, 500));
});
