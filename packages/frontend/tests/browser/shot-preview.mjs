import { chromium } from 'playwright';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

console.log('Navigating to Remotion Studio...');
await page.goto('http://localhost:8080', { waitUntil: 'networkidle' });
await sleep(3000);

// Click on the SignalBreakingThroughNoise composition to load it
const compItem = page.locator('text=SignalBreakingThroughNoise').first();
if (await compItem.count()) {
  await compItem.click();
  await sleep(2000);
}

// Take screenshot of just the video preview area
const preview = page.locator('.preview-player, video, canvas').first();
if (await preview.count()) {
  await preview.screenshot({ path: 'packages/frontend/tests/browser/out/remotion-preview.png' });
  console.log('Preview screenshot saved');
} else {
  // Fallback to full page
  await page.screenshot({ path: 'packages/frontend/tests/browser/out/remotion-preview.png', fullPage: false });
  console.log('Full page screenshot saved');
}

await browser.close();
