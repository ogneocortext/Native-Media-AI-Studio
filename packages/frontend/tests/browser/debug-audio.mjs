import { pathToFileURL } from 'url';
import path from 'path';

const PLAYWRIGHT_DIR = 'D:\\Backup of Important Data for Windows 11 Upgrade\\Native Media AI Studio\\packages\\frontend\\node_modules\\playwright';
const playwrightMod = await import(pathToFileURL(path.join(PLAYWRIGHT_DIR, 'index.mjs')).href);
const { chromium } = playwrightMod;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

await page.goto('http://localhost:5173/visualizer', { waitUntil: 'domcontentloaded' });

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

await browser.close();
