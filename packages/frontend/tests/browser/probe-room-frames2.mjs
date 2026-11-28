// For each bookmark, report whether each frame's center is on-screen (ndc).
import { chromium } from 'playwright';
import { launchChromium } from './browser-launch.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5173/room', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 });
await sleep(6000);

const frames = [
  ['frame-1', [-2.47, 1.6, -0.6]],
  ['frame-2', [2.47, 1.6, -0.9]],
  ['frame-3', [2.47, 1.55, 1.5]],
];

for (const bm of ['Entry', 'Seated', 'Her vignette', 'Player', 'Wide']) {
  await page.getByRole('button', { name: bm, exact: true }).click();
  await sleep(2000);
  const res = await page.evaluate((fl) => {
    const R = window.__room;
    const T = window.__THREE;
    return fl.map(([n, p]) => {
      const v = new T.Vector3(...p).project(R.camera);
      const behind = v.z > 1;
      return `${n}: ndc(${(+v.x).toFixed(2)},${(+v.y).toFixed(2)})${behind ? ' BEHIND' : ''}`;
    });
  }, frames);
  console.log(bm.padEnd(14), res.join('  '));
}
await browser.close();
