import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAYWRIGHT_DIR = path.resolve(__dirname, '..', '..', '..', 'node_modules', 'playwright');
const playwrightMod = await import(pathToFileURL(path.join(PLAYWRIGHT_DIR, 'index.mjs')).href);
const { chromium } = playwrightMod;

const PORTS_PATH = path.resolve(__dirname, '..', '..', '..', '..', '..', 'config', 'ports.json');
let ports = {};
try {
  if (fs.existsSync(PORTS_PATH)) {
    ports = JSON.parse(fs.readFileSync(PORTS_PATH, 'utf-8'));
  }
} catch { /* ignore */ }
const FRONTEND_URL = process.env.VITE_URL || ports.frontend_url || `http://127.0.0.1:${ports.frontend_port || 5173}`;

const browser = await launchChromium();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Use 127.0.0.1 instead of localhost to match CORS headers
  await page.goto(`${FRONTEND_URL}/visualizer`, { waitUntil: 'domcontentloaded' });

  const origin = await page.evaluate(() => window.location.origin);
  console.log('Page origin:', origin);

  await page.waitForTimeout(4000);

  // Wait for tracks
  const options = await page.$$('select.viz-track-select option:not([disabled])');
  console.log('Tracks loaded:', options.length);

  if (options.length > 0) {
    const select = await page.$('select.viz-track-select');
    await select.selectOption({ index: 1 });
    await page.waitForTimeout(2000);

    // Play audio
    await page.evaluate(() => {
      const audio = document.querySelector('audio.viz-audio');
      if (audio) audio.play();
    });
    await page.waitForTimeout(3000);

    // Check audio state
    const audioState = await page.$eval('audio.viz-audio', el => ({
      paused: el.paused,
      readyState: el.readyState,
      networkState: el.networkState,
      currentTime: el.currentTime
    }));
    console.log('Audio state:', audioState);

    // Check spectrum bars with correct selector
    const spectrumData = await page.evaluate(() => {
      const bars = document.querySelectorAll('.viz-spectrum > div');
      const data = [];
      bars.forEach((bar) => {
        const label = bar.querySelector('div')?.textContent;
        const value = bar.querySelector('span')?.textContent;
        data.push({ label, value });
      });
      return data;
    });
    console.log('Spectrum data:', spectrumData);
  }
} finally {
  await browser.close();
}
