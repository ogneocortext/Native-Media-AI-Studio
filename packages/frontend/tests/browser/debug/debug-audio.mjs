import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { launchChromium } from '../../browser-launch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

  await page.goto(`${FRONTEND_URL}/visualizer`, { waitUntil: 'domcontentloaded' });

  // Wait for track options to load
  console.log('Waiting for tracks to load...');
  const startTime = Date.now();
  while (Date.now() - startTime < 30000) {
    const options = await page.$$('select.viz-track-select option:not([disabled])');
    if (options.length > 0) {
      console.log(`Found ${options.length} track options`);
      break;
    }
    await page.waitForTimeout(500);
  }

  const options = await page.$$('select.viz-track-select option:not([disabled])');
  console.log('Final track options:', options.length);

  if (options.length > 0) {
    const firstOptionText = await options[0].textContent();
    console.log('First track:', firstOptionText?.trim());

    const select = await page.$('select.viz-track-select');
    await select.selectOption({ index: 1 });
    console.log('Selected track');
    await page.waitForTimeout(3000);

    // Check audio element
    const audioCount = await page.$$eval('audio', els => els.length);
    console.log('Audio elements after selection:', audioCount);

    const audioSrc = await page.$eval('audio', el => el.src || 'no src').catch(() => 'no audio element');
    console.log('Audio src:', audioSrc);

    const playerExists = await page.$('.viz-audio-player');
    console.log('Audio player container exists:', !!playerExists);

    // Try clicking play
    const playBtn = await page.$('button[aria-label="Play"], button:has-text("Play")');
    console.log('Play button found:', !!playBtn);
    if (playBtn) {
      await playBtn.click();
      console.log('Clicked play');
      await page.waitForTimeout(2000);

      const isPlaying = await page.$eval('audio', el => !el.paused).catch(() => false);
      console.log('Audio playing:', isPlaying);
    }
  }
} finally {
  await browser.close();
}
