import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp)$/i;
const DEFAULT_MODEL = 'gemma4:e2b-it-qat';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

const DEFAULT_PROMPT = `Analyze this screenshot of a desktop application. Report concisely and factually:
1. What screen/page is shown and its purpose.
2. Any UI errors, crashes, blank/loading states, broken or missing layouts.
3. Overlapping, cut-off, or unreadable elements; misaligned or inconsistent styling.
4. Whether data/visualizations are rendered or empty.
5. Concrete, actionable suggestions to improve clarity, usefulness, or correctness.`;

function usage() {
  process.stderr.write(`Usage: node scripts/vision.mjs <command> [options]

Commands:
  analyze <img1> [img2...] ["prompt"]
      Analyze image(s) with optional prompt.
      --model <model>  Ollama model (default: ${DEFAULT_MODEL})
      --low           Resize to 640px max (sharpens text)
      --high          Resize to 1280px max
      --quality <1-100>  JPEG quality (default: 80)
      --raw           Skip metadata block in prompt

  compare <img1> <img2> ["prompt"]
      Compare two images side by side.

  diff <img1> <img2> ["prompt"]
      Show visual differences between two images.

Examples:
  node scripts/vision.mjs analyze screenshot.png
  node scripts/vision.mjs analyze screenshot.png "Check the health page layout"
  node scripts/vision.mjs compare before.png after.png
  node scripts/vision.mjs analyze shot.png --model qwen3-vl:2b --low
`);
  process.exit(1);
}

async function resizeImage(inputPath, maxDim = 1024, quality = 80) {
  try {
    const buf = await readFile(inputPath);
    if (buf.length < 50000) return buf.toString('base64');

    let sharp;
    try {
      sharp = (await import('sharp')).default;
    } catch {
      return buf.toString('base64');
    }

    const img = sharp(buf);
    const meta = await img.metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;

    if (w <= maxDim && h <= maxDim) return buf.toString('base64');

    const ratio = Math.min(maxDim / w, maxDim / h);
    const newW = Math.round(w * ratio);
    const newH = Math.round(h * ratio);

    const resized = await img
      .resize(newW, newH, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();

    process.stderr.write(`[vision] ${inputPath}: ${w}x${h} -> ${newW}x${newH} (${buf.length} -> ${resized.length} bytes)\n`);
    return resized.toString('base64');
  } catch (e) {
    process.stderr.write(`[vision] resize failed for ${inputPath}: ${e.message}\n`);
    const buf = await readFile(inputPath);
    return buf.toString('base64');
  }
}

async function callOllama(model, prompt, images = [], retries = 2) {
  const url = `${OLLAMA_URL}/api/generate`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const body = JSON.stringify({
        model,
        prompt,
        images: images.length > 0 ? images : undefined,
        stream: false,
        keep_alive: '5m',
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180000);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      return data.response || '';
    } catch (e) {
      if (attempt === retries) throw e;
      process.stderr.write(`[vision] attempt ${attempt + 1} failed: ${e.message}, retrying...\n`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function warmModel(model) {
  try {
    await callOllama(model, 'Hi', [], 0);
  } catch {
  }
}

async function ollamaReady(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function cmdAnalyze(argv) {
  let prompt = null;
  let model = process.env.VISION_MODEL || DEFAULT_MODEL;
  let maxDim = 1024;
  let quality = 80;
  let raw = false;
  const images = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model' && argv[i + 1]) { model = argv[++i]; }
    else if (a === '--low') { maxDim = 640; }
    else if (a === '--high') { maxDim = 1280; }
    else if (a === '--quality' && argv[i + 1]) { quality = parseInt(argv[++i], 10); }
    else if (a === '--raw') { raw = true; }
    else if (IMAGE_EXT.test(a)) { images.push(a); }
    else if (!a.startsWith('--') && prompt === null) { prompt = a; }
  }

  if (images.length === 0) {
    process.stderr.write('Usage: node scripts/vision.mjs analyze <img1> [img2...] ["prompt"]\n');
    process.exit(1);
  }

  const finalPrompt = prompt || DEFAULT_PROMPT;

  const payloadImages = [];
  for (const imgPath of images) {
    const abs = resolve(ROOT, imgPath);
    if (!existsSync(abs)) {
      process.stderr.write(`[vision] image not found: ${abs}\n`);
      process.exit(1);
    }
    payloadImages.push(await resizeImage(abs, maxDim, quality));
  }

  process.stderr.write(`[vision] images=${images.length} model=${model} maxDim=${maxDim}\n`);

  if (!(await ollamaReady())) {
    process.stderr.write('[vision] Ollama not ready — is the ollama service running?\n');
    process.exit(1);
  }

  await warmModel(model);

  const response = await callOllama(model, finalPrompt, payloadImages);
  console.log(response);
}

async function cmdCompare(argv) {
  if (argv.length < 2) {
    process.stderr.write('Usage: node scripts/vision.mjs compare <img1> <img2> ["prompt"]\n');
    process.exit(1);
  }

  const img1Path = argv[0];
  const img2Path = argv[1];
  let prompt = argv[2] || 'Compare these two screenshots. Describe the differences in layout, content, and styling. Be specific about what changed.';

  const abs1 = resolve(ROOT, img1Path);
  const abs2 = resolve(ROOT, img2Path);

  if (!existsSync(abs1) || !existsSync(abs2)) {
    process.stderr.write('[vision] one or both images not found\n');
    process.exit(1);
  }

  const img1 = await resizeImage(abs1, 1024, 80);
  const img2 = await resizeImage(abs2, 1024, 80);

  const model = process.env.VISION_MODEL || DEFAULT_MODEL;

  if (!(await ollamaReady())) {
    process.stderr.write('[vision] Ollama not ready\n');
    process.exit(1);
  }

  await warmModel(model);

  const response = await callOllama(model, prompt, [img1, img2]);
  console.log(response);
}

async function cmdDiff(argv) {
  if (argv.length < 2) {
    process.stderr.write('Usage: node scripts/vision.mjs diff <img1> <img2> ["prompt"]\n');
    process.exit(1);
  }

  const img1Path = argv[0];
  const img2Path = argv[1];
  let prompt = argv[2] ||
    'These are two versions of the same screen. List every visual difference: layout changes, color changes, text changes, missing/added elements, sizing differences. Be exhaustive.';

  const abs1 = resolve(ROOT, img1Path);
  const abs2 = resolve(ROOT, img2Path);

  if (!existsSync(abs1) || !existsSync(abs2)) {
    process.stderr.write('[vision] one or both images not found\n');
    process.exit(1);
  }

  const img1 = await resizeImage(abs1, 1024, 80);
  const img2 = await resizeImage(abs2, 1024, 80);

  const model = process.env.VISION_MODEL || DEFAULT_MODEL;

  if (!(await ollamaReady())) {
    process.stderr.write('[vision] Ollama not ready\n');
    process.exit(1);
  }

  await warmModel(model);

  const response = await callOllama(model, prompt, [img1, img2]);
  console.log(response);
}

const command = process.argv[2];
switch (command) {
  case 'analyze': await cmdAnalyze(process.argv.slice(3)); break;
  case 'compare': await cmdCompare(process.argv.slice(3)); break;
  case 'diff': await cmdDiff(process.argv.slice(3)); break;
  default: usage();
}
