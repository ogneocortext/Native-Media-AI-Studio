import { test, expect } from '@playwright/test';
import { navigateWithWait, cleanupRoutes, setupConsoleErrorCapture, expectNoConsoleErrors, mockApiSettings } from './helpers';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('settings page loads and shows header', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiSettings(page);
    await navigateWithWait(page, '/settings');
    await expect(page.locator('main h1').first()).toContainText('Settings');
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('settings form fields are present', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockApiSettings(page);
    await navigateWithWait(page, '/settings');
    // The form renders only after GET /api/integrations/config/settings resolves,
    // so use an auto-retrying assertion instead of an immediate count().
    const integrationCards = page.locator('main h3', { hasText: /ComfyUI|Ollama/i });
    await expect(integrationCards.first()).toBeVisible();
    expect(await integrationCards.count()).toBeGreaterThanOrEqual(2);
    expectNoConsoleErrors(errors, ['502', 'Bad Gateway', 'ECONNREFUSED']);
  });

  test('theme toggle is accessible', async ({ page }) => {
    await mockApiSettings(page);
    await navigateWithWait(page, '/settings');
    // This previously asserted `toBeGreaterThanOrEqual(0)`, which is true for
    // every array and so could never fail — it passed whether or not the feature
    // existed. It is now a real assertion: a theme control must be present, must
    // be reachable by an accessible name, and must be operable by keyboard.
    const themeBtn = page
      .locator(
        'button[aria-label*="theme" i], button[title*="theme" i], ' +
          'button:has-text("Theme"), button:has-text("Dark"), button:has-text("Light")',
      )
      .first();
    await expect(themeBtn).toBeVisible();

    // Keyboard reachable: a control that only responds to a pointer is not
    // "accessible" in any useful sense.
    await themeBtn.focus();
    await expect(themeBtn).toBeFocused();
  });

  test('every form control on the settings page has an accessible name', async ({ page }) => {
    await mockApiSettings(page);
    await navigateWithWait(page, '/settings');
    const integrationCards = page.locator('main h3', { hasText: /ComfyUI|Ollama/i });
    await expect(integrationCards.first()).toBeVisible();

    // Unlabelled inputs are invisible to screen readers and are the most common
    // real a11y defect on a settings page full of inputs.
    // NOTE: no TS generics here — `page.evaluate` bodies are transpiled as plain
    // JS, so `querySelectorAll<HTMLElement>(...)` is a syntax error at runtime.
    const unlabelled = await page.evaluate(() => {
      const controls = Array.from(
        document.querySelectorAll(
          'main input:not([type="hidden"]), main select, main textarea',
        ),
      );
      return controls
        .filter((el) => {
          if (el.getAttribute('aria-label')?.trim()) return false;
          if (el.getAttribute('aria-labelledby')?.trim()) return false;
          const id = el.getAttribute('id');
          if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) return false;
          // A wrapping <label> also names the control.
          if (el.closest('label')) return false;
          return true;
        })
        .map(
          (el) =>
            `${el.tagName.toLowerCase()}#${el.getAttribute('id') || '(no id)'}` +
            `[type=${el.getAttribute('type') ?? '-'}]`,
        );
    });
    expect(unlabelled, `unlabelled settings controls: ${unlabelled.join(', ')}`).toEqual([]);
  });
});
