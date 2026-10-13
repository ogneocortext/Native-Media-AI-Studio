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

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Intercept audio to fix CORS
  await page.route('**/api/audio/**', async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers(), 'access-control-allow-origin': '*' };
    await route.fulfill({ response, headers });
  });

  await page.goto(`${FRONTEND_URL}/visualizer`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // Wait for tracks
  const options = await page.$$('select.viz-track-select option:not([disabled])');
  console.log('Tracks loaded:', options.length);

  if (options.length > 0) {
    const select = await page.$('select.viz-track-select');
    await select.selectOption({ index: 1 });
    await page.waitForTimeout(3000);

    // Fix crossOrigin before playing
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

    // Play
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
      currentTime: el.currentTime,
      duration: el.duration,
      crossOrigin: el.crossOrigin
    }));
    console.log('Audio state:', audioState);

    // Check React state via window
    const reactState = await page.evaluate(() => {
      const root = document.querySelector('[data-reactroot]');
      return {
        isPlaying: root?.__reactInternalInstance?.return?.memoizedProps?.isPlaying,
      };
    }).catch(() => 'could not read');
    console.log('React state check:', reactState);

    // Check if audio context exists and has data
    const audioCtxInfo = await page.evaluate(() => {
      const audioCtxs = window.AudioContext ? 'AudioContext available' : 'no AudioContext';
      return {
        audioCtxs,
      };
    });
    console.log('AudioCtx info:', audioCtxInfo);

    // Take screenshot of the whole page to see what's visible
    const screenshot = await page.screenshot({ fullPage: true });
    const outDir = path.join(__dirname, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'debug_fullpage.png');
    fs.writeFileSync(outPath, screenshot);
    console.log('Full page screenshot saved');
  }
} finally {
  await browser.close();
}
