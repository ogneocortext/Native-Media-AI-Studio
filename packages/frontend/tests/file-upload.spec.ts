import { test, expect } from '@playwright/test';
import {
  navigateWithWait,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
  dashboardDropZone,
  expectAudioPickerOpens,
  expectKeyOpensPicker,
  BACKEND_OFFLINE_FILTERS,
} from './helpers';

/**
 * File-picker behaviour of the dashboard drop zone.
 *
 * The previous versions of these tests asserted nothing after a fixed 300ms
 * sleep ("should not throw"), so they passed even when the drop zone was a
 * decorative div that opened no picker — and they all failed together for the
 * real reason: the hardcoded accessible name had gone stale when the copy
 * changed. Both problems are fixed here.
 *
 * The pointer path is asserted with the real OS `filechooser` event; keyboard
 * paths use expectKeyOpensPicker, because Chromium stops surfacing the
 * `filechooser` event after a couple of programmatic opens per browser
 * session (measured: opens #1-#2 fire, #3+ do not).
 */

test.describe('File Upload', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('dashboard drop zone opens the file picker on click', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/');
    await expect(dashboardDropZone(page)).toBeVisible();
    await expectAudioPickerOpens(page, () => dashboardDropZone(page).click());
    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });

  test('dashboard drop zone opens the file picker on Enter', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/');
    await expectKeyOpensPicker(page, 'Enter');
    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });

  test('dashboard drop zone opens the file picker on Space', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/');
    await expectKeyOpensPicker(page, ' ');
    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });

  test('drop zone hides a native file input with an audio accept', async ({ page }) => {
    await navigateWithWait(page, '/');
    // The picker above opens whatever this input accepts; assert it directly so
    // a regression to accept="*/*" fails here rather than only in the chooser.
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveAttribute('accept', /audio\//);
  });
});
