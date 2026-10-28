import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
process.chdir(REPO_ROOT);

const PLAYWRIGHT_DIR = path.join(REPO_ROOT, 'packages', 'frontend', 'node_modules', 'playwright');
const playwrightMod = await import(pathToFileURL(path.join(PLAYWRIGHT_DIR, 'index.mjs')).href);
const { chromium } = playwrightMod;

// Load central port configuration for the frontend dev server URL.
const PORTS_PATH = path.join(REPO_ROOT, 'config', 'ports.json');
let ports = {};
try {
  if (fs.existsSync(PORTS_PATH)) {
    ports = JSON.parse(fs.readFileSync(PORTS_PATH, 'utf-8'));
  }
} catch { /* ignore */ }
const FRONTEND_URL = process.env.VITE_URL || ports.frontend_url || `http://127.0.0.1:${ports.frontend_port || 5173}`;

(async () => {
  const browser = await launchChromium();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(`${FRONTEND_URL}/visualizer`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Check initial mode
    const modeBtn = page.locator('button[title^="Mode:"]');
    if (await modeBtn.count()) {
      const title = await modeBtn.getAttribute('title');
      console.log('Initial mode:', title);
    }

    // Select first track
    const options = page.locator('select.viz-track-select option:not([disabled])');
    const optionCount = await options.count();
    console.log('Track options found:', optionCount);
    if (optionCount > 0) {
      const select = page.locator('select.viz-track-select');
      await select.selectOption({ index: 1 });
      console.log('Selected first track');
      await page.waitForTimeout(3000);
    }

    // Check audio
    const audio = page.locator('audio.viz-audio');
    if (await audio.count()) {
      const audioState = await audio.evaluate(el => ({
        paused: el.paused,
        readyState: el.readyState,
        duration: el.duration,
        currentTime: el.currentTime,
        src: el.src?.slice(0, 80)
      }));
      console.log('Audio state before play:', JSON.stringify(audioState));

      // Try playing
      await page.evaluate(() => {
        const audio = document.querySelector('audio.viz-audio');
        if (audio) {
          audio.removeAttribute('crossOrigin');
          const src = audio.src;
          audio.src = '';
          audio.src = src;
        }
      });
      await page.waitForTimeout(2000);
      await page.evaluate(() => {
        const audio = document.querySelector('audio.viz-audio');
        if (audio) audio.play();
      });

      await page.waitForTimeout(5000);

      const audioStateAfter = await audio.evaluate(el => ({
        paused: el.paused,
        readyState: el.readyState,
        duration: el.duration,
        currentTime: el.currentTime,
        networkState: el.networkState,
        error: el.error ? { code: el.error.code, message: el.error.message } : null
      }));
      console.log('Audio state after play:', JSON.stringify(audioStateAfter));
    } else {
      console.log('Audio element NOT found after track selection');
    }

    // Check canvas and take screenshot
    const canvas = page.locator('canvas');
    if (await canvas.count()) {
      const buffer = await canvas.screenshot({ type: 'png' });
      const outDir = path.join(REPO_ROOT, 'packages/frontend/tests/browser', 'out');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'debug_canvas.png'), buffer);
      console.log('Canvas screenshot saved');
    }
  } finally {
    await browser.close();
  }
})();
