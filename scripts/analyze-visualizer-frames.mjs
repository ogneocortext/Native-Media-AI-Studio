#!/usr/bin/env node
/**
 * Unified Visualizer Frame Analysis (v2 — fixed)
 *
 * Issues found & fixed vs v1:
 *  - CRITICAL: per-byte changed-% could exceed 400% (4 channels per pixel). Now per-PIXEL.
 *  - Added stddev, min, p50/median, trend, black/dead-frame & low-variance detectors.
 *  - ffmpeg gdigrab was Windows-only — now auto-detects platform (gdigrab/x11grab/avfoundation).
 *  - Playwright import used a hard-coded index.mjs path that doesn't exist — now tries 4 resolvers.
 *  - Vision sampled first 6 frames only — now evenly-spaced sampling across the sequence.
 *  - Arg parsing used parseInt for fps, no validation, silent unknown flags — now floats + validated.
 *  - No machine-readable output — now writes report.json + report.md.
 *  - Duplicated canvas-activity block — deduplicated + adds Vite health-check.
 *  - No dead/black frame detection — added luminance + variance heuristics.
 *  - Ollama keep_alive was set then immediately unloaded — removed redundant keep_alive.
 *  - extractFrames hard-coded 1280:-1 — now preserves source width.
 *  - Added --json flag, stricter crop validation, stdout/STDERR separation.
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
process.chdir(REPO_ROOT);

const DEFAULT_MODEL = process.env.VISION_MODEL || "qwen3-vl:4b";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const VITE_URL = process.env.VITE_URL || "http://localhost:5173";

// Normalize legacy model aliases (vision.mjs uses qwen3-vl-optimized etc.)
const MODEL_ALIASES = {
  "qwen3-vl-optimized": "qwen3-vl-optimized:latest",
  "qwen3-vl-optimized:latest": "qwen3-vl-optimized:latest",
  "qwen3-vl:4b": "qwen3-vl:4b",
  "gemma4:e2b-it-qat": "gemma4:e2b-it-qat",
};

const ANALYSIS_PROMPTS = {
  motion: `Analyze these consecutive visualizer frames for motion quality:
1. SMOOTHNESS: Rate animation smoothness on 1-10 scale (10 = perfectly smooth)
2. JITTER: Identify any stuttering, frame drops, or uneven motion
3. FREEZES: Count how many frames appear frozen/static vs animated
4. CONSISTENCY: Is motion consistent across the sequence or does it vary?
5. VERDICT: Single sentence summary of motion quality (PASS/NEEDS_WORK with specific issue)`,

  quality: `Evaluate visual quality of these music visualizer frames:
1. CLARITY: Are elements sharp or blurry/aliased?
2. COLOR: Comment on color palette richness and gradients
3. COMPOSITION: Is the visual balanced and aesthetically pleasing?
4. DYNAMIC: Does it feel alive/energetic or static/boring?
5. IMPROVEMENT: One specific change to improve visual impact`,

  glitches: `Detect visual defects in these visualizer frames:
1. ARTIFACTS: List any rendering glitches, tearing, banding, or visual corruption
2. MISSING: Are there expected elements that don't render?
3. FLASHING: Any problematic strobe/flicker that could cause discomfort?
4. DEAD_FRAMES: Count frames that appear completely broken or blank
5. SEVERITY: Rate overall visual health: CLEAN / MINOR_ISSUES / MAJOR_PROBLEMS`,

  "beat-sync": `Analyze beat synchronization in these visualizer frames:
1. RHYTHM: Can you perceive rhythmic patterns matching expected music beats?
2. ENERGY: Do visual intensity changes seem to correspond to musical energy?
3. PREDICTABILITY: Are changes happening at regular intervals (suggesting beat sync)?
4. LAG: Is there visible delay between expected beat and visual response?
5. SYNC_SCORE: Rate beat sync quality: POOR / FAIR / GOOD / EXCELLENT`,

  comprehensive: `Comprehensive visualizer analysis across these consecutive frames:
1. MOTION: Animation smoothness, any stuttering or frozen frames
2. VISUAL_QUALITY: Sharpness, color richness, composition balance
3. BUGS: Any rendering artifacts, glitches, or broken elements
4. BEAT_SYNC: Does animation show rhythmic patterns suggesting music sync?
5. OVERALL: Single verdict: EXCELLENT / GOOD / NEEDS_IMPROVEMENT / BROKEN
6. FIX_PRIORITY: List top 3 issues to fix, ordered by impact`,
};

const VALID_MODES = new Set(["shader", "3d", "2d"]);
const VALID_PROMPTS = new Set(Object.keys(ANALYSIS_PROMPTS));

function showHelp() {
  process.stderr.write(`Usage: node scripts/analyze-visualizer-frames.mjs [options]

Options:
  --duration <sec>      Recording duration in seconds (default: 10)
  --fps <rate>          Frame extraction rate for analysis (default: 3, supports decimals)
  --track <name>        Track name to select in visualizer
  --mode <mode>         Visualizer mode: shader|3d|2d (default: shader)
  --seek <sec>          Seek to timestamp before recording (default: 5)
  --crop <spec>         Crop region: "left,top,width,height" (default: full image)
  --threshold <n>       Pixel threshold 0-255 for motion (default: 20)
  --model <model>       Ollama vision model (default: qwen3-vl:4b)
  --prompt-type <type>  motion|quality|glitches|beat-sync|comprehensive (default: comprehensive)
  --quant-only          Skip vision analysis
  --vision-only         Skip quantitative analysis
  --keep-video          Keep captured video file
  --output <dir>        Output directory (default: browser-test/out/visualizer_analysis)
  --dry-run             Analyze existing frames in output directory
  --canvas-capture      Use Playwright canvas capture (no video file)
  --json                Also emit JSON to stdout (in addition to report.json)
  --help                Show this help

Examples:
  node scripts/analyze-visualizer-frames.mjs --track "Built This" --duration 15
  node scripts/analyze-visualizer-frames.mjs --dry-run --threshold 15
  node scripts/analyze-visualizer-frames.mjs --canvas-capture --duration 5 --fps 2
`);
  process.exit(0);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    duration: 10,
    fps: 3,
    track: null,
    mode: "shader",
    seek: 5,
    crop: null,
    threshold: 20,
    model: MODEL_ALIASES[DEFAULT_MODEL] || DEFAULT_MODEL,
    promptType: "comprehensive",
    quantOnly: false,
    visionOnly: false,
    keepVideo: false,
    dryRun: false,
    canvasCapture: false,
    jsonStdout: false,
    output: "browser-test/out/visualizer_analysis",
  };

  const needVal = new Set(["--duration","--fps","--track","--mode","--seek","--crop","--threshold","--model","--prompt-type","--output"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") showHelp();
    else if (a === "--duration") { if (!args[i+1] || needVal.has(args[i+1])) throw new Error("--duration requires a value"); opts.duration = parseFloat(args[++i]); }
    else if (a === "--fps") { if (!args[i+1]) throw new Error("--fps requires a value"); opts.fps = parseFloat(args[++i]); }
    else if (a === "--track") { if (!args[i+1]) throw new Error("--track requires a value"); opts.track = args[++i]; }
    else if (a === "--mode") { if (!args[i+1]) throw new Error("--mode requires a value"); opts.mode = args[++i].toLowerCase(); }
    else if (a === "--seek") { if (!args[i+1]) throw new Error("--seek requires a value"); opts.seek = parseFloat(args[++i]); }
    else if (a === "--crop") { if (!args[i+1]) throw new Error("--crop requires a value"); opts.crop = args[++i]; }
    else if (a === "--threshold") { if (!args[i+1]) throw new Error("--threshold requires a value"); opts.threshold = parseInt(args[++i], 10); }
    else if (a === "--model") { if (!args[i+1]) throw new Error("--model requires a value"); opts.model = MODEL_ALIASES[args[++i]] || args[i]; }
    else if (a === "--prompt-type") { if (!args[i+1]) throw new Error("--prompt-type requires a value"); opts.promptType = args[++i]; }
    else if (a === "--quant-only") opts.quantOnly = true;
    else if (a === "--vision-only") opts.visionOnly = true;
    else if (a === "--keep-video") opts.keepVideo = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--canvas-capture") opts.canvasCapture = true;
    else if (a === "--json") opts.jsonStdout = true;
    else if (a === "--output") { if (!args[i+1]) throw new Error("--output requires a value"); opts.output = args[++i]; }
    else if (a.startsWith("--")) { process.stderr.write(`[warn] unknown flag: ${a} (ignored)\n`); }
  }

  // Validation
  if (!Number.isFinite(opts.duration) || opts.duration <= 0 || opts.duration > 600) throw new Error(`--duration must be 1-600, got ${opts.duration}`);
  if (!Number.isFinite(opts.fps) || opts.fps <= 0 || opts.fps > 60) throw new Error(`--fps must be 0.1-60, got ${opts.fps}`);
  if (!Number.isFinite(opts.seek) || opts.seek < 0) throw new Error(`--seek must be >=0, got ${opts.seek}`);
  if (!Number.isFinite(opts.threshold) || opts.threshold < 0 || opts.threshold > 255) throw new Error(`--threshold must be 0-255, got ${opts.threshold}`);
  if (!VALID_MODES.has(opts.mode)) throw new Error(`--mode must be one of ${[...VALID_MODES].join("|")}, got ${opts.mode}`);
  if (!VALID_PROMPTS.has(opts.promptType)) throw new Error(`--prompt-type must be one of ${[...VALID_PROMPTS].join("|")}, got ${opts.promptType}`);
  if (opts.quantOnly && opts.visionOnly) throw new Error("--quant-only and --vision-only are mutually exclusive");
  // Normalize model alias if user overrode via flag
  if (MODEL_ALIASES[opts.model]) opts.model = MODEL_ALIASES[opts.model];

  return opts;
}

function log(reqId, message) { process.stderr.write(`[${reqId}] ${message}\n`); }
function generateRequestId() { return `viz_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

// ─── Vision helpers ───

async function resizeImage(inputPath, maxDim = 1024) {
  try {
    const buf = await fs.promises.readFile(inputPath);
    if (buf.length < 50000) return buf.toString("base64");
    const img = sharp(buf);
    const meta = await img.metadata();
    const w = meta.width || 0, h = meta.height || 0;
    if (w <= maxDim && h <= maxDim) return buf.toString("base64");
    const ratio = Math.min(maxDim / w, maxDim / h);
    const newW = Math.round(w * ratio), newH = Math.round(h * ratio);
    const resized = await img.resize(newW, newH, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    log(generateRequestId(), `resize: ${inputPath} ${w}x${h} -> ${newW}x${newH}`);
    return resized.toString("base64");
  } catch (e) {
    log(generateRequestId(), `resize failed: ${e.message}`);
    const buf = await fs.promises.readFile(inputPath);
    return buf.toString("base64");
  }
}

async function getRunningModels() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/ps`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => m.name);
  } catch { return []; }
}

async function unloadModel(model) {
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, keep_alive: 0 }),
      signal: AbortSignal.timeout(30000),
    });
    log(generateRequestId(), `unloaded model: ${model}`);
  } catch (e) { log(generateRequestId(), `unload failed: ${e.message}`); }
}

async function ensureVisionModel(model) {
  const running = await getRunningModels();
  if (running.length === 0) return;
  const toUnload = running.filter((m) => m !== model);
  if (toUnload.length === 0) return;
  log(generateRequestId(), `unloading models: ${toUnload.join(",")}`);
  for (const m of toUnload) await unloadModel(m);
  await new Promise((r) => setTimeout(r, 1500));
  const still = await getRunningModels();
  const remain = still.filter((m) => m !== model);
  if (remain.length > 0) {
    log(generateRequestId(), `retry unload: ${remain.join(",")}`);
    for (const m of remain) await unloadModel(m);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function callOllama(model, prompt, images = []) {
  const url = `${OLLAMA_URL}/api/generate`;
  const reqId = generateRequestId();
  const body = { model, prompt, images: images.length ? images : undefined, stream: false, options: { num_ctx: 16384 } };
  log(reqId, `calling ollama: model=${model} images=${images.length}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`Ollama HTTP ${res.status}: ${t}`); }
    const data = await res.json();
    log(reqId, `ollama response ok: len=${(data.response || "").length}`);
    return data.response || "";
  } catch (e) { clearTimeout(timeout); throw e; }
}

function sampleEvenly(files, n) {
  if (files.length <= n) return files;
  const out = [];
  for (let i = 0; i < n; i++) out.push(files[Math.floor((i * files.length) / n)]);
  return out;
}

async function analyzeWithVision(framesDir, opts) {
  const reqId = generateRequestId();
  log(reqId, `starting vision analysis with ${opts.model}`);
  const all = fs.readdirSync(framesDir).filter((f) => f.endsWith(".png")).sort();
  const files = sampleEvenly(all, 6);
  if (files.length === 0) { log(reqId, "no frames found for vision analysis"); return null; }
  const prompt = ANALYSIS_PROMPTS[opts.promptType] || ANALYSIS_PROMPTS.comprehensive;
  log(reqId, `using prompt type: ${opts.promptType} sampling ${files.length}/${all.length} frames: ${files.join(", ")}`);
  const payloadImages = [];
  for (const file of files) payloadImages.push(await resizeImage(path.join(framesDir, file), 1024));
  const running = await getRunningModels();
  log(reqId, `running models: ${running.join(",") || "none"}`);
  await ensureVisionModel(opts.model);
  try {
    const response = await callOllama(opts.model, prompt, payloadImages);
    log(reqId, "vision analysis complete");
    await unloadModel(opts.model);
    return { text: response, sampledFiles: files };
  } catch (e) {
    log(reqId, `vision analysis failed: ${e.message}`);
    try { await unloadModel(opts.model); } catch {}
    return null;
  }
}

// ─── Quantitative ───

function parseCrop(cropStr, imgW, imgH) {
  if (!cropStr) return null;
  const parts = cropStr.split(",").map((s) => parseInt(s.trim(), 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    process.stderr.write(`[warn] invalid --crop "${cropStr}" expected "left,top,width,height" — using full image\n`);
    return null;
  }
  const [left, top, width, height] = parts;
  if (width <= 0 || height <= 0) {
    process.stderr.write(`[warn] invalid crop dimensions ${width}x${height} — using full image\n`);
    return null;
  }
  return {
    left: Math.max(0, Math.min(left, imgW - 1)),
    top: Math.max(0, Math.min(top, imgH - 1)),
    width: Math.max(1, Math.min(width, imgW - Math.max(0, left))),
    height: Math.max(1, Math.min(height, imgH - Math.max(0, top))),
  };
}

async function frameStats(filePath, crop) {
  let pipeline = sharp(filePath);
  if (crop) pipeline = pipeline.extract(crop);
  const { data, info } = await pipeline.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  // info: width, height, channels=4
  let sumLum = 0, sumSq = 0;
  const pixels = info.width * info.height;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i+1] + 0.0722 * data[i+2];
    sumLum += lum;
    sumSq += lum * lum;
  }
  const mean = sumLum / pixels;
  const variance = sumSq / pixels - mean * mean;
  const isBlack = mean < 8;        // near-black frame (dead render)
  const isWhite = mean > 247;
  const isFlat = Math.sqrt(Math.max(0, variance)) < 2.5; // solid color
  return { mean, std: Math.sqrt(Math.max(0, variance)), isBlack, isWhite, isFlat, pixels, width: info.width, height: info.height };
}

async function analyzeMotion(framesDir, threshold, cropStr) {
  const reqId = generateRequestId();
  log(reqId, `quant motion: threshold=${threshold} crop=${cropStr || "full"}`);
  const files = fs.readdirSync(framesDir).filter((f) => f.endsWith(".png")).sort();
  if (files.length < 2) { log(reqId, "not enough frames"); return null; }

  const meta = await sharp(path.join(framesDir, files[0])).metadata();
  const imgW = meta.width || 1, imgH = meta.height || 1;
  const crop = parseCrop(cropStr, imgW, imgH);
  log(reqId, `analyzing ${files.length} frames ${crop ? `crop ${crop.left},${crop.top},${crop.width},${crop.height}` : `full ${imgW}x${imgH}`}`);

  // Per-frame luminance stats for dead-frame diagnosis
  const perFrameStats = [];
  for (const f of files) perFrameStats.push({ file: f, ...(await frameStats(path.join(framesDir, f), crop)) });

  const diffs = []; // {pair, pct, maxDiff, maxIntensity}
  let totalPct = 0, maxPct = 0, minPct = 100, maxPair = "", maxPixelDiff = 0;
  let motionless = 0, deadPairs = 0;

  for (let i = 1; i < files.length; i++) {
    let a, b;
    if (crop) {
      a = await sharp(path.join(framesDir, files[i-1])).extract(crop).raw().ensureAlpha().toBuffer();
      b = await sharp(path.join(framesDir, files[i])).extract(crop).raw().ensureAlpha().toBuffer();
    } else {
      a = await sharp(path.join(framesDir, files[i-1])).raw().ensureAlpha().toBuffer();
      b = await sharp(path.join(framesDir, files[i])).raw().ensureAlpha().toBuffer();
    }
    const pixelCount = Math.min(a.length, b.length) / 4;
    let changedPixels = 0, frameMax = 0;
    for (let p = 0; p < pixelCount; p++) {
      const o = p * 4;
      // per-pixel: max channel delta (ignore alpha channel 3)
      const d0 = Math.abs(a[o] - b[o]), d1 = Math.abs(a[o+1] - b[o+1]), d2 = Math.abs(a[o+2] - b[o+2]);
      const d = Math.max(d0, d1, d2);
      if (d > threshold) changedPixels++;
      if (d > frameMax) frameMax = d;
    }
    const pct = (changedPixels / pixelCount) * 100;
    const maxIntensity = (frameMax / 255) * 100;
    diffs.push({ pair: `${files[i-1]} -> ${files[i]}`, pct, maxDiff: frameMax, maxIntensity });
    totalPct += pct;
    if (pct > maxPct) { maxPct = pct; maxPair = `${files[i-1]} -> ${files[i]}`; }
    if (pct < minPct) minPct = pct;
    if (frameMax > maxPixelDiff) maxPixelDiff = frameMax;
    if (pct < 0.05) motionless++; // <0.05% is effectively frozen at canvas res
    // dead pair: both frames flat/black
    if (perFrameStats[i-1].isBlack && perFrameStats[i].isBlack) deadPairs++;
    log(reqId, `${files[i-1]} -> ${files[i]}: ${pct.toFixed(2)}% pixels changed, max channel delta ${frameMax} (${maxIntensity.toFixed(1)}%)`);
  }

  const n = diffs.length;
  const avg = totalPct / n;
  const sorted = [...diffs].map(d=>d.pct).sort((a,b)=>a-b);
  const median = n % 2 ? sorted[(n>>1)] : (sorted[n/2-1]+sorted[n/2])/2;
  const variance = diffs.reduce((s,d)=>s+(d.pct-avg)**2,0)/n;
  const std = Math.sqrt(variance);
  const motionlessRate = (motionless / n) * 100;
  const blackFrames = perFrameStats.filter(s=>s.isBlack).length;
  const flatFrames = perFrameStats.filter(s=>s.isFlat).length;

  // Classification
  let verdict = "UNKNOWN";
  let hint = "";
  if (minPct === 0 && maxPct === 0) { verdict = "BROKEN_STATIC"; hint = "No pixel changed — canvas not rendering or capture is stale."; }
  else if (avg < 0.1 && blackFrames === 0) { verdict = "VERY_LOW_MOTION"; hint = "Shader may be subtle; verify with --threshold 10 or inspect frames manually."; }
  else if (motionlessRate > 50) { verdict = "INTERMITTENT_FREEZE"; hint = `${motionless}/${n} pairs near-frozen — check beat-sync gating or RAF throttling.`; }
  else if (std > avg * 0.9) { verdict = "BURSTY_MOTION"; hint = "High variance suggests beat-gated animation rather than continuous drift — expected for audio-reactive viz."; }
  else if (blackFrames > 0) { verdict = "HAS_DEAD_FRAMES"; hint = `${blackFrames} black/flat frames detected — possible context loss on tab background.`; }
  else { verdict = "HEALTHY_MOTION"; hint = "Motion looks continuous."; }

  return {
    avgChanged: avg, medianChanged: median, minChanged: minPct, maxChanged: maxPct,
    maxPair, maxPixelDiff, maxIntensity: (maxPixelDiff/255)*100,
    stdDev: std, motionlessFrames: motionless, motionlessRate,
    totalFrames: files.length, pairs: n,
    blackFrames, flatFrames, deadPairs,
    perFrameStats: perFrameStats.map(s=>({ file:s.file, meanLum: +s.mean.toFixed(1), stdLum:+s.std.toFixed(1), isBlack:s.isBlack, isFlat:s.isFlat })),
    diffs, verdict, hint,
  };
}

// ─── Canvas capture ───

async function captureFramesWithPlaywright(page, framesDir, count, intervalMs) {
  const reqId = generateRequestId();
  log(reqId, `canvas capture: ${count} frames every ${intervalMs}ms`);
  const canvas = await page.$("canvas");
  if (!canvas) throw new Error("Canvas element not found — is the visualizer route mounted? Try VITE_URL=" + VITE_URL);
  for (let i = 0; i < count; i++) {
    const fp = path.join(framesDir, `frame_${String(i).padStart(3,"0")}.png`);
    await canvas.screenshot({ path: fp });
    log(reqId, `captured frame_${String(i).padStart(3,"0")}.png`);
    if (i < count - 1) await page.waitForTimeout(intervalMs);
  }
  log(reqId, `canvas capture done: ${count} frames`);
}

function ffmpegInputForPlatform() {
  const p = process.platform;
  if (p === "win32") return ["-f","gdigrab","-framerate","30","-i","desktop"];
  if (p === "darwin") return ["-f","avfoundation","-framerate","30","-i","1:0"];
  return ["-f","x11grab","-framerate","30","-i", process.env.DISPLAY || ":0.0"];
}

async function recordScreen(duration, outputPath) {
  const reqId = generateRequestId();
  const inputArgs = ffmpegInputForPlatform();
  log(reqId, `ffmpeg record ${duration}s [${process.platform}] -> ${outputPath}`);
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [...inputArgs, "-c:v","libx264","-pix_fmt","yuv420p","-preset","fast","-crf","23","-t",String(duration),"-y",outputPath]);
    let stderr = "";
    ff.stderr.on("data", d => { stderr += d.toString(); });
    ff.on("close", code => {
      if (code === 0) { log(reqId, "record complete"); resolve(outputPath); }
      else reject(new Error(`ffmpeg record exited ${code}: ${stderr.slice(-800)}`));
    });
    ff.on("error", e => reject(new Error(`ffmpeg not found: ${e.message}. Install: https://ffmpeg.org`)));
  });
}

async function extractFrames(videoPath, fps, framesDir) {
  const reqId = generateRequestId();
  log(reqId, `extract frames ${fps}fps from ${videoPath}`);
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-i",videoPath,"-vf",`fps=${fps}`,path.join(framesDir,"frame_%03d.png"),"-y"]);
    let stderr = "";
    ff.stderr.on("data", d => { stderr += d.toString(); });
    ff.on("close", code => {
      if (code === 0) { log(reqId, "extract complete"); resolve(); }
      else reject(new Error(`ffmpeg extract exited ${code}: ${stderr.slice(-800)}`));
    });
    ff.on("error", e => reject(e));
  });
}

// ─── Playwright setup (shared) ───

async function loadPlaywrightChromium() {
  let lastErr = null;
  // 1) pnpm workspace: require() via createRequire bypasses ESM bare-specifier issues
  try {
    const { createRequire } = await import("module");
    const req = createRequire(path.join(REPO_ROOT, "scripts/analyze-visualizer-frames.mjs"));
    const tryPaths = [
      path.join(REPO_ROOT, "packages/frontend/node_modules/playwright"),
      path.join(REPO_ROOT, "node_modules/playwright"),
      "playwright",
      "@playwright/test",
    ];
    for (const p of tryPaths) {
      try {
        const mod = req(p);
        const chromium = mod.chromium || mod.default?.chromium;
        if (chromium) return { chromium };
      } catch (e) { lastErr = e; }
    }
  } catch (e) { lastErr = e; }
  // 2) ESM file-URL fallback (pnpm symlinked layout)
  const fileCandidates = [
    path.join(REPO_ROOT, "packages/frontend/node_modules/playwright/index.js"),
    path.join(REPO_ROOT, "packages/frontend/node_modules/playwright/index.mjs"),
  ];
  for (const spec of fileCandidates) {
    try {
      if (fs.existsSync(spec)) {
        const mod = await import(pathToFileURL(spec).href);
        const chromium = mod.chromium || mod.default?.chromium || mod.default;
        if (chromium?.launch) return { chromium };
      }
    } catch (e) { lastErr = e; }
  }
  throw new Error(`Could not load Playwright chromium — last error: ${lastErr?.message}. Run: pnpm --filter native-media-ai-studio-frontend exec playwright install chromium (or run this script via: pnpm --filter native-media-ai-studio-frontend exec node ../../scripts/analyze-visualizer-frames.mjs ...)`);
}

async function checkViteHealth() {
  const candidates = [VITE_URL, "http://127.0.0.1:5173", "http://[::1]:5173"].filter((v, i, a) => a.indexOf(v) === i);
  let lastErr = null;
  for (const url of candidates) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (r.ok) return true;
      lastErr = new Error(`HTTP ${r.status} at ${url}`);
    } catch (e) { lastErr = e; }
  }
  throw new Error(`Vite not reachable (tried ${candidates.join(", ")}) — run pnpm --filter native-media-ai-studio-frontend dev. (${lastErr?.message})`);
}

async function getCanvasActivity(page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return { hasCanvas:false };
    let hasContext = false;
    try { hasContext = !!(c.getContext("2d") || c.getContext("webgl") || c.getContext("webgl2")); } catch {}
    return { hasCanvas:true, hasContext, width:c.width, height:c.height, cssW: c.clientWidth, cssH: c.clientHeight };
  });
}

async function setupVisualizer(opts) {
  const reqId = generateRequestId();
  log(reqId, `setup visualizer mode=${opts.mode} track=${opts.track || "auto"} seek=${opts.seek}s`);
  await checkViteHealth();
  const pw = await loadPlaywrightChromium();
  const { chromium } = pw;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport:{ width:1920, height:1080 }});
  const page = await context.newPage();

  const vizUrl = `${VITE_URL.replace(/\/$/,"")}/visualizer`;
  log(reqId, `goto ${vizUrl}`);
  await page.goto(vizUrl, { waitUntil:"domcontentloaded" });
  await page.waitForTimeout(3000);

  const canvas = await page.waitForSelector("canvas",{ timeout:15000 }).catch(()=>null);
  if (!canvas) { await browser.close(); throw new Error("Canvas not found — visualizer route may have changed. Check /visualizer renders a <canvas>."); }
  log(reqId, "canvas found");

  if (opts.mode !== "shader") {
    const btn = await page.$('button[title^="Mode:"]');
    if (btn) {
      const order = ["3d","shader","2d"];
      let current = await page.$eval('button[title^="Mode:"]', el=>el.getAttribute("title").replace("Mode: ","").trim()).catch(()=>"unknown");
      current = current.toLowerCase();
      const ci = order.indexOf(current), ti = order.indexOf(opts.mode);
      if (ci !== -1 && ti !== -1) {
        const clicks = (ti - ci + order.length) % order.length;
        for (let i=0;i<clicks;i++){ await btn.click(); await page.waitForTimeout(800); }
        log(reqId, `mode -> ${opts.mode}`);
      } else log(reqId, `mode switch skipped (current=${current})`);
    }
  }

  const select = await page.$("select.viz-track-select");
  if (select) {
    try {
      if (opts.track) { log(reqId, `select track "${opts.track}"`); await select.selectOption({ label: opts.track }); }
      else { log(reqId, "auto-select first track"); await select.selectOption({ index:1 }); }
      await page.waitForTimeout(1500);
    } catch (e) { log(reqId, `track select failed: ${e.message}`); }
  }

  try {
    await page.waitForFunction(()=>{ const a=document.querySelector("audio"); return a && a.readyState >=1; },{ timeout:3000 });
    log(reqId, "audio ready");
  } catch {
    const chk = await page.evaluate(()=>{ const a=document.querySelector("audio"); return { exists:!!a, readyState:a?.readyState||0 }; });
    log(reqId, `audio check: ${JSON.stringify(chk)}`);
  }

  // Play — try buttons then direct .play()
  const selectors = ['button[aria-label*="play" i]',".play-btn",'button[title*="play" i]',"button.viz-play-btn"];
  let playBtn=null;
  for (const s of selectors) { try{ playBtn=await page.$(s); if(playBtn){ log(reqId,`play btn ${s}`); break; } }catch{} }
  if (!playBtn) {
    log(reqId,"no play button — direct audio.play()");
    await page.evaluate(()=>{ const a=document.querySelector("audio"); if(a) a.play().catch(()=>{}); });
  } else { await playBtn.click(); await page.waitForTimeout(1000); }

  // CrossOrigin fix + retry
  await page.evaluate(()=>{ const a=document.querySelector("audio"); if(a){ a.removeAttribute("crossOrigin"); const s=a.src; a.src=""; a.src=s; }});
  await page.waitForTimeout(1500);
  await page.evaluate(()=>{ const a=document.querySelector("audio"); if(a) a.play().catch(()=>{}); });
  await page.waitForTimeout(800);

  if (opts.seek > 0) {
    log(reqId, `seek ${opts.seek}s`);
    await page.evaluate(t=>{ const a=document.querySelector("audio"); if(a) a.currentTime=t; }, opts.seek);
    await page.waitForTimeout(800);
  }

  const st = await page.evaluate(()=>{
    const a=document.querySelector("audio");
    if(!a) return { exists:false };
    return { exists:true, playing:!a.paused, readyState:a.readyState, currentTime:a.currentTime, duration:a.duration, error:a.error?.message||null };
  });
  log(reqId, `audio: ${JSON.stringify({ playing: st.playing, readyState: st.readyState, t: +(st.currentTime||0).toFixed?.(1) ?? st.currentTime, dur: +(st.duration||0).toFixed?.(1) ?? st.duration })}`);
  if (!st.playing && st.exists) {
    log(reqId,"retry play with synthetic event");
    await page.evaluate(()=>{ const a=document.querySelector("audio"); if(a){ a.dispatchEvent(new Event("click")); a.play().catch(()=>{}); }});
    await page.waitForTimeout(1200);
  }

  const act = await getCanvasActivity(page);
  console.log(`Canvas: hasCanvas=${act.hasCanvas} hasContext=${act.hasContext} buffer=${act.width}x${act.height} css=${act.cssW}x${act.cssH}`);

  return { browser, page };
}

// ─── Report writers ───

function writeReports(outputDir, opts, quant, vision) {
  const report = {
    generatedAt: new Date().toISOString(),
    opts,
    viteUrl: VITE_URL,
    ollamaUrl: OLLAMA_URL,
    quantitative: quant || null,
    vision: vision ? { sampledFiles: vision.sampledFiles, text: vision.text } : null,
  };
  fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));

  const lines = [];
  lines.push(`# Visualizer Analysis — ${new Date().toLocaleString()}`);
  lines.push(`- Mode: ${opts.mode} | Track: ${opts.track || "auto"} | Duration: ${opts.duration}s @ ${opts.fps}fps | Threshold: ${opts.threshold}`);
  lines.push(`- Model: ${opts.model} | Prompt: ${opts.promptType}`);
  lines.push("");
  if (quant) {
    lines.push(`## Quantitative Motion`);
    lines.push(`- Frames: ${quant.totalFrames} (${quant.pairs} pairs)`);
    lines.push(`- Avg changed: **${quant.avgChanged.toFixed(2)}%** | Median: ${quant.medianChanged.toFixed(2)}% | Min: ${quant.minChanged.toFixed(2)}% | Max: ${quant.maxChanged.toFixed(2)}% (${quant.maxPair})`);
    lines.push(`- StdDev: ${quant.stdDev.toFixed(2)}% | Max pixel delta: ${quant.maxPixelDiff} (${quant.maxIntensity.toFixed(1)}%)`);
    lines.push(`- Motionless pairs: ${quant.motionlessFrames}/${quant.pairs} (${quant.motionlessRate.toFixed(1)}%) | Black/flat frames: ${quant.blackFrames}/${quant.flatFrames}`);
    lines.push(`- Verdict: **${quant.verdict}** — ${quant.hint}`);
    lines.push("");
    lines.push(`### Per-pair trend`);
    lines.push(`| Pair | Changed % | Max delta |`);
    lines.push(`|------|----------:|----------:|`);
    for (const d of quant.diffs) lines.push(`| ${d.pair} | ${d.pct.toFixed(2)}% | ${d.maxDiff} |`);
    lines.push("");
    if (quant.blackFrames > 0 || quant.flatFrames > 0) {
      lines.push(`> ⚠️ ${quant.blackFrames} black + ${quant.flatFrames} flat frames — check WebGL context loss / tab throttling.`);
      lines.push("");
    }
    // Actionable next steps from quant signal
    lines.push(`### Next steps (from quant)`);
    if (quant.verdict === "BROKEN_STATIC") lines.push(`- Canvas is stale — verify ShaderCanvas is mounted and RAF is ticking (check #shader-debug hash).`);
    else if (quant.verdict === "HAS_DEAD_FRAMES") lines.push(`- Dead frames imply background-tab throttling or context loss — re-run with foreground tab + keepVideo to inspect.`);
    else if (quant.verdict === "INTERMITTENT_FREEZE") lines.push(`- Freezes suggest beat-gate is holding frames — lower threshold or inspect beat detection.`);
    else if (quant.verdict === "BURSTY_MOTION") lines.push(`- Bursty is expected for audio-reactive; validate with beat-sync vision pass: \`--prompt-type beat-sync\`.`);
    else if (quant.avgChanged < 1) lines.push(`- Very low motion — shader ${opts.mode} may be too subtle at this seek; try different track/seek or lower --threshold.`);
    else lines.push(`- Motion looks healthy — proceed to vision quality pass.`);
    lines.push("");
  }
  if (vision?.text) {
    lines.push(`## Vision Analysis (${opts.model}, sampled: ${vision.sampledFiles.join(", ")})`);
    lines.push(vision.text);
    lines.push("");
  } else if (!opts.quantOnly) {
    lines.push(`## Vision Analysis — skipped/failed`);
    lines.push("");
  }
  fs.writeFileSync(path.join(outputDir, "report.md"), lines.join("\n"));
  return report;
}

// ─── Main ───

async function main() {
  let opts;
  try { opts = parseArgs(); } catch (e) { process.stderr.write(`Arg error: ${e.message}\n`); process.exit(2); }
  const reqId = generateRequestId();

  console.log("=== Unified Visualizer Frame Analysis (v2) ===\n");
  console.log(`  Duration: ${opts.duration}s  fps: ${opts.fps}  mode: ${opts.mode}  track: ${opts.track || "auto"}`);
  console.log(`  Seek: ${opts.seek}s  threshold: ${opts.threshold}  model: ${opts.model}  prompt: ${opts.promptType}`);
  console.log(`  Analysis: ${opts.quantOnly ? "quant only" : opts.visionOnly ? "vision only" : "both"}  output: ${opts.output}`);
  console.log("");

  const outputDir = path.resolve(REPO_ROOT, opts.output);
  const framesDir = path.join(outputDir, "frames");
  if (!opts.dryRun) {
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.mkdirSync(framesDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
  } else {
    fs.mkdirSync(framesDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const videoPath = path.join(outputDir, "capture.mp4");

  let browserRef = null;
  try {
    if (opts.dryRun) {
      console.log("Dry run: analyzing existing frames\n");
      const n = fs.existsSync(framesDir) ? fs.readdirSync(framesDir).filter(f=>f.endsWith(".png")).length : 0;
      console.log(`Found ${n} frames in ${framesDir}\n`);
      if (n < 2) { console.error("Need >=2 frames for analysis. Run without --dry-run first."); process.exit(2); }
    } else if (opts.canvasCapture) {
      const { browser, page } = await setupVisualizer(opts);
      browserRef = browser;
      await page.waitForTimeout(1500);
      const count = Math.max(2, Math.floor(opts.duration * opts.fps));
      const intervalMs = Math.max(16, Math.floor(1000 / opts.fps));
      console.log(`Capturing ${count} frames via canvas screenshot (every ${intervalMs}ms)...`);
      await captureFramesWithPlaywright(page, framesDir, count, intervalMs);
      await browser.close(); browserRef = null;
      console.log(`Captured ${fs.readdirSync(framesDir).filter(f=>f.endsWith(".png")).length} frames\n`);
    } else {
      const { browser } = await setupVisualizer(opts);
      browserRef = browser;
      await new Promise(r=>setTimeout(r, 1500));
      console.log("Recording screen via ffmpeg...");
      await recordScreen(opts.duration, videoPath);
      await browser.close(); browserRef = null;
      console.log("Extracting frames...");
      await extractFrames(videoPath, opts.fps, framesDir);
      console.log(`Extracted ${fs.readdirSync(framesDir).filter(f=>f.endsWith(".png")).length} frames\n`);
    }

    let quant = null, vision = null;

    if (!opts.visionOnly) {
      console.log("=== Quantitative Motion Analysis ===");
      quant = await analyzeMotion(framesDir, opts.threshold, opts.crop);
      if (quant) {
        console.log(`Avg changed:    ${quant.avgChanged.toFixed(2)}% (median ${quant.medianChanged.toFixed(2)}%  min ${quant.minChanged.toFixed(2)}%  max ${quant.maxChanged.toFixed(2)}%)`);
        console.log(`Peak pair:      ${quant.maxPair} @ ${quant.maxChanged.toFixed(2)}%`);
        console.log(`Max pixel delta:${quant.maxPixelDiff} (${quant.maxIntensity.toFixed(1)}%)  stdDev: ${quant.stdDev.toFixed(2)}%`);
        console.log(`Motionless:     ${quant.motionlessFrames}/${quant.pairs} (${quant.motionlessRate.toFixed(1)}%)  black/flat: ${quant.blackFrames}/${quant.flatFrames}`);
        console.log(`Verdict:        ${quant.verdict} — ${quant.hint}`);
        console.log("");
        // brief per-frame luminance table for dead-frame triage
        if (quant.perFrameStats.some(s=>s.isBlack || s.isFlat)) {
          console.log("Per-frame luminance:");
          for (const s of quant.perFrameStats) console.log(`  ${s.file}: mean=${s.meanLum} std=${s.stdLum}${s.isBlack?" BLACK":""}${s.isFlat?" FLAT":""}`);
          console.log("");
        }
      } else console.log("Quant analysis returned no results\n");
    }

    if (!opts.quantOnly) {
      console.log("=== AI Vision Analysis ===");
      vision = await analyzeWithVision(framesDir, opts);
      if (vision?.text) console.log(vision.text);
      else console.log("Vision analysis failed or returned no results");
      console.log("");
    }

    const report = writeReports(outputDir, opts, quant, vision);
    if (opts.jsonStdout) console.log(JSON.stringify(report, null, 2));

    if (!opts.keepVideo && !opts.dryRun && !opts.canvasCapture) {
      try { fs.unlinkSync(videoPath); console.log("Cleaned up video file"); } catch {}
    }
    console.log(`\nDone. Frames: ${framesDir}`);
    console.log(`Reports: ${path.join(outputDir,"report.json")}  +  ${path.join(outputDir,"report.md")}`);

  } catch (e) {
    if (browserRef) try { await browserRef.close(); } catch {}
    console.error(`\nError: ${e.message}`);
    if (e.stack) process.stderr.write(e.stack + "\n");
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
