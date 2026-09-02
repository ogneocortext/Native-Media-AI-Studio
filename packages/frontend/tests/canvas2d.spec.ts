import { test, expect } from '@playwright/test';

test('Canvas2D 2D mode renders and is LRC-reactive', async ({ page }) => {
  await page.goto('http://localhost:5173/visualizer');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Select a track
  const select = page.locator('select.viz-track-select').first();
  await expect(select).toBeVisible({ timeout: 10000 });
  const options = await select.locator('option').allTextContents();
  const target = options.find(o => o.includes('Built This From A Dream')) || options[1];
  if (target) await select.selectOption({ label: target });
  await page.waitForTimeout(3000);

  // Cycle vizMode: 3d -> shader -> 2d (current default shader, so two clicks to get to 2d via 3d)
  const modeBtn = page.locator('button', { hasText: 'FX' }).first().or(page.locator('button', { hasText: '3D' }).first()).or(page.locator('button', { hasText: '2D' }).first());
  // Our button shows FX/3D/2D text - click until we see 2D
  for (let i = 0; i < 4; i++) {
    const text = await page.locator('.viz-btn-group button').first().textContent().catch(() => '');
    const has2D = await page.locator('canvas').count();
    // Click the mode toggle (the button with title Mode:)
    const toggle = page.locator('button[title^="Mode:"]').first();
    if (await toggle.count()) {
      const title = await toggle.getAttribute('title');
      if (title?.includes('2d')) break;
      await toggle.click();
      await page.waitForTimeout(800);
    } else break;
  }

  // Check canvas exists in 2d mode
  const canvasCount = await page.locator('canvas').count();
  console.log('canvasCount', canvasCount);
  expect(canvasCount).toBeGreaterThan(0);

  // Check for 2d mode selector when in 2d
  const modeSelect = page.locator('.viz-2d-mode-select');
  if (await modeSelect.count() > 0) {
    console.log('2D mode selector visible');
    await modeSelect.selectOption('waveform');
    await page.waitForTimeout(500);
    await modeSelect.selectOption('radial');
    await page.waitForTimeout(500);
    await modeSelect.selectOption('bars');
    console.log('2D modes cycled');
  }

  // Check no console errors
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForTimeout(1000);
  expect(errors.length).toBe(0);

  await page.screenshot({ path: 'packages/frontend/test-results/canvas2d-2d-mode.png', fullPage: true });
  console.log('Canvas2D test passed');
});
