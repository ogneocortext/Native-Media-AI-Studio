import { test, expect } from '@playwright/test';
import {
  navigateWithWait,
  mockApiHealth,
  mockApiQueueEmpty,
  mockApiQueueWithJobs,
  cleanupRoutes,
  setupConsoleErrorCapture,
  expectNoConsoleErrors,
  dashboardDropZone,
  expectKeyOpensPicker,
  BACKEND_OFFLINE_FILTERS,
} from './helpers';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('renders hero headline and CTA', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/');
    // Scope to main content to avoid matching the sidebar's h1
    await expect(page.locator('main h1').first()).toContainText('Drop your song');
    await expect(page.locator('main h1').first()).toContainText('Get your video');
    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });

  test('shows drop zone with accessible label', async ({ page }) => {
    await navigateWithWait(page, '/');
    await expect(dashboardDropZone(page)).toBeVisible();
  });

  test('drop zone opens the audio picker on keyboard activation', async ({ page }) => {
    await navigateWithWait(page, '/');
    // A keyboard-operable button must actually reach the picker; the old
    // version pressed a key, slept 300ms and asserted nothing. The OS
    // filechooser event is asserted in file-upload.spec.ts (click path);
    // keyboard paths observe the picker invocation directly.
    await expectKeyOpensPicker(page, 'Enter');
  });

  test('shows 3-step instruction grid', async ({ page }) => {
    await navigateWithWait(page, '/');
    // Scope to the step grid container to avoid matching sidebar text
    const stepGrid = page.locator('.grid.grid-cols-3').first();
    await expect(stepGrid.getByText('Drop song', { exact: true })).toBeVisible();
    await expect(stepGrid.getByText('Pick style', { exact: true })).toBeVisible();
    await expect(stepGrid.getByText('Export', { exact: true })).toBeVisible();
  });

  test('shows first-time guidance when no outputs and no active jobs', async ({ page }) => {
    await mockApiHealth(page, 200);
    await mockApiQueueEmpty(page);
    await navigateWithWait(page, '/');
    await expect(page.locator('text=First time? Use the Happyshrimp demo')).toBeVisible();
  });

  test('shows active jobs card when jobs are in progress', async ({ page }) => {
    await mockApiHealth(page, 200);
    await mockApiQueueWithJobs(page, 1);
    await navigateWithWait(page, '/');
    await expect(page.locator('text=Jobs in progress')).toBeVisible();
    await expect(page.locator('text=View Queue')).toBeVisible();
  });

  test('drop zone reflects drag state and rejects non-audio drops', async ({ page }) => {
    await navigateWithWait(page, '/');
    const dropZone = dashboardDropZone(page);
    await expect(dropZone).toBeVisible();

    // The drag handlers drive a `dragOver` state whose tailwind class is
    // border-violet-500. The old test dispatched bare DragEvents with no
    // DataTransfer and asserted nothing at all; these events run the real
    // handler code and check the visible result.
    //
    // The class pattern is anchored with (^|\s)…(\s|$): the idle class list
    // contains `hover:border-violet-500/40`, which an unanchored
    // /border-violet-500/ would match — so the negative assertion would fail
    // while the zone is visibly idle (and the positive one could pass
    // vacuously).
    const DRAG_ON = /(^|\s)border-violet-500(\s|$)/;
    const DRAG_OFF = /(^|\s)border-white\/10(\s|$)/;

    const emptyTransfer = await page.evaluateHandle(() => new DataTransfer());
    await dropZone.dispatchEvent('dragenter', { dataTransfer: emptyTransfer, bubbles: true });
    await expect(dropZone).toHaveClass(DRAG_ON);
    await expect(dropZone).not.toHaveClass(DRAG_OFF);
    await dropZone.dispatchEvent('dragover', { dataTransfer: emptyTransfer, bubbles: true });
    await expect(dropZone).toHaveClass(DRAG_ON);

    // A dropped non-audio file must surface the accessible error message.
    // (Dropping a real audio file would start a GPU probe and network I/O.)
    const rejectedTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['not audio'], 'notes.txt', { type: 'text/plain' }));
      return dt;
    });
    await dropZone.dispatchEvent('drop', { dataTransfer: rejectedTransfer, bubbles: true });
    await expect(dropZone.locator('[role="alert"]')).toContainText('not an audio file');

    // Dropping resets the drag state (counter -> 0, dragOver -> false).
    await expect(dropZone).not.toHaveClass(DRAG_ON);
    await expect(dropZone).toHaveClass(DRAG_OFF);
    await dropZone.dispatchEvent('dragleave', { dataTransfer: emptyTransfer, bubbles: true });
    await expect(dropZone).not.toHaveClass(DRAG_ON);
  });

  test('no console errors on initial load', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await navigateWithWait(page, '/');
    await page.waitForTimeout(1000);
    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });
});
