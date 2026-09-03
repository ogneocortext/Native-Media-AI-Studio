import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5173';
const TRACK_NAME = 'NeoCortext - Built This From A Dream';

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();

const logs = [];
page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => logs.push(`[ERROR] ${err.message}`));

console.log('=== LRC Visualizer Test ===\n');

// 1. Navigate to frontend
console.log('1. Opening frontend...');
await page.goto(BASE_URL);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2000);

// 2. Open visualizer
console.log('2. Opening visualizer...');
const vizButton = page.getByRole('button', { name: /visualizer/i }).or(page.getByText(/visualizer/i)).first();
if (await vizButton.count() > 0) {
  await vizButton.click();
  await page.waitForTimeout(1000);
} else {
  await page.goto(`${BASE_URL}/visualizer`);
  await page.waitForTimeout(1000);
}

// 3. Select track with LRC
console.log('3. Selecting track with LRC lyrics...');
const trackSelector = page.getByText(TRACK_NAME).or(page.locator('[data-track-name*="Built This"]')).first();
if (await trackSelector.count() > 0) {
  await trackSelector.click();
  await page.waitForTimeout(2000);
} else {
  // Try library search
  const searchInput = page.getByPlaceholder(/search|find/i).or(page.locator('input[type="text"]')).first();
  if (await searchInput.count() > 0) {
    await searchInput.fill('Built This From A Dream');
    await page.waitForTimeout(500);
    await page.getByText('Built This').first().click();
    await page.waitForTimeout(2000);
  }
}

// 4. Play the track
console.log('4. Starting playback...');
const playButton = page.getByRole('button', { name: /play/i }).or(page.locator('[aria-label*="play" i]')).or(page.locator('.play-btn')).first();
if (await playButton.count() > 0) {
  await playButton.click();
  await page.waitForTimeout(1000);
}

// 5. Capture screenshots at lyric timestamps
const timestamps = [5, 15, 33, 45, 60, 90, 120, 150, 180];
console.log('5. Capturing screenshots at lyric moments...\n');

for (const t of timestamps) {
  // Seek to timestamp
  await page.evaluate((time) => {
    const audio = document.querySelector('audio');
    if (audio) audio.currentTime = time;
  }, t);
  await page.waitForTimeout(800);

  // Screenshot
  const filename = `lrc-test-${t}s.png`;
  await page.screenshot({ path: `output/screenshots/${filename}` });

  // Get current lyric text
  const lyricText = await page.evaluate(() => {
    const activeLine = document.querySelector('.kinetic-active-line');
    return activeLine?.textContent?.trim() || '(no active line)';
  });

  console.log(`  t=${t}s: "${lyricText}"`);
}

// 6. Capture final state
console.log('\n6. Capturing final state...');
await page.screenshot({ path: 'output/screenshots/lrc-test-final.png' });

// 7. Check console for LRC logs
const lrcLogs = logs.filter(l => l.toLowerCase().includes('lrc') || l.toLowerCase().includes('lyric'));
console.log('\n7. LRC-related logs:');
if (lrcLogs.length > 0) {
  lrcLogs.forEach(l => console.log(`  ${l}`));
} else {
  console.log('  (no LRC-specific logs found)');
}

// Summary
const allLyrics = await page.evaluate(() => {
  const lines = document.querySelectorAll('.kinetic-active-line, [data-lyric-line]');
  return Array.from(lines).map(l => l.textContent?.trim()).filter(Boolean);
});

console.log(`\n=== Test Complete ===`);
console.log(`Total lyric elements found: ${allLyrics.length}`);
console.log(`Screenshots saved to: output/screenshots/`);

await browser.close();
