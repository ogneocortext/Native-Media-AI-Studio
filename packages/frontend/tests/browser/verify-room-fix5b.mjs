// Item 5 re-verify: orbit drags starting on NON-draggable geometry
// (wall/ceiling) must keep the camera inside; an object drag must keep
// the object inside the room footprint.
import { chromium } from 'playwright';
import { launchChromium } from './browser-launch.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5173/room', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 });
await sleep(6000);
await page.getByRole('button', { name: 'Entry', exact: true }).click();
await sleep(2200);

const camPos = () => page.evaluate(() => {
  const R = window.__room;
  return R.camera.position.toArray().map(v => +v.toFixed(2));
});
const IN = (p) => Math.abs(p[0]) <= 2.35 && p[1] >= 0.35 && p[1] <= 2.55 && Math.abs(p[2]) <= 1.85;

async function drag(sx, sy, dx, dy) {
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(sx + (dx * i) / 10, sy + (dy * i) / 10);
    await sleep(40);
  }
  await page.mouse.up();
  await sleep(400);
}

console.log('cam start', JSON.stringify(await camPos()));
// upper strip = wall/bookcase behind controls - safe orbit surface
await drag(800, 160, 2500, 0);
console.log('orbit right  ', JSON.stringify(await camPos()), IN(await camPos()));
await drag(800, 160, -2500, 0);
console.log('orbit left   ', JSON.stringify(await camPos()), IN(await camPos()));
await drag(800, 160, 0, 2500);
console.log('orbit down   ', JSON.stringify(await camPos()), IN(await camPos()));
await drag(800, 160, 0, -2500);
console.log('orbit up     ', JSON.stringify(await camPos()), IN(await camPos()));
await page.mouse.move(800, 160);
for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, -240); await sleep(40); }
await sleep(400);
console.log('zoom out     ', JSON.stringify(await camPos()), IN(await camPos()));

// object drag: center-screen object, fling hard, check bounds
await drag(800, 520, 2000, 1500);
await sleep(800); // let endDrag submit
const st = await page.evaluate(async () => (await (await fetch('/api/room/state')).json()));
const moved = Object.entries(st.objects)
  .filter(([, o]) => Math.abs(o.position[0]) > 2.3 || Math.abs(o.position[2]) > 1.9)
  .map(([k, o]) => `${k}=[${o.position.map(v=>+v.toFixed(2))}]`);
console.log('objects out of bounds:', moved.length ? moved.join(' ') : 'none');
console.log('version', st.version);
await browser.close();
