import { test, expect } from '@playwright/test';
import {
  navigateWithWait,
  mockApiHealth,
  mockApiQueueEmpty,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
} from './helpers';

const PIPELINE_PAGES = [
  { path: '/health', label: 'Health' },
  { path: '/queue', label: 'Queue' },
  { path: '/audio-analysis', label: 'Audio Analysis' },
  { path: '/generate-3d', label: '3D Model Generation' },
  { path: '/video-generation', label: 'Video Generation' },
  { path: '/music-video-wizard', label: 'Upload Your Track' },
];

test.describe('Pipeline smoke', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  for (const pageInfo of PIPELINE_PAGES) {
    test(`${pageInfo.label} page loads without console errors`, async ({ page }) => {
      const errors = setupConsoleErrorCapture(page);
      await mockApiHealth(page);
      await mockApiQueueEmpty(page);
      await navigateWithWait(page, pageInfo.path);
      await expect(page.locator('main').first()).toContainText(pageInfo.label, { timeout: 10_000 });
      expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
    });
  }

  test('navigation between pipeline pages preserves app shell', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page);
    await mockApiQueueEmpty(page);

    await navigateWithWait(page, '/audio-analysis');
    await expect(page.locator('main').first()).toContainText('Audio Analysis');

    await navigateWithWait(page, '/generate-3d');
    await expect(page.locator('main').first()).toContainText('3D Model Generation', { timeout: 10_000 });

    await navigateWithWait(page, '/video-generation');
    await expect(page.locator('main').first()).toContainText('Video Generation', { timeout: 10_000 });

    await navigateWithWait(page, '/music-video-wizard');
    await expect(page.locator('main').first()).toContainText('Upload Your Track', { timeout: 10_000 });

    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });
});
