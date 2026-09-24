import { test, expect, type Page } from '@playwright/test';
import {
  navigateWithWait,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
  mockApiHealth,
  mockApiSystemHealth,
} from './helpers';
import { buildUnityAudioFrameProperties } from '../src/services/api';

/** Commands returned by GET /api/unity/commands (shape mirrors the live envelope). */
const UNITY_COMMANDS = [
  { name: 'create_gameobject', description: 'Create a GameObject', tags: ['core'], package: 'UnityPipeline.Runtime' },
  { name: 'set_object_visibility', description: 'Set GameObject visibility', tags: ['core'], package: 'UnityPipeline.Runtime' },
  { name: 'capture_scene_view', description: 'Capture the Scene View', tags: ['capture'], package: 'UnityPipeline.Editor' },
];

/**
 * Mock all `/api/unity/*` endpoints with their real response shapes.
 * Records request methods into `record` for assertions.
 *
 * NOTE: the `command` pattern is exact (`.../command`) while `commands` keeps
 * a trailing wildcard, so the two never shadow each other regardless of the
 * order Playwright evaluates routes.
 */
async function mockUnityApi(page: Page, record: { commandMethod?: string; captureMethod?: string; lastCommand?: Record<string, unknown> } = {}): Promise<void> {
  await page.route('**/api/unity/status*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ online: true, status: { unity: true, mode: 'websocket' } }),
    }),
  );
  await page.route('**/api/unity/command', (route) => {
    record.commandMethod = route.request().method();
    record.lastCommand = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { name: 'TestObject', created: true } }),
    });
  });
  await page.route('**/api/unity/commands*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Live backend returns an envelope, not a bare array and not a flat map.
      body: JSON.stringify({
        commands: UNITY_COMMANDS,
        count: UNITY_COMMANDS.length,
        total: 149,
        offset: 0,
        limit: 200,
        server: 'UnityPipeline',
      }),
    }),
  );
  await page.route('**/api/unity/capture*', (route) => {
    record.captureMethod = route.request().method();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: { savedPath: 'Assets/output/unity_capture.png', width: 1920, height: 1080 },
      }),
    });
  });
}

test.describe('Unity Control', () => {
  const record: { commandMethod?: string; captureMethod?: string; lastCommand?: Record<string, unknown> } = {};

  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
    record.commandMethod = undefined;
    record.captureMethod = undefined;
    record.lastCommand = undefined;
    await mockApiHealth(page, 200);
    await mockApiSystemHealth(page);
    await mockUnityApi(page, record);
  });

  test('unity page loads with header and online status', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/unity');
    await expect(page.locator('main h1').first()).toContainText('Unity Control');
    await expect(page.getByText('Unity Pipeline server is online')).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('tabs expose the ARIA tab pattern', async ({ page }) => {
    await navigateWithWait(page, '/unity');
    const tablist = page.getByRole('tablist', { name: 'Unity control views' });
    await expect(tablist.getByRole('tab', { name: /Quick Actions/ })).toHaveAttribute('aria-selected', 'true');
    await expect(tablist.getByRole('tab', { name: /Custom Command/ })).toHaveAttribute('aria-selected', 'false');

    await tablist.getByRole('tab', { name: /Custom Command/ }).click();
    await expect(page.locator('#unity-panel-custom')).toBeVisible();
    await expect(page.locator('#unity-panel-custom')).toHaveAttribute('aria-labelledby', 'unity-tab-custom');
  });

  test('custom command dropdown lists real commands, not envelope keys', async ({ page }) => {
    await navigateWithWait(page, '/unity');
    await page.getByRole('tab', { name: /Custom Command/ }).click();

    const select = page.getByLabel('Insert a Unity command');
    await expect(select).toBeVisible();

    const options = select.locator('option');
    // +1 for the "Insert command..." placeholder
    await expect(options).toHaveCount(UNITY_COMMANDS.length + 1);
    await expect(options.filter({ hasText: 'create_gameobject' })).toHaveCount(1);
    await expect(options.filter({ hasText: 'capture_scene_view' })).toHaveCount(1);

    // Regression: JSON envelope keys must never surface as commands.
    for (const envelopeKey of ['commands', 'count', 'total', 'offset']) {
      await expect(options.filter({ hasText: new RegExp(`^${envelopeKey}$`) })).toHaveCount(0);
    }
  });

  test('capture button issues POST /api/unity/capture and shows a friendly toast', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/unity');
    await expect(page.getByText('Unity Pipeline server is online')).toBeVisible();

    await page.getByRole('button', { name: 'Capture' }).click();

    await expect(page.locator('.toast').filter({ hasText: 'Scene captured' })).toBeVisible();
    expect(record.captureMethod).toBe('POST');
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('audio sync helper maps visualizer frame to Unity shader properties', async () => {
    const properties = buildUnityAudioFrameProperties({
      audioData: { bass: 0.8, mid: 0.5, treble: 0.3, beat: true, energy: 0.7, peak: 0.9, beatPhase: 0.25, analyzedEnergy: 0.84 },
      audioTime: 8,
      progress: 0.04,
      intensity: 1.35,
    });
    expect(properties).toEqual({ _Bass: 0.8, _Mid: 0.5, _Treble: 0.3, _Beat: 1, _Energy: 0.84, _AudioTime: 8, _Progress: 0.04, _Intensity: 1.35 });
  });

  test('quick action executes the command and records history', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/unity');
    await expect(page.getByText('Unity Pipeline server is online')).toBeVisible();

    await page.locator('#unity-panel-quick').getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.locator('.toast').filter({ hasText: 'Command "create_gameobject" succeeded' })).toBeVisible();
    expect(record.commandMethod).toBe('POST');

    await page.getByRole('tab', { name: /^History/ }).click();
    await expect(page.locator('#unity-panel-history').getByText('create_gameobject').first()).toBeVisible();
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });
});
