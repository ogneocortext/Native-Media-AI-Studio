import { readFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp)$/i;
const DEFAULT_MODEL = process.env.VISION_MODEL || 'gemma4:e2b-it-qat';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_THINK = true;

const DEFAULT_PROMPT = `Analyze this audio visualization screenshot. Report concisely:
1. What 3D objects/shapes are visible and their geometry complexity
2. Color palette and lighting quality
3. Any visual bugs, glitches, or rendering issues
4. How well the visualization represents music/audio concepts
5. Specific improvements for making it more dynamic and visually impressive`;

const VISION_MODES = {
  ui: `Analyze this UI screenshot. Return a structured report:
1. ELEMENTS: list visible UI elements with approximate positions (top-left, center, bottom-right)
2. TEXT: transcribe visible labels/buttons/headings
3. LAYOUT: spacing, alignment, overflow, responsiveness issues
4. ERRORS: visible errors, warnings, broken images, missing states
5. NEXT_ACTION: highest-impact fix a coding agent should make first`,

  responsive: `Check this screen for responsive/layout issues:
1. Viewport fit: is content cramped or overflowing?
2. Touch targets: are buttons/inputs too small?
3. Readability: is text too small or low-contrast?
4. Navigation: is there hidden content behind menus/scroll?
5. FIX: one concrete layout improvement`,

  regression: `Compare against the expected design. Report:
1. What changed from the intended layout/style
2. What broke or looks worse than before
3. Severity: critical / minor / cosmetic
4. FIX: shortest revert or patch path`,

  compare: `Compare these two screenshots. Identify differences, improvements, or regressions. Summarize key changes.`,

  "music-video": `Analyze this music-video frame:
1. Visual elements: shapes, text, motion blur, transitions
2. Audio sync: does the visual match the expected beat/phrase energy?
3. Style consistency: color grading, typography, effects
4. Issues: aliasing, banding, strobe risk, readability
5. Improvement: one change that raises production value`,

  consistency: `Audit visual consistency across this media:
1. Color palette drift between shots/scenes
2. Typography or logo treatment mismatches
3. Asset reuse or replacement needs
4. Scene continuity issues
5. Recommendation: keep / recut / reframe`,

  // --- MiniCPM-V 2.6 optimized modes (see docs/knowledge-library/minicpm-v-best-practices.md) ---
  ocr: `Transcribe all visible text preserving original line breaks, punctuation, and reading order. If a table is present, convert it to markdown. If a region is unclear write [unclear]. Do NOT invent text. RLAIF-V: lower hallucination, be trustworthy.`,

  table: `Convert the table in this image to markdown, preserving headers, rows, and alignment. Keep numbers and text exactly as shown. If no table exists reply "No table detected."`,

  chart: `Describe the trend shown in this chart. Name axes, units, and relative heights. Compare bars/lines, note peaks/valleys, and flag any value that is ambiguous as "estimated". Do NOT invent exact numbers if labels are missing — say "unclear". This is RLAIF-V trustworthy chart reading.`,

  multicomp: `You are given two UI screenshots: first is BEFORE, second is AFTER. List every visual difference: layout shifts, color changes, text differences, missing/added elements, sizing, and spacing. Be exhaustive. Use the two images as in-context examples.`,
};

function generateRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function logVision(reqId, detail) {
  process.stderr.write(`[${reqId}] ${detail}\n`);
}

