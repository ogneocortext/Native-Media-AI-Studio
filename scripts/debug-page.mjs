import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
process.chdir(REPO_ROOT);

const PLAYWRIGHT_DIR = path.join(REPO_ROOT, 'packages', 'frontend', 'node_modules', 'playwright');
const playwrightMod = await import(pathToFileURL(path.join(PLAYWRIGHT_DIR, 'index.mjs')).href);
const { chromium } = playwrightMod;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto('http://localhost:5173/visualizer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  
  // Check initial mode
  const modeBtn = await page.$('button[title^="Mode:"]');
  if (modeBtn) {
    const title = await modeBtn.getAttribute('title');
    console.log('Initial mode:', title);
  }
  
  // Select first track
  const options = await page.$$('select.viz-track-select option:not([disabled])');
  console.log('Track options found:', options.length);
  if (options.length > 0) {
    const select = await page.$('select.viz-track-select');
    await select.selectOption({ index: 1 });
    console.log('Selected first track');
    await page.waitForTimeout(3000);
  }
  
  // Check audio
  const audio = await page.$('audio.viz-audio');
  if (audio) {
    const audioState = await page.$eval('audio.viz-audio', el => ({
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
    
    const audioStateAfter = await page.$eval('audio.viz-audio', el => ({
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
  const canvas = await page.$('canvas');
  if (canvas) {
    const buffer = await canvas.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(REPO_ROOT, 'browser-test', 'out', 'debug_canvas.png'), buffer);
    console.log('Canvas screenshot saved');
  }
  
  await browser.close();
})();
