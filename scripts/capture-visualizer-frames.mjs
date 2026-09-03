#!/usr/bin/env node
/**
 * Visualizer Frame Burst Capture
 *
 * Captures a burst of canvas frames while the visualizer plays continuously,
 * so frames have real temporal continuity (unlike seek-then-screenshot tests).
 * Output frames can be analyzed "in motion" with scripts/vision.mjs.
 *
 * Usage:
 *   node scripts/capture-visualizer-frames.mjs [options]
 *
 * Options:
 *   --url <url>        Frontend base URL (default: http://localhost:5173)
 *   --out <dir>        Output directory (default: output/frames)
 *   --count <n>        Number of frames to capture (default: 16)
 *   --interval <ms>    Milliseconds between frames (default: 250 -> ~4fps)
 *   --track <name>     Track name substring to search/select in the library
 *   --seek <sec>       Seek playback to this time before capturing (default: 5)
 *   --analyze [prompt] After capture, run scripts/vision.mjs analyze on all frames
 *   --full-page        Capture full page instead of the canvas element only
 *
 * Examples:
 *   node scripts/capture-visualizer-frames.mjs --track "Built This" --count 16
 *   node scripts/capture-visualizer-frames.mjs --interval 125 --count 24 --analyze
 *   node scripts/capture-visualizer-frames.mjs --analyze "Judge motion quality: is the animation smooth and beat-synced?"
 *
 * After capture, analyze in motion:
 *   node scripts/vision.mjs analyze output/frames/frame_*.png "Describe the motion across these consecutive frames."
 */

import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CLI Parsing ───
const args = process.argv.slice(2);
const options = {
  url: 'http://localhost:5173',
  out: 'output/frames',
  count: 16,
  interval: 250,
  track: null,
  seek: 5,
  analyze: false,
  analyzePrompt: null,
  fullPage: false,
};

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--url' && args[i + 1]) options.url = args[++i];
  else if (a === '--out' && args[i + 1]) options.out = args[++i];
  else if (a === '--count' && args[i + 1]) options.count = parseInt(args[++i], 10);
  else if (a === '--interval' && args[i + 1]) options.interval = parseInt(args[++i], 10);
  else if (a === '--track' && args[i + 1]) options.track = args[++i];
  else if (a === '--seek' && args[i + 1]) options.seek = parseFloat(args[++i]);
  else if (a === '--analyze') {
    options.analyze = true;
    // Optional inline prompt until the next flag
    if (args[i + 1] && !args[i + 1].startsWith('--')) options.analyzePrompt = args[++i];
  }
  else if (a === '--full-page') options.fullPage = true;
}

// ─── Setup ───
fs.mkdirSync(options.out, { recursive: true });

console.log('=== Visualizer Frame Burst Capture ===\n');

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();

page.on('pageerror', err => console.error(`[pageerror] ${err.message}`));

// 1. Open visualizer
console.log('1. Opening visualizer...');
await page.goto(`${options.url}/visualizer`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2000);

// 2. Select track (search box or dropdown)
if (options.track) {
  console.log(`2. Selecting track matching "${options.track}"...`);
  const searchInput = page.getByPlaceholder(/search|find/i)
    .or(page.locator('input[type="text"]'))
    .first();
  if (await searchInput.count() > 0) {
    await searchInput.fill(options.track);
    await page.waitForTimeout(500);
    await page.getByText(options.track).first().click();
  } else {
    // Fall back to the <select> track dropdown (viz-track-select in Visualizer.tsx)
    const opt = page.locator('.viz-track-select option', { hasText: options.track }).first();
    const value = await opt.getAttribute('value');
    if (value) await page.locator('.viz-track-select').selectOption(value);
  }
  await page.waitForTimeout(2000);
}

// 3. Start playback
console.log('3. Starting playback...');
const playButton = page.getByRole('button', { name: /play/i })
  .or(page.locator('[aria-label*="play" i]'))
  .or(page.locator('.play-btn'))
  .first();
if (await playButton.count() > 0) {
  await playButton.click();
  await page.waitForTimeout(1000);
}

// 4. Seek once to the start point, THEN burst-capture — no settling between frames
if (options.seek > 0) {
  console.log(`4. Seeking to t=${options.seek}s...`);
  await page.evaluate((time) => {
    const audio = document.querySelector('audio');
    if (audio) audio.currentTime = time;
  }, options.seek);
  await page.waitForTimeout(600);
}

// 5. Burst-capture frames while playback continues
const canvas = page.locator('canvas').first();
const useFullPage = options.fullPage || (await canvas.count()) === 0;
if (useFullPage && !options.fullPage) {
  console.log('   (no canvas found — falling back to full-page screenshots)');
}

const framePaths = [];
console.log(`5. Capturing ${options.count} frames every ${options.interval}ms...\n`);

for (let i = 0; i < options.count; i++) {
  const t0 = Date.now();
  const filename = `frame_${String(i).padStart(3, '0')}.png`;
  const filepath = path.resolve(options.out, filename);

  if (useFullPage) {
    await page.screenshot({ path: filepath });
  } else {
    await canvas.screenshot({ path: filepath });
  }
  framePaths.push(filepath);

  const audioTime = await page.evaluate(() => document.querySelector('audio')?.currentTime ?? null);
  console.log(`  ${filename}  captured (audio t=${audioTime !== null ? audioTime.toFixed(2) : '?'}s)`);

  // Pace the burst: wait out the remaining interval
  const elapsed = Date.now() - t0;
  if (elapsed < options.interval) await page.waitForTimeout(options.interval - elapsed);
}

console.log(`\nSaved ${framePaths.length} frames to: ${options.out}/`);

await browser.close();

// 6. Optional motion analysis via the existing vision script
if (options.analyze) {
  const visionScript = path.resolve(__dirname, 'vision.mjs');
  if (!fs.existsSync(visionScript)) {
    console.error('\n[analyze] scripts/vision.mjs not found — skipping analysis.');
    process.exit(0);
  }
  const prompt = options.analyzePrompt ||
    'These are consecutive frames sampled at ~4fps from an animated music visualizer. ' +
    'Analyze the MOTION across the sequence: Is the animation smooth or jittery? ' +
    'What is moving (particles, waveform, camera, colors)? Is there a sense of rhythmic/beat-synced movement? ' +
    'List any visual glitches, stuttering, or dead frames.';
  console.log('\n6. Analyzing frames in motion via vision.mjs...\n');
  try {
    const out = execFileSync('node', [visionScript, 'analyze', ...framePaths, prompt], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    console.log(out);
  } catch (e) {
    console.error(`[analyze] Failed: ${e.message}`);
  }
}
