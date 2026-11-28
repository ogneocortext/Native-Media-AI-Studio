import { chromium } from 'playwright';
import { launchChromium } from './browser-launch.mjs';
import { mkdirSync } from 'node:fs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const OUT = 'tests/browser/out';
mkdirSync(OUT, { recursive: true });

const BOOKMARKS = ['Entry', 'Seated', 'Her vignette', 'Player', 'Wide'];

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const errors = [];
page.on('console', msg => {
  if (msg.type() === 'error') errors.push({ source: 'console', text: msg.text() });
});
page.on('pageerror', err => errors.push({ source: 'pageerror', text: err.message }));
page.on('requestfailed', req => {
  if (req.url().includes('/api/room') || req.url().includes('/room/textures')) {
    errors.push({ source: 'requestfailed', url: req.url(), failure: req.failure()?.errorText });
  }
});

console.log('Navigating to /room...');
await page.goto('http://127.0.0.1:5173/room', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('canvas', { timeout: 30000 });
await sleep(6000); // textures + environment + first frames

for (const name of BOOKMARKS) {
  await page.getByRole('button', { name, exact: true }).click();
  await sleep(1800); // 0.9s camera ease + a few rendered frames
  const safe = name.toLowerCase().replace(/\s+/g, '-');
  const path = `${OUT}/room-${safe}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`saved ${path}`);
}

// Empty-media-store placeholder proof: frames/screen render their
// empty states whenever storage/room-media has no files (it does not).
console.log('Errors:', JSON.stringify(errors, null, 2));
await browser.close();
