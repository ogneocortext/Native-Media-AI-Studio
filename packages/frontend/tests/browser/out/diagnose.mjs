import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAYWRIGHT_DIR = path.join(process.cwd(), 'packages', 'frontend', 'node_modules', 'playwright');
const playwrightMod = await import(pathToFileURL(path.join(PLAYWRIGHT_DIR, 'index.mjs')).href);
const { chromium } = playwrightMod;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await page.addInitScript(() => {
    const origSetAttribute = HTMLAudioElement.prototype.setAttribute;
    HTMLAudioElement.prototype.setAttribute = function(name, value) {
      if (name.toLowerCase() === 'crossorigin') return;
      return origSetAttribute.call(this, name, value);
    };
  });

  await page.goto('http://localhost:5173/visualizer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Select first track
  const select = await page.$('select.viz-track-select');
  if (select) {
    await select.selectOption({ index: 1 });
    await page.waitForTimeout(2000);
  }

  // Check audio element state
  const audioState = await page.evaluate(() => {
    const audio = document.querySelector('audio.viz-audio');
    if (!audio) return 'no audio element';
    return {
      src: audio.src,
      crossOrigin: audio.crossOrigin,
      paused: audio.paused,
      currentTime: audio.currentTime,
      duration: audio.duration,
      readyState: audio.readyState,
      networkState: audio.networkState,
      error: audio.error ? { code: audio.error.code, message: audio.error.message } : null
    };
  });
  console.log('Audio state:', JSON.stringify(audioState, null, 2));

  // Play audio
  await page.evaluate(() => {
    const audio = document.querySelector('audio.viz-audio');
    if (audio) audio.play();
  });
  await page.waitForTimeout(3000);

  // Check audio state after play
  const audioStateAfter = await page.evaluate(() => {
    const audio = document.querySelector('audio.viz-audio');
    if (!audio) return 'no audio element';
    return {
      paused: audio.paused,
      currentTime: audio.currentTime,
      duration: audio.duration,
      readyState: audio.readyState,
      networkState: audio.networkState,
      error: audio.error ? { code: audio.error.code, message: audio.error.message } : null
    };
  });
  console.log('Audio state after play:', JSON.stringify(audioStateAfter, null, 2));

  // Check canvas rendering
  const canvasState = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return 'no canvas';
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no 2d context';
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let nonZero = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 0 || data[i+1] !== 0 || data[i+2] !== 0) nonZero++;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      totalPixels: data.length / 4,
      nonZeroPixels: nonZero,
      percentNonZero: ((nonZero / (data.length / 4)) * 100).toFixed(2) + '%'
    };
  });
  console.log('Canvas state:', JSON.stringify(canvasState, null, 2));

  await browser.close();
})();
