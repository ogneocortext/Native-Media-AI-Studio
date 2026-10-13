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

  await page.goto(`${FRONTEND_URL}/visualizer`, { waitUntil: 'domcontentloaded' });

  // Wait for track options to load (with longer timeout)
  console.log('Waiting for tracks to load...');
  const startTime = Date.now();
  let options = [];
  while (Date.now() - startTime < 30000) {
    options = await page.$$('select.viz-track-select option:not([disabled])');
    if (options.length > 0) {
      console.log(`Found ${options.length} track options`);
      break;
    }
    await page.waitForTimeout(500);
  }

  console.log('Final track options:', options.length);

  // Check console errors
  const errors = await page.evaluate(() => {
    return window.__consoleErrors || [];
  }).catch(() => []);

  if (options.length > 0) {
    const firstOption = options[0];
    const label = await firstOption.textContent();
    console.log('First track:', label?.trim());

    const select = await page.$('select.viz-track-select');
    await select.selectOption({ index: 1 });
    await page.waitForTimeout(3000);

    // Check audio element
    const audioInfo = await page.$eval('audio.viz-audio', el => ({
      src: el.src,
      paused: el.paused,
      currentTime: el.currentTime,
      duration: el.duration,
      readyState: el.readyState
    }));
    console.log('Audio info:', audioInfo);

    // Try to play
    await page.evaluate(() => {
      const audio = document.querySelector('audio.viz-audio');
      if (audio) audio.play();
    });
    await page.waitForTimeout(2000);

    const audioAfterPlay = await page.$eval('audio.viz-audio', el => ({
      paused: el.paused,
      currentTime: el.currentTime,
      networkState: el.networkState
    }));
    console.log('Audio after play:', audioAfterPlay);

    // Check spectrum bars
    const spectrumData = await page.evaluate(() => {
      const bassBar = document.querySelector('.viz-spectrum .SpectrumBar:first-child span');
      const midBar = document.querySelector('.viz-spectrum .SpectrumBar:nth-child(2) span');
      const trebleBar = document.querySelector('.viz-spectrum .SpectrumBar:last-child span');
      return {
        bass: bassBar ? bassBar.textContent : 'N/A',
        mid: midBar ? midBar.textContent : 'N/A',
        treble: trebleBar ? trebleBar.textContent : 'N/A'
      };
    });
    console.log('Spectrum bars:', spectrumData);

    // Check canvas
    const canvas = await page.$('canvas');
    if (canvas) {
      const screenshot = await canvas.screenshot({ type: 'png' });
      const outDir = path.join(__dirname, 'out');
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, 'debug_canvas.png');
      fs.writeFileSync(outPath, screenshot);
      console.log('Canvas screenshot saved');
    }
  } else {
    console.log('No tracks available, checking API directly');
    try {
      const apiResponse = await page.evaluate(async () => {
        const res = await fetch('/api/audio/list');
        return { status: res.status, ok: res.ok };
      });
      console.log('API response:', apiResponse);
    } catch (e) {
      console.log('API check failed:', e.message);
    }
  }
} finally {
  await browser.close();
}
