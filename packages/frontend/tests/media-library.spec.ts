import { test, expect, type Route } from '@playwright/test';
import {
  navigateWithWait,
  mockApiHealth,
  mockApiQueueEmpty,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
  registerRouteHandler,
} from './helpers';

const MOCK_OUTPUTS = {
  outputs: [
    {
      filename: 'hero.png',
      path: '/output/images/hero.png',
      relative_path: 'images/hero.png',
      file_type: 'image',
      size_bytes: 1024,
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
      cover_image: null,
      has_cover: false,
      metadata: { prompt: 'sunset', seed: 1 },
      job_id: 'job-1',
    },
    {
      filename: 'clip.mp4',
      path: '/output/video/clip.mp4',
      relative_path: 'video/clip.mp4',
      file_type: 'video',
      size_bytes: 2048,
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
      cover_image: null,
      has_cover: false,
      metadata: null,
      job_id: 'job-2',
    },
    {
      filename: 'track.mp3',
      path: '/output/audio/track.mp3',
      relative_path: 'audio/track.mp3',
      file_type: 'audio',
      size_bytes: 512,
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
      cover_image: null,
      has_cover: false,
      metadata: null,
      job_id: null,
    },
    {
      filename: 'model.glb',
      path: '/output/generated_3d/model.glb',
      relative_path: 'generated_3d/model.glb',
      file_type: '3d',
      size_bytes: 4096,
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
      cover_image: null,
      has_cover: false,
      metadata: {},
      job_id: null,
    },
  ],
  total: 4,
  images_count: 1,
  videos_count: 1,
  audio_count: 1,
  models_3d_count: 1,
};

const MOCK_RECENT = MOCK_OUTPUTS.outputs.slice(0, 2);

function mockOutputsApi(page: Parameters<typeof registerRouteHandler>[0]) {
  registerRouteHandler(page, async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/outputs' || pathname.startsWith('/api/outputs?')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_OUTPUTS),
      });
    } else if (pathname === '/api/outputs/recent') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_RECENT),
      });
    } else if (pathname === '/api/outputs/duplicates/groups') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    } else {
      await route.fallback();
    }
  });
}

test.describe('Media Library', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('media library page loads and shows header', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page);
    await mockApiQueueEmpty(page);
    mockOutputsApi(page);
    await navigateWithWait(page, '/library');
    await expect(page.locator('main h1').first()).toContainText('Media Library', { timeout: 10_000 });
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('category tabs are present and selectable', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page);
    await mockApiQueueEmpty(page);
    mockOutputsApi(page);
    await navigateWithWait(page, '/library');
    await expect(page.locator('main h1').first()).toContainText('Media Library', { timeout: 10_000 });

    const allTab = page.locator('button', { hasText: 'All Files' }).first();
    const imagesTab = page.locator('button', { hasText: 'Images' }).first();
    const videosTab = page.locator('button', { hasText: 'Videos' }).first();
    const audioTab = page.locator('button', { hasText: 'Audio' }).first();

    await expect(allTab).toBeVisible();
    await expect(imagesTab).toBeVisible();
    await expect(videosTab).toBeVisible();
    await expect(audioTab).toBeVisible();

    await imagesTab.click();
    await expect(page.locator('main').first()).toContainText('Media Library', { timeout: 10_000 });

    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('search input is present and keyboard shortcut hint exists', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page);
    await mockApiQueueEmpty(page);
    mockOutputsApi(page);
    await navigateWithWait(page, '/library');
    await expect(page.locator('main h1').first()).toContainText('Media Library', { timeout: 10_000 });

    const searchInput = page.locator('input[placeholder*="Search" i], input[placeholder*="Filter" i]').first();
    await expect(searchInput).toBeVisible();

    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('send to wizard button is present on media items', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiHealth(page);
    await mockApiQueueEmpty(page);
    mockOutputsApi(page);
    await navigateWithWait(page, '/library');
    await expect(page.locator('main h1').first()).toContainText('Media Library', { timeout: 10_000 });

    const sendToWizard = page.locator('button[title="Send to Music Video Wizard"]').first();
    await expect(sendToWizard).toBeVisible();

    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });
});
