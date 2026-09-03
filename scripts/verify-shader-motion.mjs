import { pathToFileURL } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
process.chdir(REPO_ROOT);

const PLAYWRIGHT_DIR = path.join(REPO_ROOT, 'packages', 'frontend', 'node_modules', 'playwright');
const playwrightMod = await import(pathToFileURL(path.join(PLAYWRIGHT_DIR, 'index.mjs')).href);
const { chromium } = playwrightMod;

const OUT_DIR = path.resolve('browser-test', 'out');
const FRAMES_DIR = path.join(OUT_DIR, 'shader_frames');
fs.mkdirSync(FRAMES_DIR, { recursive: true });

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { track: null, duration: 10, fps: 1, threshold: 20 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--track' && args[i + 1]) opts.track = args[++i];
    else if (args[i] === '--duration' && args[i + 1]) opts.duration = parseInt(args[++i], 10);
    else if (args[i] === '--fps' && args[i + 1]) opts.fps = parseInt(args[++i], 10);
    else if (args[i] === '--threshold' && args[i + 1]) opts.threshold = parseInt(args[++i], 10);
  }
  return opts;
}

async function waitForCanvas(page, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const canvas = await page.$('canvas');
    if (canvas) return canvas;
    await page.waitForTimeout(500);
  }
  return null;
}

async function waitForTracks(page, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const options = await page.$$('select.viz-track-select option:not([disabled])');
    if (options.length > 0) return options;
    await page.waitForTimeout(500);
  }
  return [];
}

async function ensureTrackSelected(page, trackName) {
  const options = await waitForTracks(page);
  if (options.length === 0) {
    console.warn('No tracks loaded');
    return;
  }

  const select = await page.$('select.viz-track-select');

  if (trackName) {
    try {
      await select.selectOption({ label: trackName });
      console.log(`Selected track: ${trackName}`);
      await page.waitForTimeout(2000);
      return;
    } catch (e) {
      console.warn(`Track "${trackName}" not found, using first available`);
    }
  }

  const firstOption = options[0];
  const label = await firstOption.textContent();
  await select.selectOption({ index: 1 });
  console.log(`Selected first track: ${label?.trim()}`);
  await page.waitForTimeout(2000);
}

async function ensureMode(page, mode) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const currentMode = await page.$eval(`button[title^="Mode:"]`, el => el.getAttribute('title').replace('Mode: ', '').trim()).catch(() => null);
    if (currentMode === mode) {
      console.log(`Already in ${mode} mode`);
      return;
    }
    const modeBtn = await page.$(`button[title^="Mode:"]`);
    if (!modeBtn) {
      console.warn('Mode button not found');
      return;
    }
    await modeBtn.click();
    await page.waitForTimeout(800);
    console.log(`Cycling mode... clicked (attempt ${attempt + 1}), now=${currentMode ?? '?'}`);
  }
  const finalMode = await page.$eval(`button[title^="Mode:"]`, el => el.getAttribute('title').replace('Mode: ', '').trim()).catch(() => 'unknown');
  console.log(`Final mode after cycling: ${finalMode}`);
}

async function playAudio(page) {
  const audioEl = await page.$('audio.viz-audio');
  if (!audioEl) {
    console.warn('Audio element not found');
    return false;
  }

  const isPlaying = await page.$eval('audio.viz-audio', el => !el.paused);
  if (isPlaying) {
    console.log('Audio already playing');
    return true;
  }

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
  console.log('Initiated audio playback');

  const start = Date.now();
  while (Date.now() - start < 15000) {
    const state = await page.$eval('audio.viz-audio', el => ({
      paused: el.paused,
      readyState: el.readyState,
      duration: el.duration,
      currentTime: el.currentTime
    })).catch(() => null);
    if (state && !state.paused && state.readyState >= 2 && state.duration > 0) {
      console.log(`Audio playback confirmed (readyState=${state.readyState}, duration=${state.duration})`);
      return true;
    }
    await page.waitForTimeout(500);
  }

  console.warn('Audio did not become ready within timeout');
  return false;
}

async function recordScreen(duration) {
  const videoPath = path.join(OUT_DIR, 'shader_capture.mp4');
  await new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'gdigrab',
      '-framerate', '30',
      '-i', 'desktop',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-t', String(duration),
      videoPath
    ]);
    ffmpeg.on('close', code => code === 0 ? resolve(void 0) : reject(new Error(`ffmpeg exited ${code}`)));
  });
  return videoPath;
}