function usage() {
  process.stderr.write(`Usage: node tools/mcp/vision.mjs <command> [options]

Commands:
  analyze <img1> [img2...] ["prompt"]
      Analyze image(s) with optional prompt.
      --model <model>  Ollama model (default: ${DEFAULT_MODEL})
      --low           Resize to 640px max (sharpens text)
      --high          Resize to 1280px max
      --quality <1-100>  JPEG quality (default: 80)
      --think / --no-think  Enable/disable chain-of-thought (default: ${DEFAULT_THINK})
      --raw           Skip metadata block in prompt

  compare <img1> <img2> ["prompt"]
      Compare two images side by side.

  diff <img1> <img2> ["prompt"]
      Show visual differences between two images.

Examples:
  node tools/mcp/vision.mjs analyze screenshot.png
  node tools/mcp/vision.mjs analyze screenshot.png "Check the health page layout"
  node tools/mcp/vision.mjs compare before.png after.png
  node tools/mcp/vision.mjs analyze shot.png --model gemma4:e2b-it-qat --low
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

// ─── Ollama chat with tool-calling support ────────────────────────────────────

async function callOllamaChat(messages, tools = [], model, think = false, retries = 2) {
  const url = `${OLLAMA_URL}/api/chat`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const reqId = generateRequestId();
    try {
      const body = {
        model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        stream: false,
        keep_alive: '5m',
        ...(think ? { think: true } : {}),
        options: {
          num_ctx: model.toLowerCase().includes("minicpm") ? 32768 : 16384,
          num_predict: 1024,
          temperature: model.toLowerCase().includes("minicpm") ? 0 : 0.3,
        },
      };

      logVision(reqId, `ollama-chat attempt=${attempt + 1} model=${model} msgs=${messages.length} tools=${tools.length} think=${think}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300000);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const msg = data.message || {};
      logVision(reqId, `ollama-chat ok model=${model} len=${(msg.content || '').length} tool_calls=${(msg.tool_calls || []).length}`);
      return msg;
    } catch (e) {
      logVision(reqId, `ollama-chat failed attempt=${attempt + 1}: ${e.message}`);
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// Backward-compatible single-turn wrapper using /api/chat with images array
async function callOllama(model, prompt, images = [], retries = 2, think = false) {
  const messages = [];
  if (images.length > 0) {
    // Ollama /api/chat multimodal: content is string, images is sibling array
    messages.push({
      role: 'user',
      content: prompt,
      images,
    });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  const msg = await callOllamaChat(messages, [], model, think, retries);
  return msg.content || '';
}

// ─── Tool implementations ─────────────────────────────────────────────────────

export async function executeTool(name, args) {
  const fn = TOOL_IMPLEMENTATIONS[name];
  if (!fn) return { error: `Unknown tool: ${name}` };
  try {
    return await fn(args);
  } catch (e) {
    return { error: e.message };
  }
}

const TOOL_IMPLEMENTATIONS = {
  read_source: async ({ path: filePath }) => {
    const abs = resolve(ROOT, filePath);
    if (!existsSync(abs)) return { error: `File not found: ${abs}` };
    const content = await readFile(abs, 'utf-8');
    const lines = content.split('\n');
    return {
      path: filePath,
      absolute: abs,
      lines: lines.length,
      preview: lines.slice(0, 200).join('\n'),
    };
  },

  search_files: async ({ pattern, path: dir = '.' }) => {
    const abs = resolve(ROOT, dir);
    // Simple recursive glob using find + filter
    const results = [];
    async function walk(current) {
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'target') {
            await walk(full);
          }
        } else if (entry.name.match(pattern)) {
          results.push(full.replace(abs, '').replace(/^[\\/]/, ''));
        }
      }
    }
    await walk(abs);
    return { pattern, directory: dir, matches: results.slice(0, 50) };
  },

  get_file_info: async ({ path: filePath }) => {
    const abs = resolve(ROOT, filePath);
    if (!existsSync(abs)) return { error: `File not found: ${abs}` };
    const s = await stat(abs);
    return {
      path: filePath,
      absolute: abs,
      size: s.size,
      isDirectory: s.isDirectory(),
      modified: s.mtime.toISOString(),
    };
  },

  compare_visuals: async ({ image_a, image_b, prompt }) => {
    const a = resolve(ROOT, image_a);
    const b = resolve(ROOT, image_b);
    if (!existsSync(a) || !existsSync(b)) {
      return { error: `Image not found: ${!existsSync(a) ? a : b}` };
    }
    const img1 = await resizeImage(a, 1024, 80);
    const img2 = await resizeImage(b, 1024, 80);
    const finalPrompt = prompt || 'Compare these two screenshots. Describe every difference.';
    const response = await callOllama(
      process.env.VISION_MODEL || DEFAULT_MODEL,
      finalPrompt,
      [img1, img2],
      2,
      false
    );
    return { comparison: response };
  },

  take_screenshot: async ({ url, selector, full_page = false }) => {
    let browser;
    try {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ headless: true });
    } catch (e) {
      return {
        error: 'playwright not available at project root. Install it as a direct dependency or use the existing scripts/capture-visualizer-frames.mjs workflow.',
        hint: 'pnpm add -D playwright',
      };
    }
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    try {
      const target = url || 'http://localhost:5173';
      await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 });
      const outPath = resolve(ROOT, 'output', 'vision-screenshot.png');
      await page.screenshot({ path: outPath, fullPage: full_page === 'true' || full_page === true });
      return { screenshot: outPath, url: target };
    } finally {
      await browser.close();
    }
  },

  list_outputs: async ({ limit = 20 }) => {
    const outDir = resolve(ROOT, 'output');
    try {
      const entries = await readdir(outDir, { recursive: true });
      const media = entries
        .filter(e => /\.(png|jpg|jpeg|webp|mp4|webm|mov|mp3|wav)$/i.test(e.name))
        .slice(0, limit)
        .map(e => e.fullPath.replace(outDir, 'output'));
      return { directory: 'output', files: media };
    } catch {
      return { directory: 'output', files: [] };
    }
  },
};

