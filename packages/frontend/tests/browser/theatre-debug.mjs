import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTS_PATH = path.resolve(__dirname, '..', '..', '..', 'config', 'ports.json');
let ports = {};
try {
  if (fs.existsSync(PORTS_PATH)) {
    ports = JSON.parse(fs.readFileSync(PORTS_PATH, 'utf-8'));
  }
} catch { /* ignore */ }
const BASE_URL = process.env.VITE_URL || ports.frontend_url || `http://127.0.0.1:${ports.frontend_port || 5173}`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'warning') console.log(`  [WARN] ${msg.text()}`);
  });
  page.on('pageerror', err => pageErrors.push(err.message));

  console.log('\n=== Theatre.js Studio Debug ===\n');

  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await sleep(2000);

  // Go to Visualizer
  const vizLink = page.locator('a, button', { hasText: /visualizer/i }).first();
  if (await vizLink.count()) {
    await vizLink.click();
    await sleep(2000);
  } else {
    await page.goto(`${BASE_URL}/visualizer`, { waitUntil: 'networkidle' });
    await sleep(2000);
  }

  // Select track
  const select = page.locator('select.viz-track-select');
  await select.waitFor({ timeout: 10000 });
  await select.selectOption({ label: 'NeoCortext - The Signal Breaking Through the Noise' });
  await sleep(3000);

  // Find and click the Theatre studio button
  const studioBtn = page.locator('button[title*="Theatre"]');
  console.log(`Studio button count: ${await studioBtn.count()}`);
  if (await studioBtn.count()) {
    await studioBtn.click();
    await sleep(2000);
  }

  // Check what's in the DOM
  const panelExists = await page.locator('.theatre-studio-panel').count();
  const overlayExists = await page.locator('.theatre-studio-overlay').count();
  console.log(`Panel elements: ${panelExists}`);
  console.log(`Overlay elements: ${overlayExists}`);

  // Check if showTheatreStudio state is set
  const stateCheck = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    const theatreBtn = Array.from(buttons).find(b => b.title?.includes('Theatre'));
    return {
      theatreBtnExists: !!theatreBtn,
      theatreBtnClass: theatreBtn?.className,
      theatreBtnActive: theatreBtn?.classList.contains('active'),
    };
  });
  console.log(`Theatre button state: ${JSON.stringify(stateCheck)}`);

  // Take screenshot
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, 'theatre-debug.png'), fullPage: false });

  // Try opening with React DevTools check
  const reactState = await page.evaluate(() => {
    // Look for React fiber root
    const root = document.getElementById('root');
    if (!root) return { hasRoot: false };
    const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    return { hasRoot: true, fiberKey: !!fiberKey };
  });
  console.log(`React state: ${JSON.stringify(reactState)}`);

  console.log(`\nConsole errors: ${consoleErrors.length}`);
  consoleErrors.forEach(e => console.log(`  ! ${e}`));
  console.log(`Page errors: ${pageErrors.length}`);
  pageErrors.forEach(e => console.log(`  ! ${e}`));
} finally {
  await browser.close();
}
console.log('\nDebug complete.');
