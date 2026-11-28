// Switch the room back to Arrival with a real click, then capture all
// five bookmark screenshots for the Round-1 report.
import { chromium } from 'playwright';
import { launchChromium } from './browser-launch.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const OUT = 'tests/browser/out';
const BOOKMARKS = ['Entry', 'Seated', 'Her vignette', 'Player', 'Wide'];

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));

await page.goto('http://127.0.0.1:5173/room', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 });
await sleep(6000);

// real click back to Arrival
await page.getByRole('button', { name: 'Arrival', exact: true }).click();
await sleep(2000);
const st = await page.evaluate(async () => (await (await fetch('/api/room/state')).json()).lighting?.state);
console.log('lighting now:', st);

for (const name of BOOKMARKS) {
  await page.getByRole('button', { name, exact: true }).click();
  await sleep(1800);
  const safe = name.toLowerCase().replace(/\s+/g, '-');
  await page.screenshot({ path: `${OUT}/room-r1-${safe}.png` });
  console.log(`saved room-r1-${safe}.png`);
}
console.log('errors:', JSON.stringify(errors));
await browser.close();
