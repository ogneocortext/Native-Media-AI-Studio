#!/usr/bin/env node
/**
 * Timing-test capture for the visualizer latency fixes.
 *
 * Drives real playback (autoplay flag + audio.play()) and burst-captures the
 * live canvas in shader AND 3d modes with per-frame audio-time + beat-state logs,
 * so beat/LRC sync can be judged the way a viewer sees it.
 *
 * Usage (run from packages/frontend so `playwright` resolves):
 *   node ../../scripts/capture-viz-timing.mjs [--url http://localhost:5173]
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let base = 'http://localhost:5173';
const urlIdx = args.indexOf('--url');
if (urlIdx >= 0 && args[urlIdx + 1]) base = args[urlIdx + 1];

const OUT = path.resolve(__dirname, '../../output/viztest');
fs.mkdirSync(OUT, { recursive: true });

const TRACK = 'NeoCortext - Built This From A Dream.mp3';

const browser = await chromium.launch({
  headless: false,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('pageerror', (err) => console.error(`[pageerror] ${err.message}`));

console.log('1. Opening visualizer...');
await page.goto(`${base}/visualizer`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.viz-track-select', { timeout: 60000 });
await page.waitForTimeout(2500);

console.log(`2. Selecting "${TRACK}"...`);
await page.locator('.viz-track-select').selectOption(TRACK);
// wait for analysis + lyrics (analysis is cached server-side; lyrics fetch is fast)
await page.waitForFunction(() => window.__VIZ_TEST__?.getState()?.currentFilename, null, { timeout: 30000 });
await page.waitForTimeout(4000);

console.log('3. Starting playback via audio.play()...');
const playing = await page.evaluate(async () => {
  const audio = document.querySelector('audio');
  if (!audio) return 'no-audio-element';
  try {
    await audio.play();
  } catch (e) {
    return 'play-failed: ' + e.message;
  }
  return audio.paused ? 'still-paused' : 'playing';
});
console.log('   playback:', playing);
if (playing !== 'playing') {
  console.error('FATAL: could not start playback');
  await browser.close();
  process.exit(1);
}

// Wait for REAL playback (currentTime advancing) — play() can resolve while
// the media is still buffering, and seeks issued too early never land.
await page.waitForFunction(
  () => (document.querySelector('audio')?.currentTime ?? 0) > 0.5,
  null,
  { timeout: 20000 },
);
console.log('   confirmed: currentTime advancing');

// Hide overlay chrome that pollutes captures (style picker, toasts, AI preset row)
await page.addStyleTag({
  content: '.viz-style-picker,.viz-ai-preset-row,.viz-test-panel{display:none !important}',
});

async function seekTo(time) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.evaluate((t) => {
      const audio = document.querySelector('audio');
      if (audio) audio.currentTime = t;
    }, time);
    try {
      await page.waitForFunction(
        (t) => Math.abs((document.querySelector('audio')?.currentTime ?? -99) - t) < 1.5,
        time,
        { timeout: 5000 },
      );
      return true;
    } catch {
      console.log(`   seek to ${time}s missed, retrying...`);
    }
  }
  return false;
}

async function burst(prefix, seekTarget, count, intervalMs) {
  const seeked = await seekTo(seekTarget);
  console.log(`   seek to ${seekTarget}s: ${seeked ? 'landed' : 'FAILED — capturing anyway'}`);
  await page.waitForTimeout(800);
  const canvas = page.locator('.viz-canvas-wrap canvas').first();
  const hasCanvas = (await canvas.count()) > 0;
  console.log(`   canvas present: ${hasCanvas}`);
  // Canvas box in device pixels for cropping. NOTE: element screenshots of a
  // non-preserved WebGL canvas return STALE bitmaps — always capture full-page
  // (live compositor path) and crop. The box is re-measured every frame so
  // layout shifts (toasts, lyric overlays) can't stale the crop.
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  const log = [];
  for (let i = 0; i < count; i++) {
    const t0 = Date.now();
    const fp = path.join(OUT, `${prefix}_${String(i).padStart(3, '0')}.png`);
    const full = await page.screenshot();
    const box = hasCanvas ? await canvas.boundingBox() : null;
    if (box) {
      const left = Math.max(0, Math.round(box.x * dpr));
      const top = Math.max(0, Math.round(box.y * dpr));
      const width = Math.round(box.width * dpr);
      const height = Math.round(box.height * dpr);
      await sharp(full).extract({ left, top, width, height }).toFile(fp);
    } else {
      fs.writeFileSync(fp, full);
    }
    const s = await page.evaluate(() => ({
      t: document.querySelector('audio')?.currentTime ?? null,
      beat: window.__VIZ_TEST__?.getState()?.liveAudioData?.beat ?? null,
      bass: window.__VIZ_TEST__?.getState()?.liveAudioData?.bass ?? null,
      lyric: window.__VIZ_TEST__ ? document.querySelector('.viz-lyric, .kinetic-lyric, [class*="lyric"]')?.textContent?.slice(0, 60) ?? null : null,
    }));
    log.push({ frame: `${prefix}_${String(i).padStart(3, '0')}.png`, ...s });
    console.log(`   ${prefix}_${String(i).padStart(3, '0')}.png  t=${s.t?.toFixed(2)}s beat=${s.beat} bass=${s.bass?.toFixed(2)}`);
    const dt = Date.now() - t0;
    if (dt < intervalMs) await page.waitForTimeout(intervalMs - dt);
  }
  fs.writeFileSync(path.join(OUT, `${prefix}_log.json`), JSON.stringify(log, null, 1));
  return log;
}

// Burst 1: shader mode (default) at verse entry — LRC verse starts 33.36s
console.log('4. Burst 1: shader mode @ verse (t=34s, 20 frames @125ms)...');
await burst('shader_verse', 34, 20, 125);

// Burst 2: switch to 3D mode (toggle shader->2d->3d), capture chorus groove
console.log('5. Switching to 3D mode...');
const modeBtn = page.locator('.viz-icon-btn[title^="Mode:"]').first();
await modeBtn.click(); // shader -> 2d
await page.waitForTimeout(500);
await modeBtn.click(); // 2d -> 3d
await page.waitForTimeout(3000);
const mode = await page.evaluate(() => window.__VIZ_TEST__?.getState()?.vizMode);
console.log('   mode now:', mode);
console.log('6. Burst 2: 3D mode @ chorus (t=60s, 20 frames @125ms)...');
await burst('mode3d_chorus', 60, 20, 125);

await browser.close();
console.log(`\nDone. Frames + logs in ${OUT}/`);