// Tool definitions exposed to Ollama
export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'read_source',
      description: 'Read a source file from the project. Returns first 200 lines with path metadata. Use this to check what the code SHOULD look like when diagnosing UI issues.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Repo-relative path to the file, e.g. packages/frontend/src/features/generate3d/Generation3DPage.tsx',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for files matching a regex pattern in the project. Returns up to 50 matches.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regex pattern to match filenames, e.g. ".*Generation3D.*\\.tsx$"',
          },
          path: {
            type: 'string',
            description: 'Directory to search from (default: project root)',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_file_info',
    description: 'Get file size and modification time. Use this to verify a file exists before reading.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Repo-relative path to the file or directory',
        },
      },
      required: ['path'],
    },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_visuals',
      description: 'Compare two images using the vision model. Returns a detailed diff summary.',
      parameters: {
        type: 'object',
        properties: {
          image_a: { type: 'string', description: 'Repo-relative path to first image' },
          image_b: { type: 'string', description: 'Repo-relative path to second image' },
          prompt: { type: 'string', description: 'Optional focus prompt for comparison' },
        },
        required: ['image_a', 'image_b'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description: 'Capture a screenshot of a URL using headless Playwright. Returns the saved image path.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to capture (default: http://localhost:5173)',
          },
          full_page: {
            type: 'boolean',
            description: 'Capture full scrollable page (default: false)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_outputs',
      description: 'List recent generated media files (images, video, audio) in the output/ directory.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Max files to return (default 20)',
          },
        },
        required: [],
      },
    },
  },
];

// ─── Warmup / readiness ───────────────────────────────────────────────────────

async function warmModel(model, enabled = true) {
  if (!enabled) return;
  const reqId = generateRequestId();
  try {
    await callOllama(model, 'Hi', [], 0);
    logVision(reqId, `warm-model ok model=${model}`);
  } catch (e) {
    logVision(reqId, `warm-model warn model=${model} ${e.message}`);
  }
}

async function ollamaReady(timeoutMs = 10000) {
  const reqId = generateRequestId();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        logVision(reqId, 'ollama-ready');
        return true;
      }
    } catch {
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  logVision(reqId, 'ollama-not-ready');
  return false;
}

