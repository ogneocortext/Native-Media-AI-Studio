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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// Configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const ATOMIC_CHAT_URL = process.env.ATOMIC_CHAT_URL || 'http://localhost:1337';
const ATOMIC_CHAT_ENABLED = (process.env.ATOMIC_CHAT_ENABLED || 'false').toLowerCase() === 'true';
const VISION_MODEL = process.env.VISION_MODEL || 'gemma4:e2b-it-qat';
const VISION_FALLBACK_MODEL = process.env.VISION_FALLBACK_MODEL || 'qwen3-vl:2b';
const VISION_MAX_DIM = parseInt(process.env.VISION_MAX_DIM || '1280');
const VISION_QUALITY = parseInt(process.env.VISION_QUALITY || '80');
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
    else if (!arg.startsWith('--')) {
      if (!args.prompt && args.images.length > 0) {
        args.prompt = arg;
      } else if (fs.existsSync(arg)) {
        args.images.push(arg);
      }
    }
  }

  if (!['auto', 'ollama', 'atomic'].includes(args.backend)) {
    console.error(`Error: --backend must be auto|ollama|atomic`);
    process.exit(1);
  }

  return args;
}

async function encodeImage(imagePath) {
  const buffer = fs.readFileSync(imagePath);
  // Small images can be sent directly
  if (buffer.length < 50000) return buffer.toString('base64');
  
  // Resize large images to avoid Ollama 400 errors
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    // sharp not available — fallback: still send raw (may fail on very large images)
    return buffer.toString('base64');
  }
  
  const resized = await sharp(buffer)
    .resize(VISION_MAX_DIM, VISION_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: VISION_QUALITY })
    .toBuffer();
  
  console.error(`[vision] Resized ${imagePath}: ${buffer.length} -> ${resized.length} bytes`);
  return resized.toString('base64');
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

async function analyzeWithOllama(images, prompt, model, numPredict = 1024) {
  const imageData = await Promise.all(images.map(encodeImage));
   
  const body = {
    model: model,
    prompt: prompt,
    images: imageData,
    stream: false,
    options: {
      temperature: 0.3,
      num_predict: numPredict,
    }
  };

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  return result.response || '';
}

async function analyzeWithAtomicChat(images, prompt, model, maxTokens = 4096) {
  if (!(await isAtomicChatReady())) {
    throw new Error('Atomic Chat local API is not ready');
  }

  const imageData = await Promise.all(images.map(encodeImage));
  
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
  console.error('  --prompt "text" (custom prompt)');
  console.error('  --source file   (source code for regression)');
  console.error('  --backend auto|ollama|atomic (vision backend, default auto)');
  console.error('  --low           (640px, text-dense)');
  console.error('  --high          (1280px)');
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

  const prompt = buildPrompt(args);
  const metadata = buildMetadata(args);
  const fullPrompt = prompt + metadata;

  console.error(`Analyzing ${args.images.length} image(s) with ${VISION_MODEL}...`);
  console.error(`Mode: ${args.mode}`);
  console.error(`Backend: ${args.backend}`);
  if (args.viewport) console.error(`Viewport: ${args.viewport}`);

  try {
    let analysis;
    let usedBackend = 'none';

    if (args.backend === 'atomic') {
      usedBackend = 'atomic';
      try {
        analysis = await analyzeWithAtomicChat(args.images, fullPrompt, VISION_MODEL);
      } catch (atomicErr) {
        console.error(`[vision] Atomic Chat failed: ${atomicErr.message}`);
        analysis = '';
      }

      if (looksTruncated(analysis)) {
        console.error(`[vision] Atomic Chat response looks truncated, falling back to direct Ollama...`);
        try {
          analysis = await analyzeWithOllama(args.images, fullPrompt, VISION_MODEL);
          usedBackend = 'ollama-fallback';
          console.error(`[vision] Direct Ollama fallback succeeded.`);
        } catch (ollamaErr) {
          console.error(`[vision] Direct Ollama fallback also failed: ${ollamaErr.message}`);
        }
      }
    } else if (args.backend === 'ollama') {
      usedBackend = 'ollama';
      analysis = await analyzeWithOllama(args.images, fullPrompt, VISION_MODEL);
    } else {
      // auto
      if (ATOMIC_CHAT_ENABLED) {
        usedBackend = 'atomic';
        try {
          analysis = await analyzeWithAtomicChat(args.images, fullPrompt, VISION_MODEL);
        } catch (atomicErr) {
          console.error(`[vision] Atomic Chat failed: ${atomicErr.message}`);
          analysis = '';
        }

        if (looksTruncated(analysis)) {
          console.error(`[vision] Atomic Chat response looks truncated, falling back to direct Ollama...`);
          try {
            analysis = await analyzeWithOllama(args.images, fullPrompt, VISION_MODEL);
            usedBackend = 'ollama-fallback';
            console.error(`[vision] Direct Ollama fallback succeeded.`);
          } catch (ollamaErr) {
            console.error(`[vision] Direct Ollama fallback also failed: ${ollamaErr.message}`);
          }
        }
      } else {
        usedBackend = 'ollama';
        analysis = await analyzeWithOllama(args.images, fullPrompt, VISION_MODEL);
      }
    }

    if (looksTruncated(analysis) && usedBackend !== 'ollama' && usedBackend !== 'ollama-fallback') {
      console.error(`[vision] Primary response looks truncated, retrying with ${VISION_FALLBACK_MODEL}...`);
      try {
        analysis = await analyzeWithOllama(args.images, fullPrompt, VISION_FALLBACK_MODEL, 4096);
        usedBackend = 'ollama-fallback-model';
        console.error(`[vision] Fallback model ${VISION_FALLBACK_MODEL} succeeded.`);
      } catch (fallbackErr) {
        console.error(`[vision] Fallback model also failed: ${fallbackErr.message}`);
      }
    }

    if (args.json) {
      console.log(JSON.stringify({
        images: args.images,
        mode: args.mode,
        model: VISION_MODEL,
        backend: usedBackend,
        fallback_used: usedBackend.includes('fallback'),
        analysis: analysis,
      }, null, 2));
    } else {
      console.log(analysis);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
