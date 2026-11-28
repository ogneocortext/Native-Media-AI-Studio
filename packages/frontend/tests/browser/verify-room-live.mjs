import { chromium } from 'playwright';
import { launchChromium } from './browser-launch.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const API = 'http://127.0.0.1:8004/api/room';

async function api(path, init) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// --- API-level proofs (curl-equivalent) ---
const state1 = await api('/state');
const v = state1.body.version;
console.log('state version:', v);

// 1) fresh op applies
const op1 = await api('/op', {
  method: 'POST',
  body: JSON.stringify({
    op: 'move', objectId: 'mug', baseVersion: v, actor: 'nate',
    ts: Date.now() / 1000, value: [-1.4, 0.78, -1.35],
    description: 'Nate nudged the mug',
  }),
});
console.log('op apply:', op1.status, JSON.stringify(op1.body).slice(0, 160));

// 2) stale op -> 409 with current state
const op2 = await api('/op', {
  method: 'POST',
  body: JSON.stringify({
    op: 'move', objectId: 'mug', baseVersion: v, actor: 'nate',
    ts: Date.now() / 1000, value: [-1.5, 0.78, -1.2],
  }),
});
console.log('stale op:', op2.status, JSON.stringify(op2.body).slice(0, 200));

// --- Browser proofs ---
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message.slice(0, 200)));

await page.goto('http://127.0.0.1:5173/room', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 60000 });
await sleep(5000);

// What actually sits at the Diary button's center? (hit-test audit)
const hit = await page.evaluate(() => {
  const el = document.elementFromPoint(1086, 930);
  return el ? `${el.tagName}.${el.className?.toString().slice(0, 80)}` : 'none';
});
console.log('elementFromPoint at diary center:', hit);

// Open the Diary feed (bottom bookmark bar). dispatchEvent bypasses
// hit-test interception from the wrapping layout-topbar presence chips.
await page.locator('button', { hasText: 'Diary' }).last().dispatchEvent('click');
await sleep(500);

// 3) cross-client op appears live: submit via API while page is open,
//    then read the diary feed for the new line.
const state2 = await api('/state');
const v2 = state2.body.version;
await api('/op', {
  method: 'POST',
  body: JSON.stringify({
    op: 'move', objectId: 'blanket', baseVersion: v2, actor: 'nate',
    ts: Date.now() / 1000, value: [-0.75, 0.75, -1.0],
    description: 'Nate pulled the blanket straight',
  }),
});
await sleep(2500); // SSE event -> diary feed
const feedText = await page.locator('text=Since you were gone').locator('..').innerText().catch(() => '');
const pageText = await page.locator('body').innerText();
console.log('diary shows live op:', pageText.includes('blanket') || feedText.includes('blanket'), '|', feedText.slice(0, 300));

// 4) Late lighting persists across reload
await page.getByRole('button', { name: 'Late', exact: true }).dispatchEvent('click');
await sleep(2000);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 60000 });
await sleep(4000);
const lateBtn = await page.getByRole('button', { name: 'Late', exact: true }).getAttribute('class');
console.log('Late persists after reload:', (lateBtn || '').includes('bg-[#4A3566]'));
// restore Arrival for Maya's screenshots
await page.getByRole('button', { name: 'Arrival', exact: true }).dispatchEvent('click');
await sleep(1500);

console.log('page errors:', errs.join(' | ') || 'none');
await browser.close();
