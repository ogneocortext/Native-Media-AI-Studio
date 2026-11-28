// Item 5 acceptance: REAL click on Late (no dispatchEvent), then hard
// orbit drags toward each wall - camera must stay inside the room.
import { chromium } from 'playwright';
import { launchChromium } from './browser-launch.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto('http://127.0.0.1:5173/room', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 });
await sleep(6000);

// --- 1. REAL click on Late ---
const lateBtn = page.getByRole('button', { name: 'Late', exact: true });
const box = await lateBtn.boundingBox();
console.log('Late button box:', JSON.stringify(box));
// what element is actually topmost at the button's center?
const hit = await page.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y);
  return el ? `${el.tagName}.${el.className}`.slice(0, 120) : 'none';
}, [box.x + box.width / 2, box.y + box.height / 2]);
console.log('elementFromPoint at Late center:', hit);
await lateBtn.click(); // real mouse click
await sleep(2500);

const state1 = await page.evaluate(async () => {
  const r = await fetch('/api/room/state');
  const s = await r.json();
  return { lighting: s.lighting?.state, version: s.version };
});
console.log('after Late click:', JSON.stringify(state1));

// diary entry check
const diary = await page.evaluate(async () => {
  const r = await fetch('/api/room/replay?actor=nate&since=0');
  const j = await r.json();
  const evs = j.events || j || [];
  return evs.slice(-3).map(e => e.description || e.type);
});
console.log('last diary lines:', JSON.stringify(diary));

await page.screenshot({ path: 'tests/browser/out/room-late-real-click.png' });

// --- 2. hard orbit drags toward each wall ---
// canvas center-ish drag: press, move far in a direction, release.
async function drag(dx, dy) {
  const cx = 800, cy = 520;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(cx + (dx * i) / 10, cy + (dy * i) / 10);
    await sleep(40);
  }
  await page.mouse.up();
  await sleep(400);
}
const camPos = () => page.evaluate(() => {
  const R = window.__room;
  return R.camera.position.toArray().map(v => +v.toFixed(2));
});

console.log('cam start', JSON.stringify(await camPos()));
await drag(3000, 0);   // hard right
console.log('after drag right', JSON.stringify(await camPos()));
await drag(-3000, 0);  // hard left
console.log('after drag left', JSON.stringify(await camPos()));
await drag(0, 3000);   // hard down (orbit toward floor/north?)
console.log('after drag down', JSON.stringify(await camPos()));
await drag(0, -3000);  // hard up
console.log('after drag up', JSON.stringify(await camPos()));

// zoom out hard via wheel
await page.mouse.move(800, 520);
for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, -240); await sleep(50); }
await sleep(400);
console.log('after zoom-out', JSON.stringify(await camPos()));

console.log('pageerrors:', JSON.stringify(errors));
await browser.close();
