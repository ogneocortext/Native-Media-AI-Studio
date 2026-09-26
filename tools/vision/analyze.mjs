#!/usr/bin/env node
/**
 * Vision Analysis Script for Native Media AI Studio
 * Routes images through local Ollama vision model for analysis.
 * 
 * Usage:
 *   node tools/vision/analyze.mjs <image_path> ["custom prompt"]
 *   node tools/vision/analyze.mjs <image_path> <source_code> --prompt "does this match?"
 * 
 * Modes:
 *   --mode ui|responsive|regression|compare
 *   --viewport WxH (intended window size)
 *   --label "screen name"
 *   --low (640px, text-dense)
 *   --high (1280px)
 *   --json (machine-readable output)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { encodeImage, residentVisionModels, resolveVisionModel, VISION_MAX_DIM, VISION_QUALITY, VISION_KEEP_ALIVE, VISION_NUM_CTX, DEFAULT_VISION_MODEL, VISION_FALLBACK_MODEL } from './vision-common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// Configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const ATOMIC_CHAT_URL = process.env.ATOMIC_CHAT_URL || 'http://localhost:1337';
const ATOMIC_CHAT_ENABLED = (process.env.ATOMIC_CHAT_ENABLED || 'false').toLowerCase() === 'true';
const VISION_TIMEOUT_MS = parseInt(process.env.VISION_TIMEOUT_MS || '300000');

// --- Task → model routing -------------------------------------------------
// One prompt skeleton serves all models; what differs per model is sampling
// and limits (temperature, context, resolution). Modes map to the model
// whose strengths fit the task; resident-model stickiness (below) avoids a
// cold load when a capable model is already warm — a switch costs 30-60s,
// more than any prompt tweak saves.
const MODEL_PROFILES = {
  'gemma4:e2b-it-qat':   { temp: 0.3, tempExtract: 0, numCtx: 8192,  maxDim: 1568, note: 'detailed audits' },
  'gemma4-vision-optimized:latest': { temp: 0.3, tempExtract: 0, numCtx: 8192, maxDim: 1568, note: 'vision audits' },
  'qwen3-vl:2b':         { temp: 0.3, tempExtract: 0, numCtx: 8192,  maxDim: 1280, note: 'fast triage, huge ctx' },
  'qwen3-vl:4b':         { temp: 0.3, tempExtract: 0, numCtx: 8192,  maxDim: 1280, note: 'fast triage, larger' },
  'qwen3-vl-optimized:latest': { temp: 0.3, tempExtract: 0, numCtx: 8192, maxDim: 1280, note: 'optimized vision' },
  'minicpm-v:8b':        { temp: 0,   tempExtract: 0, numCtx: 8192,  maxDim: 1792, note: 'trustworthy OCR (RLAIF-V)' },
  'minicpm-v:latest':    { temp: 0,   tempExtract: 0, numCtx: 8192,  maxDim: 1792, note: 'trustworthy OCR (RLAIF-V)' },
};
const DEFAULT_PROFILE = { temp: 0.3, tempExtract: 0, numCtx: VISION_NUM_CTX, maxDim: 1568, note: 'generic' };

// Extractive modes want trustworthiness over flair; multi-image modes want
// context headroom. Everything else defaults to VISION_MODEL.
const MODE_MODEL = {
  ocr: 'gemma4:e2b-it-qat',
  table: 'gemma4:e2b-it-qat',
  chart: 'gemma4:e2b-it-qat',
  compare: 'qwen3-vl:2b',
  multicomp: 'qwen3-vl:2b',
};

function profileFor(model) {
  return MODEL_PROFILES[model] || DEFAULT_PROFILE;
}

// Resolve which model serves this call:
//   1. explicit --model flag (or VISION_MODEL env) always wins;
//   2. mode-mapped model when it is resident or nothing vision-capable is;
//   3. otherwise the resident model (cold loads cost more than any match gain).
async function resolveModel(args, forcedModel) {
  if (forcedModel) return { model: forcedModel, why: 'override' };
  const mapped = MODE_MODEL[args.mode];
  if (!mapped) return { model: DEFAULT_VISION_MODEL, why: 'default' };
  const resident = await residentVisionModels();
  const mappedBase = baseName(mapped);
  if (resident.some((r) => baseName(r) === mappedBase || r === mapped)) {
    return { model: mapped, why: 'mode-map+resident' };
  }
  // residentVisionModels() already capability-filters, so any entry here is
  // vision-capable — no basename guessing needed.
  if (!resident.length) return { model: mapped, why: 'mode-map' };
  return { model: resident[0], why: `resident-sticky(${resident[0]})` };
}
// Modes where text legibility decides the result — research (DocVLM, CVPR'25)
// shows reading-intensive VLM tasks need materially higher resolution.
const TEXT_MODES = new Set(['ui', 'responsive', 'regression', 'compare', 'ocr', 'table', 'chart']);
// Grounding + uncertainty footer appended to EVERY prompt (built-in modes
// and custom prompts alike). Research consensus (Prompt Bench 2026, CodeWorm
// production patterns, Anthropic vision guidance): these lines convert silent
// hallucinations into routable uncertainty at negligible token cost.
const GROUNDING_SUFFIX = `
GROUNDING RULES (apply always, even to the task above):
- Describe only what is actually visible. Do not infer beyond the pixels.
- If an element or text is not visible, say NOT VISIBLE instead of guessing.
- For counts, enumerate each item before stating the total.
- For text, transcribe verbatim; mark unreadable regions [unclear].`;
// Extractive modes get temperature 0 (deterministic transcription beats flair).
const EXTRACT_MODES = new Set(['ocr', 'table', 'chart']);
const ATOMIC_CHAT_READY_CACHE_TTL_MS = parseInt(process.env.ATOMIC_CHAT_READY_CACHE_TTL_MS || '10000');

function parseArgs(argv) {
  const args = {
    images: [],
    prompt: null,
    mode: 'ui',
    viewport: null,
    label: null,
    context: null,
    section: null,
    low: false,
    high: false,
    json: false,
    sourceFiles: [],
    backend: 'auto',
    model: null,
    think: (process.env.VISION_THINK || '').toLowerCase() === 'true',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mode' && argv[i + 1]) { args.mode = argv[++i]; }
    else if (arg === '--viewport' && argv[i + 1]) { args.viewport = argv[++i]; }
    else if (arg === '--label' && argv[i + 1]) { args.label = argv[++i]; }
    else if (arg === '--context' && argv[i + 1]) { args.context = argv[++i]; }
    else if (arg === '--prompt' && argv[i + 1]) { args.prompt = argv[++i]; }
    else if (arg === '--section' && argv[i + 1]) { args.section = argv[++i]; }
    else if (arg === '--source' && argv[i + 1]) { args.sourceFiles.push(argv[++i]); }
    else if (arg === '--backend' && argv[i + 1]) { args.backend = argv[++i]; }
    else if (arg === '--low') { args.low = true; }
    else if (arg === '--high') { args.high = true; }
    else if (arg === '--json') { args.json = true; }
    else if (arg === '--model' && argv[i + 1]) { args.model = argv[++i]; }
    else if (arg === '--think') { args.think = true; }
    else if (!arg.startsWith('--')) {
      // Files always win: an existing path is an image, never prompt text.
      // (The old order swallowed the 2nd+ image path as the prompt and dropped
      // the real prompt silently — this broke multi-image and MCP compare.)
      if (fs.existsSync(arg)) {
        args.images.push(arg);
      } else if (!args.prompt) {
        args.prompt = arg;
      } else {
        // Never silently drop positional text — append it.
        args.prompt += ` ${arg}`;
      }
    }
  }

  if (!['auto', 'ollama', 'atomic'].includes(args.backend)) {
    console.error(`Error: --backend must be auto|ollama|atomic`);
    process.exit(1);
  }

  return args;
}

function buildPrompt(args) {
  if (args.prompt) return args.prompt;

  const section = args.section ? ` for a ${args.section} section` : '';

  switch (args.mode) {
    case 'music-video':
      return `You are a professional music-video director and VFX supervisor reviewing a rendered frame from an audio-reactive visualization.

Context: This is a Remotion-rendered frame for a music video. The visualization uses SVG/Canvas elements driven by audio analysis (BPM, frequency bands, waveform). The song is "${args.section || 'unknown section'}".

Evaluate this frame with these specific criteria:

1. DEPTH LAYERS (Foreground/Midground/Background):
   - Are there at least 3 distinct depth layers?
   - Does parallax or size variation create real depth?
   - Rate depth effect 1-10

2. AUDIO-REACTIVE ELEMENTS:
   - Are waveform/spectrum bars visible and properly sized?
   - Do particles or elements appear to respond to audio?
   - Is the central focal point (orb/flame/shape) appropriately intense?

3. COLOR & MOOD:
   - Does the palette match the song section (cyan=intro, blue=verse, purple=chorus, amber=bridge)?
   - Is there sufficient contrast between elements?
   - Rate mood alignment 1-10

4. COMPOSITION:
   - Is the rule of thirds or center-weighted balance used effectively?
   - Are there leading lines or visual flow?
   - Is text readable against the background?

5. TECHNICAL QUALITY:
   - Any rendering artifacts, clipping, or overflow issues?
   - Are SVG elements sharp or pixelated?
   - Is the aspect ratio correct (16:9)?

6. TOP 3 IMPROVEMENTS (ranked by impact):
   - What single change would most improve this frame?
   - What element feels flat or missing?
   - What would make this feel more "premium YouTube" quality?

Return your analysis as structured JSON with these keys: depth_rating, mood_rating, composition_rating, top_improvements (array of 3 strings), visual_elements (array of visible element names).`;

    case 'responsive':
      return `You are a senior frontend engineer auditing a Native Media AI Studio UI screenshot.

Report ONLY actionable findings:
1. VIEWPORT FIT: Is content clipped, overflowing, or crammed? Name the offending element and its CSS fix (e.g., overflow-x, flex-wrap, grid-template).
2. TOUCH TARGETS: Are buttons/inputs smaller than 44x44px? List each offender with its current size estimate.
3. READABILITY: Is text below 14px or low-contrast? Give the exact text, size, and contrast issue.
4. NAVIGATION: Is content hidden behind menus, tabs, or scroll? Identify the hidden feature and how to expose it.
5. FIX: One concrete CSS/layout change that would have the biggest impact.`;

    case 'regression':
      return `You are a code reviewer comparing a rendered UI against its source implementation.

For each discrepancy found:
1. WHAT CHANGED: Element, style, or layout shift from the source code
2. SEVERITY: critical (breaks functionality), minor (visual polish), or cosmetic
3. FIX: Shortest revert or patch path. Reference the likely source file/component if identifiable.
4. CONFIDENCE: high / medium / low

Focus on regressions that affect user-facing functionality or visual polish in Native Media AI Studio.`;

    case 'compare':
      return `You are a design lead comparing two versions of a Native Media AI Studio screen.

For every difference:
1. LOCATION: Where on screen (top-left, center, bottom-right, full-width, etc.)
2. CHANGE: What moved, resized, recolored, appeared, or disappeared
3. IMPACT: UX improvement, regression, or neutral
4. FIX/PROMOTE: If it is a regression, what is the shortest fix. If it is an improvement, what principle does it demonstrate?

Prioritize differences that affect usability, readability, or visual hierarchy.`;

    case 'depth':
      return `You are a VFX depth analyst reviewing a music visualization frame for spatial quality.

Rate each depth cue 1-10 and provide specific improvement suggestions:

1. SIZE GRADIENT: Do elements shrink with distance? Are near elements significantly larger than far ones?
2. OVERLAP: Do elements properly occlude each other based on depth order?
3. ATMOSPHERIC PERSPECTURE: Do distant elements fade, blur, or shift toward background color?
4. PARALLAX: Would motion at different speeds create depth illusion?
5. FOCUS/BLUR: Is there depth-of-field effect on background/foreground elements?
6. LIGHTING DEPTH: Do light sources create proper shadows and highlights that define space?
7. COLOR DEPTH: Do warm colors advance and cool colors recede appropriately?

Overall depth score: [average of above]
Top 3 specific fixes to increase depth perception:

Return as JSON: {depth_scores: {size_gradient, overlap, atmospheric, parallax, focus_blur, lighting_depth, color_depth}, overall_depth: number, top_fixes: [string]}`;

    case 'consistency':
      return `You are a design systems auditor checking visual consistency across Native Media AI Studio frames.

Audit for:
1. COLOR PALETTE DRIFT: Compare primary/secondary/accent colors across frames. Flag any deviation from the project palette.
2. TYPOGRAPHY: Font sizes, weights, line heights, and heading styles. Are they uniform?
3. ASSET REUSE: Are icons, logos, or illustrations inconsistent in style or treatment?
4. SCENE CONTINUITY: For 3D/music-video frames, does lighting, camera angle, or mood break between consecutive shots?
5. RECOMMENDATION: keep / recut / reframe with a one-line rationale.`;

    default:
      return `You are a senior frontend engineer auditing a Native Media AI Studio UI screenshot.

Do NOT give generic descriptions. Give ONLY actionable feedback organized as:

1. ELEMENTS: List visible UI elements with their approximate positions and role in the app
2. TEXT: Transcribe visible labels, buttons, headings, and status text
3. LAYOUT: Spacing, alignment, overflow, and responsiveness issues. Reference specific CSS properties or components where possible.
4. ERRORS: Visible errors, warnings, broken images, empty states, loading skeletons, or missing content
5. NEXT_ACTION: The single highest-impact fix a coding agent should make first. Explain WHY it matters for this project's user experience.`;
  }
}

function buildMetadata(args) {
  const parts = [];
  if (args.viewport) parts.push(`Viewport: ${args.viewport}`);
  if (args.label) parts.push(`Screen: ${args.label}`);
  if (args.section) parts.push(`Song Section: ${args.section}`);
  if (args.context) parts.push(`Context: ${args.context}`);
  return parts.length > 0 ? `\n\n---\n${parts.join('\n')}` : '';
}

function toAtomicChatModel(model) {
  if (!model || typeof model !== 'string') return model;
  if (model.startsWith('ollama/')) return model;
  if (model.includes(':')) {
    return `ollama/${model.replace(/:/g, '-')}`;
  }
  return model;
}

function looksTruncated(text) {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (trimmed.length < 200) return true;
  const last = trimmed[trimmed.length - 1];
  const endsProperly = /[.!?"')}\]]$/.test(trimmed) || /\n$/.test(trimmed);
  if (!endsProperly) return true;
  if (trimmed.endsWith('...')) return true;
  return false;
}

let atomicChatReadyCachedAt = 0;
let atomicChatReady = false;

async function isAtomicChatReady() {
  const now = Date.now();
  if (atomicChatReadyCachedAt && now - atomicChatReadyCachedAt < ATOMIC_CHAT_READY_CACHE_TTL_MS) {
    return atomicChatReady;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const modelsRes = await fetch(`${ATOMIC_CHAT_URL}/v1/models`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!modelsRes.ok) {
      atomicChatReady = false;
      return atomicChatReady;
    }
    const modelsJson = await modelsRes.json();
    const models = Array.isArray(modelsJson?.data) ? modelsJson.data : [];
    if (!models.length) {
      atomicChatReady = false;
      return atomicChatReady;
    }

    const probe = await fetch(`${ATOMIC_CHAT_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: models[0].id,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 4,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    atomicChatReady = probe.ok;
  } catch (e) {
    atomicChatReady = false;
  }

  atomicChatReadyCachedAt = Date.now();
  return atomicChatReady;
}

async function analyzeWithOllama(images, prompt, model, numPredict = 1024, encOpts = {}, think = false) {
  const imageData = await Promise.all(images.map((p) => encodeImage(p, encOpts)));
  const profile = profileFor(model);

  // Ollama 0.33+: prefer /api/chat with multimodal message format.
  // /api/chat handles multi-image + text in one user turn natively and is
  // the recommended endpoint for new integrations.
  const userContent = { role: "user", content: prompt };
  if (imageData.length === 1) {
    userContent.images = [imageData[0]];
  } else if (imageData.length > 1) {
    userContent.images = imageData;
  }

  const body = {
    model: model,
    messages: [userContent],
    stream: false,
    keep_alive: VISION_KEEP_ALIVE,
    options: {
      temperature: encOpts.extractMode ? profile.tempExtract : profile.temp,
      num_predict: numPredict,
      num_ctx: profile.numCtx,
    }
  };

  // Ollama 0.21.3+ supports think parameter for reasoning models.
  // Values: true/false/"max"/"high"/"medium"/"low"/"minimal"/"none".
  if (think) {
    body.think = true;
  }

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  return { text: result.message?.content || result.response || '', done_reason: result.done_reason || '' };
}

async function analyzeWithAtomicChat(images, prompt, model, maxTokens = 4096, encOpts = {}) {
  if (!(await isAtomicChatReady())) {
    throw new Error('Atomic Chat local API is not ready');
  }

  const imageData = await Promise.all(images.map((p) => encodeImage(p, encOpts)));

  const imageParts = imageData.map((base64) => ({
    type: 'image_url',
    image_url: { url: `data:image/jpeg;base64,${base64}` },
  }));

  const body = {
    model: toAtomicChatModel(model),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...imageParts,
        ],
      },
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
  };

  const response = await fetch(`${ATOMIC_CHAT_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    atomicChatReadyCachedAt = 0;
    throw new Error(`Atomic Chat API error: ${response.status} ${response.statusText}: ${text}`);
  }

  const result = await response.json();
  const content = result?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.images.length === 0) {
    console.error('Usage: node tools/vision/analyze.mjs <image_path> ["prompt"] [options]');
    console.error('');
  console.error('Options:');
  console.error('  --mode ui|responsive|regression|compare');
  console.error('  --viewport WxH  (intended window size)');
  console.error('  --label "name"  (screen/label name)');
  console.error('  --prompt "text" (custom prompt; or pass bare text positionally)');
  console.error('  --source file   (repeatable; appended to the prompt for regression)');
  console.error('  --backend auto|ollama|atomic (vision backend, default auto)');
  console.error('  --model name  (override task→model routing, e.g. minicpm-v:8b)');
  console.error('  --think        (enable extended reasoning for complex modes: compare, music-video, regression)');
  console.error('  --low           (768px, faster, worse for text)');
  console.error('  --high          (1600px, text-dense detail)');
  console.error('  --json          (machine-readable output)');
    process.exit(1);
  }

  // Verify images exist
  for (const img of args.images) {
    if (!fs.existsSync(img)) {
      console.error(`Error: Image not found: ${img}`);
      process.exit(1);
    }
  }

  // Encode settings: text-dense modes get higher resolution (reading needs
  // pixels), extractive modes get deterministic temperature. --low/--high win.
  // The active model's profile caps resolution (bigger is not better past a
  // model's native patches) and sets sampling + context per its strengths.
  const forcedModel = args.model || process.env.VISION_MODEL || null;
  const { model: activeModel, why: modelWhy } = await resolveModel(args, forcedModel);
  const profile = profileFor(activeModel);
  const textMode = TEXT_MODES.has(args.mode);
  const maxDim = args.low ? 768 : args.high ? 1600 : textMode ? Math.max(VISION_MAX_DIM, 1568) : VISION_MAX_DIM;
  const encOpts = {
    maxDim: Math.min(maxDim, profile.maxDim, 2048),
    quality: EXTRACT_MODES.has(args.mode) ? 85 : VISION_QUALITY,
    pngPassthrough: textMode && !args.low,
    extractMode: EXTRACT_MODES.has(args.mode),
  };

  const prompt = buildPrompt(args);
  const metadata = buildMetadata(args);
  let fullPrompt = prompt + metadata + GROUNDING_SUFFIX;

  // --source was parsed but never used (regression mode got no code). Append
  // the file contents so the mode prompt can actually compare against them.
  if (args.sourceFiles.length > 0) {
    const src = args.sourceFiles.slice(0, 3).map((f) => {
      try {
        const content = fs.readFileSync(f, 'utf-8');
        return `--- ${f} ---\n${content.slice(0, 6000)}${content.length > 6000 ? '\n[... truncated]' : ''}`;
      } catch {
        return `--- ${f} (unreadable, skipped) ---`;
      }
    }).join('\n\n');
    fullPrompt += `\n\nSOURCE CODE UNDER REVIEW:\n${src}`;
    console.error(`[vision] Attached ${Math.min(args.sourceFiles.length, 3)} source file(s) to prompt`);
  }

  console.error(`Analyzing ${args.images.length} image(s) with ${activeModel} (${modelWhy})...`);
  console.error(`Mode: ${args.mode}`);
  console.error(`Backend: ${args.backend}`);
  if (args.viewport) console.error(`Viewport: ${args.viewport}`);

  try {
    let analysis;
    let usedBackend = 'none';
    // Best non-empty result seen across attempts. Retries and model
    // fallbacks can return EMPTY (fluke / capability gap) after a good
    // result already exists — never let a later attempt erase an
    // earlier success.
    let best = '';
    const note = () => {
      if (typeof analysis === 'string' && analysis.trim().length > best.trim().length) {
        best = analysis;
      }
    };
    // Ollama's own stop signal. The punctuation heuristic below misfires
    // on complete answers that end abruptly ("... SYSTEM |"), which used
    // to trigger two wasted full regenerations per call.
    let lastDoneReason = '';
    // Auto-enable reasoning for complex analysis modes on capable models.
    const reasoningModes = new Set(['compare', 'music-video', 'regression', 'multicomp']);
    const autoThink = args.think || reasoningModes.has(args.mode);
    const ollamaAttempt = async (model, budget) => {
      const r = await analyzeWithOllama(args.images, fullPrompt, model, budget, encOpts, autoThink);
      lastDoneReason = r.done_reason;
      analysis = r.text;
      note();
    };
    const needsMore = (t) =>
      typeof t !== 'string' ||
      !t.trim() ||
      (looksTruncated(t) && lastDoneReason !== 'stop');

    if (args.backend === 'atomic') {
      usedBackend = 'atomic';
      lastDoneReason = '';
      try {
        analysis = await analyzeWithAtomicChat(args.images, fullPrompt, activeModel, 4096, encOpts);
      note();
      } catch (atomicErr) {
        console.error(`[vision] Atomic Chat failed: ${atomicErr.message}`);
        analysis = '';
      }

      if (needsMore(analysis)) {
        console.error(`[vision] Atomic Chat response looks truncated, falling back to direct Ollama...`);
        try {
          // num_predict is a CAP, not a target: short answers stop at EOS
          // anyway, so starting at full budget never costs extra — while a
          // 1024-first attempt almost always triggers a second full
          // generation for structured (ui/compare/ocr) prompts, doubling
          // latency past MCP timeouts.
          await ollamaAttempt(activeModel, 4096);
          usedBackend = 'ollama-fallback';
          console.error(`[vision] Direct Ollama fallback succeeded.`);
        } catch (ollamaErr) {
          console.error(`[vision] Direct Ollama fallback also failed: ${ollamaErr.message}`);
        }
      }
    } else if (args.backend === 'ollama') {
      usedBackend = 'ollama';
      await ollamaAttempt(activeModel, 4096);
    } else {
      // auto
      if (ATOMIC_CHAT_ENABLED) {
        usedBackend = 'atomic';
        lastDoneReason = '';
        try {
          analysis = await analyzeWithAtomicChat(args.images, fullPrompt, activeModel, 4096, encOpts);
      note();
        } catch (atomicErr) {
          console.error(`[vision] Atomic Chat failed: ${atomicErr.message}`);
          analysis = '';
        }

        if (needsMore(analysis)) {
          console.error(`[vision] Atomic Chat response looks truncated, falling back to direct Ollama...`);
          try {
            await ollamaAttempt(activeModel, 4096);
            usedBackend = 'ollama-fallback';
            console.error(`[vision] Direct Ollama fallback succeeded.`);
          } catch (ollamaErr) {
            console.error(`[vision] Direct Ollama fallback also failed: ${ollamaErr.message}`);
          }
        }
      } else {
        usedBackend = 'ollama';
        await ollamaAttempt(activeModel, 4096);
      }
    }

    // Safety net: same-model retry only when the model itself reports it
    // hit the output budget (done_reason "length"). Swapping models churns
    // VRAM (unload + cold load) and is strictly slower than a longer decode.
    if (needsMore(analysis)) {
      console.error(`[vision] Response hit output budget, retrying ${activeModel}...`);
      try {
        await ollamaAttempt(activeModel, 4096);
        usedBackend += '+retry4096';
        console.error(`[vision] Budget-escalated retry succeeded.`);
      } catch (retryErr) {
        console.error(`[vision] Budget-escalated retry failed: ${retryErr.message}`);
      }
    }

    if (needsMore(analysis) && VISION_FALLBACK_MODEL !== activeModel) {
      console.error(`[vision] Still truncated, retrying with ${VISION_FALLBACK_MODEL}...`);
      try {
        await ollamaAttempt(VISION_FALLBACK_MODEL, 4096);
        usedBackend = 'ollama-fallback-model';
        console.error(`[vision] Fallback model ${VISION_FALLBACK_MODEL} succeeded.`);
      } catch (fallbackErr) {
        console.error(`[vision] Fallback model also failed: ${fallbackErr.message}`);
      }
    }

    // A later attempt failed empty after an earlier success: keep the best.
    if ((typeof analysis !== 'string' || !analysis.trim()) && best.trim()) {
      console.error('[vision] Using best non-empty result from an earlier attempt.');
      analysis = best;
    }
    const ok = typeof analysis === 'string' && analysis.trim().length > 0;
    if (args.json) {
      console.log(JSON.stringify({
        images: args.images,
        mode: args.mode,
        model: activeModel,
        backend: usedBackend,
        fallback_used: usedBackend.includes('fallback') || usedBackend.includes('retry'),
        analysis: ok ? analysis : '',
        error: ok ? undefined : 'empty-analysis',
      }, null, 2));
    } else if (ok) {
      console.log(analysis);
    }
    if (!ok) {
      // Nonzero exit matters: MCP runNode treats this as failure and actually
      // runs the python fallback (previously empty output counted as success).
      console.error(`[vision] ERROR: all backends returned empty analysis`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();