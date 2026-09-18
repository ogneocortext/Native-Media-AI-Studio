#!/usr/bin/env node
/**
 * Record a video of the FIRST visualizer (GeometricViz, style "geometric")
 * in 3D demo mode (no track needed — demo audio drives the animation).
 *
 * Usage (run from packages/frontend so `playwright` resolves):
 *   node tests/browser/record-geometric.mjs [--url http://127.0.0.1:5173] [--secs 12]
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let base = 'http://127.0.0.1:5173';
let secs = 12;
const urlIdx = args.indexOf('--url');
if (urlIdx >= 0 && args[urlIdx + 1]) base = args[urlIdx + 1];
const secsIdx = args.indexOf('--secs');
if (secsIdx >= 0 && args[secsIdx + 1]) secs = parseInt(args[secsIdx + 1], 10);

const OUT = path.resolve(__dirname, 'out/geometric');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});
// Playwright records from page creation, so the video includes setup.
// tVideoStart/tRecStart let us trim to the engagement segment afterwards.
const tVideoStart = Date.now();
let tRecStart = 0;
const page = await context.newPage();
page.on('pageerror', (err) => console.error(`[pageerror] ${err.message}`));

console.log('1. Opening visualizer...');
await page.goto(`${base}/visualizer`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__VIZ_TEST__?.getState, null, { timeout: 60000 });
await page.waitForSelector('.viz-canvas-wrap canvas', { timeout: 60000 });
await page.waitForTimeout(2000);

console.log('2. Dismissing intro hero by selecting a library track...');
const track = await page.evaluate(() => {
  const sel = document.querySelector('.viz-track-select');
  if (!sel || sel.options.length < 2) return null;
  // First non-placeholder option
  const opt = [...sel.options].find(o => o.value && !/choose|select|pick/i.test(o.text));
  return opt ? opt.value : null;
});
if (!track) {
  console.error('FATAL: no library track available to dismiss the intro hero');
  await browser.close();
  process.exit(1);
}
console.log('   track:', track);
await page.evaluate((t) => window.__VIZ_TEST__.selectTrack(t), track);
await page.waitForFunction(() => window.__VIZ_TEST__?.getState()?.currentFilename, null, { timeout: 30000 });
await page.waitForTimeout(3000);
const heroGone = await page.evaluate(() => !document.querySelector('.viz-empty-hero'));
console.log('   intro hero dismissed:', heroGone);

console.log('3. Starting playback...');
const playing = await page.evaluate(async () => {
  const audio = document.querySelector('audio');
  if (!audio) return 'no-audio-element';
  try { await audio.play(); } catch (e) { return 'play-failed: ' + e.message; }
  return audio.paused ? 'still-paused' : 'playing';
});
console.log('   playback:', playing);
try {
  await page.waitForFunction(
    () => (document.querySelector('audio')?.currentTime ?? 0) > 0.5,
    null,
    { timeout: 20000 },
  );
  console.log('   confirmed: currentTime advancing');
} catch {
  console.log('   WARNING: currentTime not advancing — capturing anyway (demo motion)');
}

console.log('4. Switching to 3D mode...');
await page.evaluate(() => window.__VIZ_TEST__.setMode('3d'));
await page.waitForTimeout(3000);
const state = await page.evaluate(() => window.__VIZ_TEST__.getState());
console.log('   vizMode:', state.vizMode, '| style:', state.visualizationStyle);

// Force the FIRST visualizer (Geometric) — track auto-select may override it.
if (state.visualizationStyle !== 'geometric') {
  console.log('   forcing style -> geometric...');
  const geoBtn = page.locator('.viz-style-btn', { hasText: 'Geometric' }).first();
  if ((await geoBtn.count()) > 0) {
    await geoBtn.click();
    await page.waitForTimeout(1500);
  } else {
    console.log('   WARNING: StylePicker not visible, staying on', state.visualizationStyle);
  }
  const styleNow = await page.evaluate(() => window.__VIZ_TEST__.getState().visualizationStyle);
  console.log('   style now:', styleNow);
}

// Hide overlay chrome that pollutes the capture (picker, toasts, test panel)
await page.addStyleTag({
  content: '.viz-style-picker,.viz-ai-preset-row,.viz-test-panel,.viz-toast,.viz-header-bar{display:none !important}',
});
await page.waitForTimeout(500);

console.log(`5. Recording ${secs}s of GeometricViz (live audio-reactive)...`);
tRecStart = Date.now();
await page.waitForTimeout(secs * 1000);

console.log('6. Finalizing video...');
const video = page.video();
await page.close();
const rawPath = await video.path();
const finalPath = path.join(OUT, 'geometric_demo.webm');
if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
fs.renameSync(rawPath, finalPath);
await context.close();
await browser.close();
const { size } = fs.statSync(finalPath);
console.log(`Done. Video: ${finalPath} (${(size / 1024).toFixed(0)} KB)`);

// Trim to the engagement segment (skip setup: hero, track select, mode switch)
const offsetSec = Math.max(0, (tRecStart - tVideoStart) / 1000 - 0.5);
const trimmedPath = path.join(OUT, 'geometric_demo_trimmed.webm');
console.log(`Trimming engagement segment (offset ${offsetSec.toFixed(1)}s, ${secs}s)...`);
const { execFileSync } = await import('child_process');
try {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', offsetSec.toFixed(1), '-i', finalPath,
    '-t', String(secs), '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-an', trimmedPath],
    { stdio: 'inherit' });
  // Fresh frames from the trimmed segment only
  for (const f of fs.readdirSync(OUT).filter(f => /^frame_\d+\.png$/.test(f))) fs.unlinkSync(path.join(OUT, f));
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', trimmedPath, '-vf', 'fps=1',
    path.join(OUT, 'frame_%02d.png')], { stdio: 'inherit' });
  const frames = fs.readdirSync(OUT).filter(f => /^frame_\d+\.png$/.test(f));
  console.log(`Trimmed video: ${trimmedPath} | ${frames.length} frames extracted`);
} catch (e) {
  console.log('WARNING: ffmpeg trim failed —', e.message);
}
