import { chromium } from 'playwright';
import { launchChromium } from './browser-launch.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const API = 'http://127.0.0.1:8004/api/room';
const MARK = 'SSE-VERIFY-ZQX-9931';

const st = await (await fetch(`${API}/state`)).json();
const op = await fetch(`${API}/op`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    op: 'move', objectId: 'mug', baseVersion: st.version, actor: 'nate',
    ts: Date.now() / 1000, value: [-1.42, 0.78, -1.28],
    description: `Nate tapped the mug (${MARK})`,
  }),
});
console.log('op:', op.status, (await op.json()).version);

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:5173/room', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 60000 });
await sleep(5000);
await page.locator('button', { hasText: 'Diary' }).last().dispatchEvent('click');
await sleep(800);

// now submit a SECOND op while the page is open — must appear via SSE
const st2 = await (await fetch(`${API}/state`)).json();
await fetch(`${API}/op`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    op: 'move', objectId: 'headphones', baseVersion: st2.version, actor: 'maya',
    ts: Date.now() / 1000, value: [0.4, 0.9, 0.15], sessionId: 'verify-live',
    description: `Maya set the headphones down (${MARK})`,
  }),
});
await sleep(2500);
const text = await page.locator('body').innerText();
console.log('live SSE op visible in diary:', text.includes(MARK));
await browser.close();
