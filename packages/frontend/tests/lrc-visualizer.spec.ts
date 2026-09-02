import { test, expect } from '@playwright/test';

test.describe('LRC-Enhanced Visualizer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/visualizer');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('should load LRC file and apply section-aware visuals', async ({ page }) => {
    test.setTimeout(60000);
    page.on('console', msg => {
      if (msg.text().includes('lyric') || msg.text().includes('LRC') || msg.text().includes('Error')) {
        console.log('PAGE:', msg.text());
      }
    });
    const select = page.locator('select.viz-track-select').first();
    if (await select.count() > 0) {
      const options = await select.locator('option').allTextContents();
      console.log('Options:', options.slice(0,3));
      const target = options.find(o => o.includes('Built This From A Dream')) || options[1] || options[0];
      if (target) await select.selectOption({ label: target });
      console.log('Waiting for track analysis + lyrics to load...');
      await page.waitForTimeout(6000);
    }

    // Check if lyrics loaded
    const hasLyrics = await page.evaluate(() => {
      const overlay = document.querySelector('.viz-lyrics-enhanced, .viz-lyrics');
      const activeLine = document.querySelector('.kinetic-active-line, .viz-lyrics-current');
      return { overlay: !!overlay, activeLine: !!activeLine, text: activeLine?.textContent?.trim() };
    });
    console.log('Lyrics state:', JSON.stringify(hasLyrics));

    // Take screenshots at key moments
    const timestamps = [5, 15, 33, 45, 60, 90, 120];
    for (const t of timestamps) {
      await page.evaluate((time) => {
        const audio = document.querySelector('audio');
        if (audio) audio.currentTime = time;
      }, t);
      await page.waitForTimeout(600);

      const data = await page.evaluate(() => {
        const overlay = document.querySelector('.viz-lyrics-enhanced, .viz-lyrics');
        const activeLine = document.querySelector('.kinetic-active-line, .viz-lyrics-current');
        const section = overlay?.getAttribute('data-section') ||
          document.querySelector('.viz-lyrics-section')?.textContent?.trim();
        return {
          section,
          lyric: activeLine?.textContent?.trim() || '(none)',
          hasLrcSync: !!overlay?.getAttribute('data-section'),
        };
      });

      await page.screenshot({ path: `packages/frontend/test-results/lrc-enhanced-t${t}.png` });
      console.log(`t=${t}s [${data.section}]: "${data.lyric}" (LRC: ${data.hasLrcSync})`);
    }
  });

  test('LRC section markers drive visual preset changes', async ({ page }) => {
    const select = page.locator('select.viz-track-select').first();
    if (await select.count() > 0) {
      const options = await select.locator('option').allTextContents();
      const target = options.find(o => o.includes('Built This From A Dream')) || options[1] || options[0];
      if (target) await select.selectOption({ label: target });
      await page.waitForTimeout(3000);
    }

    // Check that section changes are detected
    const sections = new Set<string>();
    const timestamps = [5, 33, 60, 90, 120, 150, 180, 210];

    for (const t of timestamps) {
      await page.evaluate((time) => {
        const audio = document.querySelector('audio');
        if (audio) audio.currentTime = time;
      }, t);
      await page.waitForTimeout(400);

      const section = await page.evaluate(() => {
        const overlay = document.querySelector('.viz-lyrics-enhanced, .viz-lyrics');
        return overlay?.getAttribute('data-section') ||
          document.querySelector('.viz-lyrics-section')?.textContent?.trim() || 'unknown';
      });
      sections.add(section);
    }

    console.log('Sections detected:', Array.from(sections).join(', '));
    expect(sections.size).toBeGreaterThan(1);
  });
});
