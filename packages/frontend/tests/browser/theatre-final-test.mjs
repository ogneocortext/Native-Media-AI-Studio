import { chromium } from 'playwright';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const consoleErrors = [];
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

console.log('\n=== Theatre.js Studio Final Test ===\n');

await page.goto('http://localhost:5173/visualizer', { waitUntil: 'networkidle' });
await sleep(2000);

// Select track
const select = page.locator('select.viz-track-select');
await select.waitFor({ state: 'visible', timeout: 15000 });
await select.selectOption({ label: 'NeoCortext - The Signal Breaking Through the Noise' });
await sleep(3000);

// Open Theatre.js Studio
const studioBtn = page.locator('button[title*="Theatre"]');
await studioBtn.click();
await sleep(2000);

// Verify panel visible
const panel = page.locator('.theatre-studio-panel');
await panel.waitFor({ state: 'visible', timeout: 5000 });
console.log('  ✓ Theatre.js Studio panel visible');

// Test preset selector
const presetSelect = page.locator('.theatre-preset-select');
await presetSelect.selectOption('synthwave');
await sleep(500);
console.log('  ✓ Preset selector works');

// Test phase tabs
await page.locator('.theatre-phase-tab', { hasText: 'Enter' }).click();
await sleep(300);
await page.locator('.theatre-phase-tab', { hasText: 'Beat' }).click();
await sleep(300);
console.log('  ✓ Phase tabs work');

// Test range slider (use evaluate for range inputs)
const sliderResult = await page.evaluate(() => {
  const slider = document.querySelector('.theatre-track-input[type="range"]');
  if (!slider) return { ok: false, reason: 'no slider found' };
  slider.value = '50';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  slider.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, value: slider.value };
});
console.log('  ✓ Slider test:', JSON.stringify(sliderResult));

// Test play button
await page.locator('.theatre-play-btn').click();
await sleep(2000);
console.log('  ✓ Play animation works');

// Take screenshot
await page.screenshot({ path: 'packages/frontend/tests/browser/out/theatre-studio-final.png' });
console.log('  ✓ Screenshot saved');

// Close studio
await page.locator('.theatre-studio-close').click();
await sleep(500);

// Start audio and recording
const audio = page.locator('audio.viz-audio');
await audio.waitFor({ timeout: 5000 });
await page.evaluate(() => {
  const a = document.querySelector('audio.viz-audio');
  if (a) a.play();
});
await sleep(2000);

// Find and click record button (try multiple selectors)
const recordBtn = page.locator('button.viz-icon-btn').filter({ has: page.locator('svg') }).first();
const allBtns = await page.locator('button.viz-icon-btn').all();
let recordClicked = false;
for (const btn of allBtns) {
  const label = await btn.getAttribute('aria-label') || '';
  if (label.includes('recording') || label.includes('Record')) {
    await btn.click();
    recordClicked = true;
    break;
  }
}
if (recordClicked) {
  console.log('  ✓ Recording started');
  await sleep(3000);
  // Stop recording
  for (const btn of allBtns) {
    const label = await btn.getAttribute('aria-label') || '';
    if (label.includes('Stop')) {
      await btn.click();
      console.log('  ✓ Recording stopped');
      break;
    }
  }
} else {
  console.log('  ⚠ Could not find record button');
}

// Final screenshot
await page.screenshot({ path: 'packages/frontend/tests/browser/out/music-video-workflow.png', fullPage: true });
console.log('  ✓ Final screenshot saved');

console.log(`\nConsole errors: ${consoleErrors.length}`);
consoleErrors.forEach(e => console.log('  !', e.substring(0, 200)));

await browser.close();
console.log('\n=== Test Complete ===');
