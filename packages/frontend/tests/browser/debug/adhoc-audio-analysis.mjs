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

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const errors = [];
  page.on('console', msg => {
    if (['error','warning'].includes(msg.type())) errors.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));

  await page.goto(`${BASE_URL}/audio-analysis`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, 'audio-analysis-full.png'), fullPage: true });
  await page.screenshot({ path: path.join(outDir, 'audio-analysis-viewport.png') });

  const report = {
    url: page.url(),
    title: await page.title(),
    consoleErrors: errors,
    bodyLength: await page.evaluate(() => document.body.innerHTML.length),
    bodySnippet: await page.evaluate(() => document.body.innerHTML.slice(0, 500)),
  };

  fs.writeFileSync(path.join(outDir, 'audio-analysis-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
