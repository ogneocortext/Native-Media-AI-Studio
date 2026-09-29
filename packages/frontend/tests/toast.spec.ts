import { test, expect, type Page } from '@playwright/test';
import { navigateWithWait, cleanupRoutes } from './helpers';

/**
 * Toast-system tests.
 *
 * `src/utils/toast.ts` is a framework-free DOM utility, so it is exercised by
 * importing the very same module instance the app uses (Vite serves the module
 * by URL, so `/src/utils/toast.ts` resolves to the singleton) and inspecting the
 * resulting DOM.
 *
 * Covered: the `error` type, de-duplication, the stack cap, pause-on-hover,
 * sticky durations, `update()` in place, `clearToasts()`, ARIA wiring, the
 * dismiss button, and the bounded width for long server messages.
 */

// Non-literal specifier so the test type-checks without resolving the app path.
const TOAST_MODULE_URL = '/src/utils/toast.ts';

interface ToastModule {
  showToast: (
    message: string,
    typeOrOptions?:
      | string
      | { type?: string; duration?: number; detail?: string; dismissible?: boolean },
  ) => { dismiss: () => void; update: (m: string, d?: string) => void; element: unknown };
  clearToasts: () => void;
}

declare global {
  interface Window {
    __toast: ToastModule;
  }
}

async function loadToasts(page: Page): Promise<void> {
  await page.evaluate(async (url) => {
    const mod = (await import(url)) as ToastModule;
    window.__toast = mod;
  }, TOAST_MODULE_URL);
}

test.beforeEach(async ({ page }) => {
  await cleanupRoutes(page);
  await navigateWithWait(page, '/');
  await loadToasts(page);
  await page.evaluate(() => window.__toast.clearToasts());
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__toast.clearToasts()).catch(() => {});
});

test.describe('toast system', () => {
  test('error type is distinct and announced assertively', async ({ page }) => {
    await page.evaluate(() => window.__toast.showToast('Render failed', 'error'));

    const toast = page.locator('.toast.toast-error');
    await expect(toast).toHaveCount(1);
    await expect(toast).toHaveAttribute('role', 'alert');
    await expect(toast).toContainText('Render failed');
  });

  test('non-error types stay polite', async ({ page }) => {
    await page.evaluate(() => window.__toast.showToast('Applied preset', 'success'));
    const toast = page.locator('.toast.toast-success');
    await expect(toast).toHaveAttribute('role', 'status');
  });

  test('container is a labelled live region', async ({ page }) => {
    // The container is created lazily on the first toast.
    await page.evaluate(() => window.__toast.showToast('hello', 'info'));
    const container = page.locator('.toast-container');
    await expect(container).toHaveAttribute('aria-live', 'polite');
    await expect(container).toHaveAttribute('aria-label', 'Notifications');
  });

  test('identical messages are de-duplicated while visible', async ({ page }) => {
    // Polling / SSE handlers used to append a new toast on every tick.
    const count = await page.evaluate(() => {
      for (let i = 0; i < 5; i += 1) window.__toast.showToast('Queue position updated', 'info');
      return document.querySelectorAll('.toast').length;
    });
    expect(count).toBe(1);
  });

  test('the stack is capped so toasts cannot pile up', async ({ page }) => {
    const count = await page.evaluate(() => {
      for (let i = 0; i < 8; i += 1) window.__toast.showToast(`message ${i}`, 'info');
      return document.querySelectorAll('.toast').length;
    });
    expect(count).toBe(4); // MAX_VISIBLE
  });

  test('dismiss button removes the toast', async ({ page }) => {
    await page.evaluate(() => window.__toast.showToast('Click the x', 'warning'));
    await page.locator('.toast .toast__close').click();
    await expect(page.locator('.toast')).toHaveCount(0);
  });

  test('hovering pauses auto-dismiss so the message can be read', async ({ page }) => {
    await page.evaluate(() =>
      window.__toast.showToast('Hold me', { type: 'info', duration: 700 }),
    );
    const toast = page.locator('.toast');
    await toast.hover();
    await expect(toast).toHaveAttribute('data-paused', 'true');
    // Well past the 700ms duration: it must still be on screen.
    await page.waitForTimeout(1_200);
    await expect(page.locator('.toast')).toHaveCount(1);
  });

  test('duration 0 keeps a toast until dismissed', async ({ page }) => {
    await page.evaluate(() => window.__toast.showToast('Sticky', { type: 'error', duration: 0 }));
    await page.waitForTimeout(1_200);
    await expect(page.locator('.toast')).toHaveCount(1);
  });

  test('update() replaces the message in place', async ({ page }) => {
    const same = await page.evaluate(() => {
      const handle = window.__toast.showToast('Working…', { type: 'info', duration: 0 });
      const first = handle.element;
      handle.update('Done');
      const toasts = document.querySelectorAll('.toast');
      return {
        count: toasts.length,
        sameNode: toasts[0] === first,
        text: toasts[0]?.textContent ?? '',
      };
    });
    expect(same.count).toBe(1);
    expect(same.sameNode).toBe(true);
    expect(same.text).toContain('Done');
  });

  test('detail renders as a secondary line', async ({ page }) => {
    await page.evaluate(() =>
      window.__toast.showToast('Analysis failed', {
        type: 'error',
        detail: 'HTTP 500 from /api/audio',
      }),
    );
    await expect(page.locator('.toast .toast__detail')).toHaveText('HTTP 500 from /api/audio');
  });

  test('clearToasts empties the container', async ({ page }) => {
    await page.evaluate(() => {
      window.__toast.showToast('a', 'info');
      window.__toast.showToast('b', 'info');
      window.__toast.clearToasts();
    });
    await expect(page.locator('.toast')).toHaveCount(0);
  });

  test('long server messages stay inside a bounded width', async ({ page }) => {
    const width = await page.evaluate(() => {
      window.__toast.showToast('x'.repeat(600), { type: 'error', duration: 0 });
      const el = document.querySelector('.toast') as HTMLElement;
      return el.getBoundingClientRect().width;
    });
    // CSS caps the toast at min(420px, 100vw - 48px).
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(421);
  });

  test('toasts auto-dismiss after their duration', async ({ page }) => {
    await page.evaluate(() =>
      window.__toast.showToast('Brief', { type: 'success', duration: 400 }),
    );
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 3_000 });
  });
});