async function getRunningModels() {
  const reqId = generateRequestId();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/ps`);
    if (!res.ok) return [];
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    logVision(reqId, `running-models: ${models.join(',')}`);
    return models;
  } catch (e) {
    logVision(reqId, `running-models-failed: ${e.message}`);
    return [];
  }
}

async function unloadModel(model) {
  const reqId = generateRequestId();
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
      signal: AbortSignal.timeout(30000),
    });
    logVision(reqId, `unloaded-model: ${model}`);
  } catch (e) {
    logVision(reqId, `unload-failed model=${model} ${e.message}`);
  }
}

async function ensureVisionModel(model) {
  const reqId = generateRequestId();
  const running = await getRunningModels();
  if (running.length === 0) return;

  const toUnload = running.filter(m => m !== model);
  if (toUnload.length === 0) return;

  logVision(reqId, `unloading-models: ${toUnload.join(',')}`);
  for (const m of toUnload) {
    await unloadModel(m);
  }

  await new Promise(r => setTimeout(r, 1500));

  const stillRunning = await getRunningModels();
  const stillThere = stillRunning.filter(m => m !== model);
  if (stillThere.length > 0) {
    logVision(reqId, `retry-unload: ${stillThere.join(', ')}`);
    for (const m of stillThere) {
      await unloadModel(m);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}

// ─── CLI commands ─────────────────────────────────────────────────────────────

async function cmdAnalyze(argv) {
  let prompt = null;
  let model = process.env.VISION_MODEL || DEFAULT_MODEL;
  let maxDim = 1280;
  let quality = 80;
  let raw = false;
  let think = DEFAULT_THINK;
  let mode = null;
  const images = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model' && argv[i + 1]) { model = argv[++i]; }
    else if (a === '--low') { maxDim = 640; }
    else if (a === '--high') { maxDim = 1280; }
    else if (a === '--quality' && argv[i + 1]) { quality = parseInt(argv[++i], 10); }
    else if (a === '--raw') { raw = true; }
    else if (a === '--think') { think = true; }
    else if (a === '--no-think') { think = false; }
    else if (a === '--mode' && argv[i + 1]) { mode = argv[++i]; }
    else if (IMAGE_EXT.test(a)) { images.push(a); }
    else if (!a.startsWith('--') && prompt === null) { prompt = a; }
  }

  if (images.length === 0) {
    process.stderr.write('Usage: node tools/mcp/vision.mjs analyze <img1> [img2...] ["prompt"]\n');
    process.exit(1);
  }

  const finalPrompt = prompt || DEFAULT_PROMPT;
  const reqId = generateRequestId();

  const modePrompt = VISION_MODES[mode] ? `${VISION_MODES[mode]}` : null;
  const effectivePrompt = modePrompt || finalPrompt;

  const payloadImages = [];
  for (const imgPath of images) {
    const abs = resolve(ROOT, imgPath);
    if (!existsSync(abs)) {
      process.stderr.write(`[vision] image not found: ${abs}\n`);
      process.exit(1);
    }
    logVision(reqId, `resizing: ${abs} maxDim=${maxDim}`);
    payloadImages.push(await resizeImage(abs, maxDim, quality));
  }

  logVision(reqId, `images=${images.length} model=${model} maxDim=${maxDim} think=${think}`);

  if (!(await ollamaReady())) {
    process.stderr.write('[vision] Ollama not ready — is the ollama service running?\n');
    process.exit(1);
  }

  await ensureVisionModel(model);
  await warmModel(model, true);

  const isMiniCPM = model.toLowerCase().includes("minicpm");
  // MiniCPM-V on Ollama does not support tools nor thinking (400) — branch accordingly
  const effectiveThink = isMiniCPM ? false : think;
  const effectiveTools = isMiniCPM ? [] : TOOL_DEFS;
  // OCR/table modes want 1.8MP fidelity; honor --high (1280-1344) as recommended in doc
  const messages = [
    {
      role: 'user',
      content: effectivePrompt,
      images: payloadImages,
    },
  ];

  const msg = await callOllamaChat(messages, effectiveTools, model, effectiveThink, 2);
  console.log(msg.content || '');
}

async function cmdCompare(argv) {
  if (argv.length < 2) {
    process.stderr.write('Usage: node tools/mcp/vision.mjs compare <img1> <img2> ["prompt"]\n');
    process.exit(1);
  }

  const img1Path = argv[0];
  const img2Path = argv[1];
  let prompt = argv[2] || 'Compare these two screenshots. Describe the differences in layout, content, and styling. Be specific about what changed.';
  const reqId = generateRequestId();

  const abs1 = resolve(ROOT, img1Path);
  const abs2 = resolve(ROOT, img2Path);

  if (!existsSync(abs1) || !existsSync(abs2)) {
    process.stderr.write('[vision] one or both images not found\n');
    process.exit(1);
  }

  logVision(reqId, `compare: ${abs1} vs ${abs2}`);
  const img1 = await resizeImage(abs1, 1280, 80);
  const img2 = await resizeImage(abs2, 1280, 80);

  const model = process.env.VISION_MODEL || DEFAULT_MODEL;

  if (!(await ollamaReady())) {
    process.stderr.write('[vision] Ollama not ready\n');
    process.exit(1);
  }

  await ensureVisionModel(model);
  await warmModel(model, true);

  const isMiniCPM = model.toLowerCase().includes("minicpm");
  const messages = [
    {
      role: 'user',
      content: prompt,
      images: [img1, img2],
    },
  ];

  const msg = await callOllamaChat(messages, isMiniCPM ? [] : TOOL_DEFS, model, isMiniCPM ? false : DEFAULT_THINK, 2);
  console.log(msg.content || '');
}

async function cmdDiff(argv) {
  if (argv.length < 2) {
    process.stderr.write('[vision] Usage: node tools/mcp/vision.mjs diff <img1> <img2> ["prompt"]\n');
    process.exit(1);
  }

  const img1Path = argv[0];
  const img2Path = argv[1];
  let prompt = argv[2] ||
    'These are two versions of the same screen. List every visual difference: layout changes, color changes, text changes, missing/added elements, sizing differences. Be exhaustive.';
  const reqId = generateRequestId();

  const abs1 = resolve(ROOT, img1Path);
  const abs2 = resolve(ROOT, img2Path);

  if (!existsSync(abs1) || !existsSync(abs2)) {
    process.stderr.write('[vision] one or both images not found\n');
    process.exit(1);
  }

  logVision(reqId, `diff: ${abs1} vs ${abs2}`);
  const img1 = await resizeImage(abs1, 1280, 80);
  const img2 = await resizeImage(abs2, 1280, 80);

  const model = process.env.VISION_MODEL || DEFAULT_MODEL;

  if (!(await ollamaReady())) {
    process.stderr.write('[vision] Ollama not ready\n');
    process.exit(1);
  }

  await ensureVisionModel(model);
  await warmModel(model, true);

  const isMiniCPM2 = model.toLowerCase().includes("minicpm");
  const messages = [
    {
      role: 'user',
      content: prompt,
      images: [img1, img2],
    },
  ];

  const msg = await callOllamaChat(messages, isMiniCPM2 ? [] : TOOL_DEFS, model, isMiniCPM2 ? false : DEFAULT_THINK, 2);
  console.log(msg.content || '');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const command = process.argv[2];
  switch (command) {
    case 'analyze': await cmdAnalyze(process.argv.slice(3)); break;
    case 'compare': await cmdCompare(process.argv.slice(3)); break;
    case 'diff': await cmdDiff(process.argv.slice(3)); break;
    default: usage();
  }
}
