import { chromium } from 'playwright';
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

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('Navigating to Remotion Studio...');
  await page.goto(`${BASE_URL}/visualizer`, { waitUntil: 'networkidle' });
  await sleep(3000);

  // Take screenshot
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, 'remotion-studio.png'), fullPage: false });
  console.log('Screenshot saved');
} finally {
  await browser.close();
}