function extractFrames(videoPath, fps) {
  return new Promise((resolve, reject) => {
    fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
    fs.mkdirSync(FRAMES_DIR, { recursive: true });
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-vf', `fps=${fps},scale=3840:-1`,
      path.join(FRAMES_DIR, 'frame_%03d.png')
    ]);
    ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg frame extract exited ${code}`)));
  });
}

async function analyzeFrames(threshold = 20) {
  const files = fs.readdirSync(FRAMES_DIR).filter(f => f.endsWith('.png')).sort();
  if (files.length < 2) {
    console.log('Not enough frames to analyze');
    return;
  }

  const crops = [
    { name: 'full', left: 0, top: 0, width: null, height: null },
    { name: 'canvas', left: 400, top: 100, width: 2500, height: 1700 }
  ];

  for (const crop of crops) {
    console.log(`\nMotion analysis (${crop.name}, threshold=${threshold}):`);

    let prevBuffer = await sharp(path.join(FRAMES_DIR, files[0])).raw().ensureAlpha().toBuffer();
    const meta = await sharp(path.join(FRAMES_DIR, files[0])).metadata();
    const imgW = meta.width || 1;
    const imgH = meta.height || 1;

    let totalChanged = 0;
    let maxChanged = 0;
    let maxPair = '';

    for (let i = 1; i < files.length; i++) {
      let currBuffer = await sharp(path.join(FRAMES_DIR, files[i])).raw().ensureAlpha().toBuffer();

      let a = prevBuffer;
      let b = currBuffer;

      if (crop.width) {
        const cLeft = Math.min(crop.left, imgW - 1);
        const cTop = Math.min(crop.top, imgH - 1);
        const cWidth = Math.min(crop.width, imgW - cLeft);
        const cHeight = Math.min(crop.height, imgH - cTop);

        a = await sharp(path.join(FRAMES_DIR, files[i - 1]))
          .extract({ left: cLeft, top: cTop, width: cWidth, height: cHeight })
          .raw().ensureAlpha().toBuffer();
        b = await sharp(path.join(FRAMES_DIR, files[i]))
          .extract({ left: cLeft, top: cTop, width: cWidth, height: cHeight })
          .raw().ensureAlpha().toBuffer();
      }

      const len = Math.min(a.length, b.length);
      let changed = 0;
      let maxPixelDiff = 0;
      for (let j = 0; j < len; j++) {
        const diff = Math.abs(a[j] - b[j]);
        if (diff > threshold) changed++;
        if (diff > maxPixelDiff) maxPixelDiff = diff;
      }
      const pct = (changed / (len / 4)) * 100;
      const maxIntensity = (maxPixelDiff / 255) * 100;
      totalChanged += pct;
      if (pct > maxChanged) {
        maxChanged = pct;
        maxPair = `${files[i - 1]} -> ${files[i]}`;
      }
      console.log(`  ${files[i - 1]} -> ${files[i]}: ${pct.toFixed(2)}% changed, max intensity ${maxIntensity.toFixed(2)}%`);
    }

    if (files.length > 1) {
      console.log(`  Avg: ${(totalChanged / (files.length - 1)).toFixed(2)}% | Peak: ${maxChanged.toFixed(2)}% (${maxPair})`);
    }
  }
}

async function main() {
  const opts = parseArgs();
  console.log(`Shader motion verification: ${opts.duration}s @ ${opts.fps}fps (threshold=${opts.threshold})`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log('Navigating to /visualizer...');
  await page.goto('http://localhost:5173/visualizer', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  await page.addInitScript(() => {
    window.__capturedConsole = [];
    const origError = console.error;
    console.error = function (...args) {
      window.__capturedConsole.push(args.map(a => typeof a === 'string' ? a : String(a)).join(' '));
      origError.apply(console, args);
    };
  });

  const canvas = await waitForCanvas(page);
  if (!canvas) {
    console.error('No canvas element found within timeout');
    await browser.close();
    process.exit(1);
  }
  console.log('Canvas found');

  await ensureMode(page, 'shader');
  await ensureTrackSelected(page, opts.track);

  const didPlay = await playAudio(page);
  if (!didPlay) {
    console.warn('Proceeding without confirmed audio playback — frames may be static');
  }

  await page.waitForTimeout(1500);

  const modeCheck = await page.$eval(`button[title^="Mode:"]`, el => el.getAttribute('title').replace('Mode: ', '').trim()).catch(() => 'unknown');
  const isPlayingCheck = await page.$eval('audio.viz-audio', el => !el.paused).catch(() => false);
  console.log(`Pre-record state: mode=${modeCheck}, audioPlaying=${isPlayingCheck}`);

  console.log(`Recording ${opts.duration}s of screen...`);
  const videoPath = await recordScreen(opts.duration);
  console.log(`Recording saved: ${videoPath}`);

  console.log(`Extracting frames @ ${opts.fps}fps...`);
  await extractFrames(videoPath, opts.fps);
  const frameCount = fs.readdirSync(FRAMES_DIR).filter(f => f.endsWith('.png')).length;
  console.log(`Extracted ${frameCount} frames`);

  await analyzeFrames(opts.threshold);

  const capturedConsole = await page.evaluate(() => window.__capturedConsole || []).catch(() => []);
  if (capturedConsole.length) {
    console.log('\nCaptured console errors:');
    for (const line of capturedConsole.slice(-20)) console.log(`  ${line}`);
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
