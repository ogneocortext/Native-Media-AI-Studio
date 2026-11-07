#!/usr/bin/env node
/**
 * viz-capture.mjs — record a /render/visualizer session cycling through
 * visualization modes, with per-mode timestamps for downstream scoring.
 *
 * Drives the dev-only window.__VIZ_TEST__ harness (selectTrack / setMode /
 * set2DMode / setShaderPreset / togglePlay / getState) so the capture covers
 * exactly the states a user can reach: 3D stage, FX shader presets, and all
 * Canvas2D modes — each dwelled on while audio plays, so the recording
 * contains real audio-reactive motion, not a static splash.
 *
 * Pair with viz-score.mjs (--analyze runs it automatically) which slices
 * the recording per mode and runs analyze.mjs --mode vizmode.
 *
 * Usage:
 *   node tools/vision/viz-capture.mjs --track night-drive.wav
 *   node tools/vision/viz-capture.mjs --track "Take the Crown" --modes "3d,2d:bars,2d:waveform,shader:neonRain"
 *   node tools/vision/viz-capture.mjs --track x.wav --modes all --dwell 8000 --analyze --model qwen3.5:4b
 *
 * --modes grammar (comma-separated):
 *   3d | shader | 2d              — every preset/mode of that kind
 *   shader:<presetId>             — one FX preset (e.g. shader:neonRain)
 *   2d:<modeId>                   — one Canvas2D mode (e.g. 2d:mirrored-bars)
 *   kind-only entries expand in canonical order.
 *
 * Flags:
 *   --track NAME     library audio filename to load (required)
 *   --modes LIST     modes to capture (default: all — 3d + 8 shader + 14 2d)
 *   --dwell ms       per-mode dwell (default 6000; exclude ~1s settle)
 *   --settle ms      post-switch settle before dwell starts (default 1200)
 *   --out dir        output dir (default ./viz-capture-<timestamp>)
 *   --base URL       app origin (default http://127.0.0.1:5173)
 *   --viewport WxH   (default 1600x900)
 *   --analyze        run viz-score.mjs after capture
 *   --model NAME     vision model override forwarded to the scorer
 *   --no-video       skip recording (debug)
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SCORE = path.join(HERE, 'viz-score.mjs');

const requireFrontend = createRequire(path.join(REPO, 'packages', 'frontend', 'package.json'));
const { chromium } = requireFrontend('playwright');

// Mirrors of the frontend constants — kept in sync manually; the capture
// fails loudly on an unknown id rather than silently skipping a mode.
const SHADER_PRESETS = [
  'electricHorizon', 'foggyNoir', 'neonRain', 'neonGrid',
  'fireCrown', 'westCoastSunset', 'abstractWaves', 'spectralReactor',
];
const CANVAS_2D_MODES = [
  'bars', 'mirrored-bars', 'segmented-led-bars', 'stereo-split-bars',
  'stacked-frequency-bands', 'dot-peak-matrix', 'waveform', 'radial',
  'spectrogram', 'lissajous', 'constellation', 'particles', 'aurora',
  'kinetic-type',
];

const KIND_ORDER = { '3d': 0, shader: 1, '2d': 2 };

function parseArgs(argv) {
  const args = {
    base: 'http://127.0.0.1:5173',
    track: null,
    modes: 'all',
    dwellMs: 6000,
    settleMs: 1200,
    out: null,
    viewport: '1600x900',
    analyze: false,
    model: null,
    noVideo: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--track') args.track = next();
    else if (a === '--modes') args.modes = next();
    else if (a === '--dwell') args.dwellMs = parseInt(next(), 10);
    else if (a === '--settle') args.settleMs = parseInt(next(), 10);
    else if (a === '--out') args.out = next();
    else if (a === '--base') args.base = next();
    else if (a === '--viewport') args.viewport = next();
    else if (a === '--analyze') args.analyze = true;
    else if (a === '--model') args.model = next();
    else if (a === '--no-video') args.noVideo = true;
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function expandModes(spec) {
  const list = [];
  const push = (kind, id, label) => list.push({ kind, id, label });
  for (const raw of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (raw === 'all') {
      push('3d', '3d', '3D Stage');
      for (const p of SHADER_PRESETS) push('shader', p, `FX · ${p}`);
      for (const m of CANVAS_2D_MODES) push('2d', m, `2D · ${m}`);
      continue;
    }
    const [kind, id] = raw.includes(':') ? raw.split(':', 2) : [raw, null];
    if (kind === '3d') { push('3d', '3d', '3D Stage'); continue; }
    if (kind === 'shader') {
      const ids = id ? [id] : SHADER_PRESETS;
      for (const p of ids) {
        if (!SHADER_PRESETS.includes(p)) { console.error(`Unknown shader preset: ${p}`); process.exit(1); }
        push('shader', p, `FX · ${p}`);
      }
      continue;
    }
    if (kind === '2d') {
      const ids = id ? [id] : CANVAS_2D_MODES;
      for (const m of ids) {
        if (!CANVAS_2D_MODES.includes(m)) { console.error(`Unknown 2D mode: ${m}`); process.exit(1); }
        push('2d', m, `2D · ${m}`);
      }
      continue;
    }
    console.error(`Unknown mode kind: ${kind} (want 3d | shader[:id] | 2d[:id] | all)`);
    process.exit(1);
  }
  // Canonical order regardless of spec order: 3d → shader presets → 2d modes.
  list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  return list;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.track) {
    console.error('Missing --track <library audio filename>');
    process.exit(1);
  }
  const modes = expandModes(args.modes);
  const [vw, vh] = args.viewport.split('x').map((n) => parseInt(n, 10));

  const outDir = args.out
    ? path.resolve(args.out)
    : path.join(process.cwd(), `viz-capture-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: vw, height: vh },
    ...(args.noVideo ? {} : { recordVideo: { dir: path.join(outDir, 'video'), size: { width: vw, height: vh } } }),
  });
  const page = await context.newPage();
  const videoT0 = Date.now();

  await page.goto(args.base + '/render/visualizer', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__VIZ_TEST__, { timeout: 30000 });
  await page.waitForTimeout(1500);

  // Load the track and ensure playback — the whole point is audio-reactive
  // motion; a paused canvas measures nothing. selectTrack rejects when the
  // track has no analysis data (useTrackSelection dereferences
  // analysis.energy_curve) — that must not kill the capture: the canvas
  // still renders live-FFT motion without pre-analysis.
  const selectErr = await Promise.race([
    page.evaluate(async (t) => {
      try { await window.__VIZ_TEST__.selectTrack(t); return null; }
      catch (e) { return String(e).slice(0, 200); }
    }, args.track),
    new Promise((res) => setTimeout(() => res('selectTrack timed out (30s) — continuing'), 30_000)),
  ]);
  if (selectErr) console.log(`selectTrack warning (continuing): ${selectErr}`);
  await page.waitForTimeout(2000);
  const playing = await page.evaluate(() => window.__VIZ_TEST__.getState().isPlaying);
  if (!playing) {
    await page.evaluate(() => window.__VIZ_TEST__.togglePlay());
    await page.waitForTimeout(800);
  }
  const nowPlaying = await page.evaluate(() => window.__VIZ_TEST__.getState().isPlaying);
  if (!nowPlaying) {
    // Headless autoplay can still refuse; fall back to a real click on the
    // transport button (counts as a user gesture).
    const btn = page.locator('button[title*="Play" i], button[aria-label*="Play" i]').first();
    if (await btn.count()) await btn.click();
    await page.waitForTimeout(800);
  }
  const finalState = await page.evaluate(() => window.__VIZ_TEST__.getState());
  console.log(`track=${finalState.currentFilename} playing=${finalState.isPlaying}`);

  const marks = [];
  for (const [i, m] of modes.entries()) {
    const t0 = Date.now() - videoT0;
    marks.push({ t: t0, kind: m.kind, id: m.id, label: m.label });
    await page.evaluate((mode) => {
      const t = window.__VIZ_TEST__;
      if (mode.kind === '3d') t.setMode('3d');
      else if (mode.kind === 'shader') { t.setMode('shader'); t.setShaderPreset(mode.id); }
      else { t.setMode('2d'); t.set2DMode(mode.id); }
    }, m);
    await page.waitForTimeout(args.settleMs);
    await page.waitForTimeout(args.dwellMs);
    console.log(`captured ${i + 1}/${modes.length}: ${m.label} @${(t0 / 1000).toFixed(1)}s`);
  }

  await context.close();
  // browser.close() can hang on long-lived connections (the app's /api/events
  // SSE never idles out). The webm is already flushed by context.close(), so
  // bound the wait and kill the browser process if it doesn't exit.
  await Promise.race([
    browser.close(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('browser.close timeout')), 15_000)),
  ]).catch(async (e) => {
    console.log(`browser.close: ${e.message} — killing`);
    try { browser.process()?.kill('SIGKILL'); } catch { /* already gone */ }
  });

  const videoDir = path.join(outDir, 'video');
  let videoPath = null;
  let videoMtime = 0;
  for (const d of [videoDir, outDir]) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((f) => f.endsWith('.webm'))) {
      const p = path.join(d, f);
      const mt = fs.statSync(p).mtimeMs;
      if (mt > videoMtime) { videoMtime = mt; videoPath = p; }
    }
  }

  const manifest = {
    track: args.track,
    dwellMs: args.dwellMs,
    settleMs: args.settleMs,
    viewport: [vw, vh],
    modes: marks,
    video: videoPath,
    capturedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, 'marks.json'), JSON.stringify(manifest, null, 1));
  console.log(`modes: ${marks.length} | video: ${videoPath || '(none)'} | out: ${outDir}`);

  if (args.analyze && videoPath) {
    const scoreArgs = [SCORE, '--dir', outDir];
    if (args.model) scoreArgs.push('--model', args.model);
    const res = spawnSync(process.execPath, scoreArgs, { stdio: 'inherit' });
    if (res.status !== 0) process.exit(res.status ?? 1);
  }
}

main().catch((e) => {
  console.error(`viz-capture failed: ${e.message}`);
  process.exit(1);
});
