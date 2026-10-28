import { chromium } from 'playwright';
import { launchChromium } from './browser-launch.mjs';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTS_PATH = path.resolve(__dirname, '..', '..', '..', '..', '..', 'config', 'ports.json');
let ports = {};
try {
  if (fs.existsSync(PORTS_PATH)) {
    ports = JSON.parse(fs.readFileSync(PORTS_PATH, 'utf-8'));
  }
} catch { /* ignore */ }
const BASE_URL = process.env.VITE_URL || ports.frontend_url || `http://127.0.0.1:${ports.frontend_port || 5173}`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await launchChromium();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('Navigating to Remotion Studio...');
  await page.goto(`${BASE_URL}/visualizer`, { waitUntil: 'networkidle' });
  await sleep(3000);

  // Click on the SignalBreakingThroughNoise composition to load it
  const compItem = page.locator('text=SignalBreakingThroughNoise').first();
  if (await compItem.count()) {
    await compItem.click();
    await sleep(2000);
  }

  // Take screenshot of just the video preview area
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const preview = page.locator('.preview-player, video, canvas').first();
  if (await preview.count()) {
    await preview.screenshot({ path: path.join(outDir, 'remotion-preview.png') });
    console.log('Preview screenshot saved');
  } else {
    // Fallback to full page
    await page.screenshot({ path: path.join(outDir, 'remotion-preview.png'), fullPage: false });
    console.log('Full page screenshot saved');
  }
} finally {
  await browser.close();
}
