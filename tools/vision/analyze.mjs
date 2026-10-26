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
 *   --low (768px, faster, worse for text)
 *   --high (1600px, text-dense detail)
 *   --json (machine-readable output)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { baseName, encodeImage, residentVisionModels, pickFallbackModel, VISION_MAX_DIM, VISION_QUALITY, VISION_KEEP_ALIVE, VISION_NUM_CTX, DEFAULT_VISION_MODEL } from './vision-common.mjs';
import { buildGemma4Prompt, GEMMA4_SYSTEM, GEMMA4_MODE_PROMPTS } from './prompts/gemma4-ui.mjs';
import { buildQwen35Prompt, QWEN35_UI_PROMPT, QWEN35_MODE_PROMPTS, QWEN35_THINKING_CONFIG } from './prompts/qwen35-ui.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// Configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const ATOMIC_CHAT_URL = process.env.ATOMIC_CHAT_URL || 'http://localhost:1337';
const ATOMIC_CHAT_ENABLED = (process.env.ATOMIC_CHAT_ENABLED || 'false').toLowerCase() === 'true';
const VISION_TIMEOUT_MS = parseInt(process.env.VISION_TIMEOUT_MS || '300000');
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
// VRAM safety threshold: warn above 70%, abort above 85% (leaves headroom for
// the model itself, which can be 4-6 GB on an 8 GB card).
const VRAM_WARN_PCT = parseInt(process.env.VISION_VRAM_WARN_PCT || '70');
const VRAM_ABORT_PCT = parseInt(process.env.VISION_VRAM_ABORT_PCT || '85');

// --- Task → model routing -------------------------------------------------
// One prompt skeleton serves all models; what differs per model is sampling
// and limits (temperature, context, resolution). Modes map to the model
// whose strengths fit the task; resident-model stickiness (below) avoids a
// cold load when a capable model is already warm — a switch costs 30-60s,
// more than any prompt tweak saves.
const MODEL_PROFILES = {
  'gemma4:e2b-it-qat':   { temp: 0.3, tempExtract: 0, numCtx: 8192,  maxDim: 1568, note: 'detailed audits', jsonOutput: true, controlTokens: true },
  // qwen3.5 via Atomic Chat (port 1337): hybrid-thinking, strong spatial/reasoning.
  // Structured JSON output NOT supported when thinking enabled → use text output.
  'unsloth/Qwen3_5-4B-GGUF-Qwen3_5-4B-Q4_K_M': { temp: 0.3, tempExtract: 0, numCtx: 8192,  maxDim: 1280, note: 'resident fallback, reasoning model', jsonOutput: false, thinking: true },
  'qwen3.5:4b':          { temp: 0.3, tempExtract: 0, numCtx: 8192,  maxDim: 1280, note: 'resident fallback, reasoning model', jsonOutput: false, thinking: true },
};
const DEFAULT_PROFILE = { temp: 0.3, tempExtract: 0, numCtx: VISION_NUM_CTX, maxDim: 1568, note: 'generic', jsonOutput: true };

// Extractive modes want trustworthiness over flair. The qwen3-vl family
// is a reasoning model that puts its ENTIRE answer in the `thinking`
// field and returns empty `content` for these prompts (measured:
// qwen3-vl:2b at num_predict 4096 -> 70 s, done_reason "length",
// content 0 chars, thinking 11775 chars), so every analysis mode that
// reads `content` routes to gemma4:e2b-it-qat instead — it terminates
// cleanly (done_reason "stop", real content) and is ~3x faster.
// compare/multicomp are multi-image but gemma4 handles that fine at
// num_ctx 8192; the degenerate-thinking fallback below still catches
// any model that comes back empty.
const MODE_MODEL = {
  ocr: 'gemma4:e2b-it-qat',
  table: 'gemma4:e2b-it-qat',
  chart: 'gemma4:e2b-it-qat',
  ui: 'gemma4:e2b-it-qat',
  responsive: 'gemma4:e2b-it-qat',
  regression: 'unsloth/Qwen3_5-4B-GGUF-Qwen3_5-4B-Q4_K_M',
  compare: 'unsloth/Qwen3_5-4B-GGUF-Qwen3_5-4B-Q4_K_M',
  multicomp: 'unsloth/Qwen3_5-4B-GGUF-Qwen3_5-4B-Q4_K_M',
  'music-video': 'unsloth/Qwen3_5-4B-GGUF-Qwen3_5-4B-Q4_K_M',
  depth: 'unsloth/Qwen3_5-4B-GGUF-Qwen3_5-4B-Q4_K_M',
  consistency: 'unsloth/Qwen3_5-4B-GGUF-Qwen3_5-4B-Q4_K_M',
};

function profileFor(model) {
  return MODEL_PROFILES[model] || DEFAULT_PROFILE;
}

// Resolve which model serves this call:
//   1. explicit --model flag (or VISION_MODEL env) always wins;
//   2. mode-mapped model when it is resident or nothing vision-capable is;
//   3. otherwise the resident model (cold loads cost more than any match gain).
async function resolveModel(args, forcedModel, backend = 'auto') {
  if (forcedModel) return { model: forcedModel, why: 'override' };
  // When targeting Atomic Chat, route to its resident model instead of Ollama's.
  if (backend === 'atomic') {
    if (await isAtomicChatReady()) {
      return { model: atomicChatModelsCache[0], why: 'atomic-chat-resident' };
    }
    // Atomic Chat not ready; fall through to Ollama routing below.
  }
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

/**
 * Query the backend's VRAM status endpoint before starting a vision analysis.
 * Returns null if the backend is unreachable (caller decides whether to proceed).
 */
async function fetchVRAMStatus() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/integrations/vram/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

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
    skipVramCheck: false,
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
    else if (arg === '--skip-vram-check') { args.skipVramCheck = true; }
    else if (arg === '--model' && argv[i + 1]) { args.model = argv[++i]; }
    else if (arg === '--think') { args.think = true; }
    else if (!arg.startsWith('--')) {
      // Files always win: an existing path is an image, never prompt text.
      // (The old order swallowed the 2nd+ image path as the prompt and dropped
      // the real prompt silently — this broke multi-image and MCP compare.)
      // Files always win: an existing path is an image, never prompt text.
      // (The old order swallowed the 2nd+ image path as the prompt and dropped
      // the real prompt silently — this broke multi-image and MCP compare.)
      // statSync.isFile() so a directory arg is treated as text instead of
      // blowing up mid-run with EISDIR inside encodeURIComponent path.
      let isFile = false;
      try {
        isFile = fs.existsSync(arg) && fs.statSync(arg).isFile();
      } catch {
        isFile = false;
      }
      if (isFile) {
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

function buildPrompt(args, activeModel) {
  if (args.prompt) return args.prompt;

  const section = args.section ? ` for a ${args.section} section` : '';
  const profile = profileFor(activeModel);
  const isQwen35 = activeModel.includes('Qwen3_5') || activeModel.includes('qwen3.5');
  const isGemma4 = activeModel.includes('gemma4');

  if (isQwen35) {
    return buildQwen35Prompt(args.mode);
  }

  if (isGemma4) {
    return buildGemma4Prompt(args.mode, {
      label: args.label,
      section: args.section,
      context: args.context,
      viewport: args.viewport,
    });
  }

  // Fallback to original inline prompts for unknown models
  const fallbackPrompts = {
    ocr: `Transcribe all visible text preserving original line breaks, punctuation, and reading order. If a table is present, convert it to markdown. If a region is unclear write [unclear]. Do NOT invent text.`,
    table: `Convert the table in this image to markdown, preserving headers, rows, and alignment. Keep numbers and text exactly as shown. If no table exists reply "No table detected."`,
    chart: `Describe the trend shown in this chart. Name axes, units, and relative heights. Compare bars/lines, note peaks/valleys, and flag any value that is ambiguous as "estimated". Do NOT invent exact numbers if labels are missing — say "unclear".`,
    multicomp: `You are given two UI screenshots: first is BEFORE, second is AFTER. List every visual difference: layout shifts, color changes, text differences, missing/added elements, sizing, and spacing. Be exhaustive.`,
    responsive: `You are a senior frontend engineer auditing a Native Media AI Studio UI screenshot. Report ONLY actionable findings: 1. VIEWPORT FIT 2. TOUCH TARGETS 3. READABILITY 4. NAVIGATION 5. FIX. CONSTRAINTS: Only report what is actually visible.`,
    regression: `You are a code reviewer comparing a rendered UI against its source implementation. For each discrepancy: WHAT CHANGED, SEVERITY, FIX, CONFIDENCE.`,
    compare: `You are a design lead comparing two versions of a Native Media AI Studio screen. For every difference: LOCATION, CHANGE, IMPACT, FIX/PROMOTE.`,
    depth: `Rate each depth cue 1-10: SIZE GRADIENT, OVERLAP, ATMOSPHERIC PERSPECTURE, PARALLAX, FOCUS/BLUR, LIGHTING DEPTH, COLOR DEPTH.`,
    consistency: `Audit for COLOR PALETTE DRIFT, TYPOGRAPHY, ASSET REUSE, SCENE CONTINUITY. Recommend: keep / recut / reframe.`,
    ui: `You are a senior frontend engineer auditing a Native Media AI Studio UI screenshot. Do NOT give generic descriptions. Give ONLY actionable feedback organized as: 1. ELEMENTS 2. TEXT 3. LAYOUT 4. ERRORS 5. NEXT_ACTION.`,
  };
  return (fallbackPrompts[args.mode] || fallbackPrompts.ui) + GROUNDING_SUFFIX;
}

function buildMetadata(args) {
  const parts = [];
  if (args.viewport) parts.push(`Viewport: ${args.viewport}`);
  if (args.label) parts.push(`Screen: ${args.label}`);
  if (args.section) parts.push(`Song Section: ${args.section}`);
  if (args.context) parts.push(`Context: ${args.context}`);
  return parts.length > 0 ? `\n\n---\n${parts.join('\n')}` : '';
}

function toAtomicChatModel(model, knownModels = atomicChatModelsCache) {  if (!model || typeof model !== 'string') return model;
  if (model.startsWith('ollama/')) return model;

  // Normalize for comparison: lowercase, strip non-alphanumeric.
  const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = normalize(model);

  // Try to match the requested model against Atomic Chat's actual resident models.
  // Atomic Chat IDs look like "unsloth/Qwen3_5-4B-GGUF-Qwen3_5-4B-Q4_K_M"
  // while callers pass "qwen3.5:4b" — direct string equality won't work.
  if (knownModels && knownModels.length > 0) {
    // 1. Exact normalized match.
    for (const km of knownModels) {
      if (normalize(km) === target) return km;
    }
    // 2. Substring match either direction (covers partial names like "qwen3.5:4b"
    //    matching "unsloth/Qwen3_5-4B-GGUF-Qwen3_5-4B-Q4_K_M").
    for (const km of knownModels) {
      const kn = normalize(km);
      if (kn.includes(target) || target.includes(kn)) return km;
    }
  }

  // Fall back to the ollama/ prefix conversion (may 404 if Atomic Chat lacks it).
  if (model.includes(':')) {
    return `ollama/${model.replace(/:/g, '-')}`;
  }
  return model;
}

function looksTruncated(text) {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (trimmed.length < 200) return true;
  const endsProperly = /[.!?"')}\]]$/.test(trimmed);
  if (!endsProperly) return true;
  if (trimmed.endsWith('...')) return true;
  return false;
}

let atomicChatReadyCachedAt = 0;
let atomicChatReady = false;
let atomicChatModelsCache = [];

async function isAtomicChatReady() {
  const now = Date.now();
  if (atomicChatReadyCachedAt && now - atomicChatReadyCachedAt < ATOMIC_CHAT_READY_CACHE_TTL_MS) {
    return atomicChatReady;
  }

  // Per-request signals, not one shared controller: the single-controller
  // version clearTimeout'd the models-check timer before dispatching the
  // probe POST, so the probe ran with no signal at all and a hung server
  // hung this check indefinitely. Negative results are cached too — a TIMED
  // probe per analyze call, on every call to a dead server, added up.
  try {
    const modelsRes = await fetch(`${ATOMIC_CHAT_URL}/v1/models`, { signal: AbortSignal.timeout(4000) });
    if (!modelsRes.ok) {
      atomicChatReady = false;
      return atomicChatReady;
    }
    const modelsJson = await modelsRes.json();
    const models = Array.isArray(modelsJson?.data) ? modelsJson.data : [];
    atomicChatModelsCache = models.map((m) => m.id);
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
      signal: AbortSignal.timeout(8000),
    });
    atomicChatReady = probe.ok;
  } catch (e) {
    atomicChatReady = false;
  } finally {
    atomicChatReadyCachedAt = Date.now();
  }
  return atomicChatReady;
}

async function analyzeWithOllama(images, prompt, model, numPredict = 1024, encOpts = {}, think = false, keepAlive = VISION_KEEP_ALIVE) {
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
    // The primary model stays resident per its default keep_alive; fallback
    // attempts pass a short one so the 8 GB card returns to a single vision
    // model once the request is served (two 4 GB models resident squeeze
    // each other with the desktop already holding ~5 GB).
    keep_alive: keepAlive,
    options: {
      temperature: encOpts.extractMode ? profile.tempExtract : profile.temp,
      num_predict: numPredict,
      num_ctx: profile.numCtx,
    }
  };

  // Gemma 4: native JSON structured output — reliable machine-readable results.
  // Qwen3.5: structured JSON NOT supported when thinking enabled → text output.
  if (profile.jsonOutput) {
    body.format = 'json';
  }

  // Ollama 0.21.3+ supports think parameter for reasoning models.
  // Values: true/false/"max"/"high"/"medium"/"low"/"minimal"/"none".
  if (think || profile.thinking) {
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

  // Reasoning-capable vision models (qwen3-vl, minicpm-v) can spend the entire
  // output budget on chain-of-thought and return `done_reason: "length"` with an
  // EMPTY `content`, putting everything in a separate `thinking` field.
  // Measured on this machine (8 GB card, desktop holding ~5 GB):
  //   qwen3-vl:2b  content  39 chars, 277 tok, done_reason "stop"   -> fine
  //   qwen3-vl:4b  content   0 chars, 768 tok, thinking 2331 chars -> "empty analysis"
  //   gemma4-vision-optimized  content 80 chars but 768 tok, "length" (verbose)
  // Reading only `content` turned the second row into "all backends returned empty
  // analysis" and, because DEFAULT and FALLBACK were both qwen3-vl:2b, the retry
  // re-ran the same path. Note `think: false` does NOT help - qwen3-vl:4b still
  // emitted 2114 chars of thinking with a zero-length content at the same budget.
  //
  // Thinking is a worse answer than content, but a far better answer than nothing,
  // so fall back to it and tell the caller which one it is reading.
  const content = result.message?.content || result.response || "";
  const thinking = result.message?.thinking || "";
  const usedThinking = !content.trim() && !!thinking.trim();
  const text = usedThinking ? thinking : content;
  if (usedThinking) {
    console.error(
      `[vision] ${model}: content empty (done_reason=${result.done_reason || "?"}); ` +
        `using ${thinking.length} chars of thinking output as the analysis.`
    );
  }
  return { text, done_reason: result.done_reason || '', fromThinking: usedThinking };
}

async function analyzeWithAtomicChat(images, prompt, model, maxTokens = 4096, encOpts = {}) {
  if (!(await isAtomicChatReady())) {
    throw new Error('Atomic Chat local API is not ready');
  }

  const imageData = await Promise.all(images.map((p) => encodeImage(p, encOpts)));
  const profile = profileFor(model);
  const isQwen35 = model.includes('Qwen3_5') || model.includes('qwen3.5');

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

  // Qwen3.5 hybrid-thinking: enable reasoning for complex UI analysis.
  // Structured JSON output NOT supported when thinking enabled → text output.
  if (isQwen35 || profile.thinking) {
    body.enable_thinking = true;
    body.thinking_budget = profile.thinking_budget ?? QWEN35_THINKING_CONFIG.thinking_budget;
  }

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
  const message = result?.choices?.[0]?.message;
  const content = message?.content || '';
  const reasoning = message?.reasoning_content || '';
  // Qwen3.5 hybrid-thinking: reasoning goes in reasoning_content, final answer in content.
  // Prefer content when present; fall back to reasoning for detailed breakdowns.
  const text = content.trim() ? content : reasoning.trim();
  return typeof text === 'string' ? text : '';
}

/**
 * Convert raw model analysis text into a human-friendly, colorized,
 * section-separated render. Keeps structured JSON available via --json.
 */
function renderHumanFriendly(analysis, model) {
  const trimmed = (analysis || '').trim();
  if (!trimmed) return '';

  const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
  };

  const bar = `${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`;
  const out = [];
  out.push(`${bar}`);
  out.push(`${C.bold}${C.white}  VISION ANALYSIS — ${model}${C.reset}`);
  out.push(`${bar}`);

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    renderJsonSections(parsed, C, out);
  } else {
    renderTextSections(trimmed, C, out);
  }

  return out.join('\n');
}

function renderJsonSections(obj, C, out) {
  const sections = [
    { key: 'elements', title: 'ELEMENTS', color: C.blue },
    { key: 'layout', title: 'LAYOUT', color: C.green },
    { key: 'typography', title: 'TYPOGRAPHY', color: C.yellow },
    { key: 'color', title: 'COLOR', color: C.magenta },
    { key: 'affordances', title: 'AFFORDANCES', color: C.cyan },
    { key: 'empty_states', title: 'EMPTY STATES', color: C.dim },
    { key: 'findings', title: 'FINDINGS', color: C.red },
    { key: 'top_3_fixes', title: 'TOP 3 FIXES', color: C.red },
  ];

  for (const { key, title, color } of sections) {
    if (!(key in obj)) continue;
    const val = obj[key];
    out.push(`\n${color}${C.bold}▶ ${title}${C.reset}`);
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'object' && item !== null) {
          const bits = [];
          for (const [k, v] of Object.entries(item)) {
            if (v !== null && v !== undefined) bits.push(`${C.dim}${k}:${C.reset} ${v}`);
          }
          out.push(`  • ${bits.join(' | ')}`);
        } else {
          out.push(`  • ${item}`);
        }
      }
    } else if (typeof val === 'object' && val !== null) {
      for (const [k, v] of Object.entries(val)) {
        out.push(`  ${C.dim}${k}:${C.reset} ${v}`);
      }
    } else {
      out.push(`  ${val}`);
    }
  }
}

function renderTextSections(text, C, out) {
  const parts = text.split(/^=== (.+) ===$/m);
  if (parts.length <= 1) {
    out.push(text);
    return;
  }

  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i].trim();
    const content = (parts[i + 1] || '').trim();
    if (!content) continue;

    out.push(`\n${C.bold}${C.cyan}━ ${title} ━${C.reset}`);

    const lines = content.split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t) { out.push(''); continue; }

      const sev = t.match(/\[SEVERITY:\s*(\w+)\]/i);
      if (sev) {
        const s = sev[1].toLowerCase();
        const color = s === 'critical' ? C.red : s === 'minor' ? C.yellow : C.green;
        const clean = t.replace(/\[SEVERITY:\s*\w+\]/i, '').trim();
        out.push(`  ${color}[${sev[1].toUpperCase()}]${C.reset} ${clean}`);
        continue;
      }

      if (/^\d+\.\s/.test(t)) {
        out.push(`  ${C.bold}${C.magenta}${t}${C.reset}`);
        continue;
      }

      if (t.startsWith('-') || t.startsWith('•')) {
        out.push(`  ${C.dim}•${C.reset} ${t.replace(/^[•\-]\s*/, '')}`);
        continue;
      }

      const m = t.match(/^\*\*([^*]+)\*\*(.*)$/);
      if (m) {
        out.push(`  ${C.bold}${C.white}${m[1]}${C.reset}${C.dim}${m[2]}${C.reset}`);
        continue;
      }

      out.push(`  ${t}`);
    }
  }
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
  console.error('  --model name  (override task→model routing, e.g. qwen3.5:4b)');
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

  // VRAM preflight check — protect the 8 GB card from compounding model loads.
  // Skip only with --skip-vram-check or VISION_SKIP_VRAM_CHECK=1.
  if (!args.skipVramCheck && process.env.VISION_SKIP_VRAM_CHECK !== '1') {
    const vram = await fetchVRAMStatus();
    if (vram) {
      const v = vram.vram || vram;
      const pct = v.percent ?? 0;
      const freeMb = v.free_mb ?? 0;
      const totalMb = v.total_mb ?? 0;
      const usedMb = v.used_mb ?? 0;
      console.error(`[vision] VRAM: ${usedMb}MB / ${totalMb}MB (${pct}%), free ${freeMb}MB`);
      if (pct >= VRAM_ABORT_PCT && !args.skipVramCheck) {
        console.error(`[vision] ERROR: VRAM at ${pct}% >= abort threshold ${VRAM_ABORT_PCT}%. ` +
          `Free GPU memory first (POST /api/integrations/vram/offload-ollama) ` +
          `or use --skip-vram-check to override.`);
        process.exit(1);
      }
      if (pct >= VRAM_WARN_PCT) {
        console.error(`[vision] WARNING: VRAM at ${pct}% >= warn threshold ${VRAM_WARN_PCT}%. ` +
          `Model load may fail or force eviction of other resident models.`);
      }
    } else {
      console.error('[vision] WARNING: Could not reach backend VRAM status endpoint — proceeding blind.');
    }
  }

  // Encode settings: text-dense modes get higher resolution (reading needs
  // pixels), extractive modes get deterministic temperature. --low/--high win.
  // The active model's profile caps resolution (bigger is not better past a
  // model's native patches) and sets sampling + context per its strengths.
  const forcedModel = args.model || process.env.VISION_MODEL || null;
  const { model: activeModel, why: modelWhy } = await resolveModel(args, forcedModel, args.backend);
  const profile = profileFor(activeModel);
  const textMode = TEXT_MODES.has(args.mode);
  const maxDim = args.low ? 768 : args.high ? 1600 : textMode ? Math.max(VISION_MAX_DIM, 1568) : VISION_MAX_DIM;
  const encOpts = {
    maxDim: Math.min(maxDim, profile.maxDim, 2048),
    quality: EXTRACT_MODES.has(args.mode) ? 85 : VISION_QUALITY,
    pngPassthrough: textMode && !args.low,
    extractMode: EXTRACT_MODES.has(args.mode),
  };

  const prompt = buildPrompt(args, activeModel);
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
    // True when the last Ollama attempt returned EMPTY content and we
    // fell back to its `thinking` field — the signature of the
    // qwen3-vl reasoning-loop bug (ollama/ollama#17978): the model
    // exhausts num_predict re-evaluating and never emits content.
    let lastFromThinking = false;
    // Auto-enable reasoning for complex analysis modes on capable models.
    const reasoningModes = new Set(['compare', 'music-video', 'regression', 'multicomp']);
    const autoThink = args.think || reasoningModes.has(args.mode);
    const ollamaAttempt = async (model, budget, keepAlive) => {
      const r = await analyzeWithOllama(args.images, fullPrompt, model, budget, encOpts, autoThink, keepAlive);
      lastDoneReason = r.done_reason;
      lastFromThinking = !!r.fromThinking;
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

    // A reasoning model that returned EMPTY content (its whole answer
    // landed in `thinking`, lastFromThinking) is degenerate, not
    // truncated: re-rolling the same model at the same 4096 budget
    // reproduces the same reasoning loop (measured: qwen3-vl:2b ->
    // 70 s, content 0 chars, every time; the streaming early-abort
    // + resume workaround from ollama/ollama#17978 also fails to
    // converge on structured prompts). Skip the same-model retry and
    // go straight to the fallback model. Only a NON-empty answer
    // that hit the output budget is worth a re-roll (sampling may
    // stop earlier).
    const emptyDegenerate =
      lastFromThinking || typeof analysis !== 'string' || !analysis.trim();
    if (needsMore(analysis) && !emptyDegenerate) {
      console.error(`[vision] Response hit output budget, retrying ${activeModel}...`);
      try {
        await ollamaAttempt(activeModel, 4096);
        usedBackend += '+retry4096';
        console.error(`[vision] Budget-escalated retry succeeded.`);
      } catch (retryErr) {
        console.error(`[vision] Budget-escalated retry failed: ${retryErr.message}`);
      }
    }

    if (needsMore(analysis)) {
      // Fallback is resolved live: minicpm-v:8b was pruned from this
      // workstation, so the old hardcoded constant 404'd on every fallback
      // attempt. pickFallbackModel prefers VISION_FALLBACK_MODEL, then any
      // other resident vision model.
      const fallbackModel = await pickFallbackModel(activeModel);
      if (fallbackModel && fallbackModel !== activeModel) {
        console.error(`[vision] Still truncated, retrying with ${fallbackModel}...`);
        try {
          // '2m' pin: frees the second model's VRAM slot shortly after the
          // result lands, returning to primary-only residency.
          await ollamaAttempt(fallbackModel, 4096, '2m');
          usedBackend = 'ollama-fallback-model';
          console.error(`[vision] Fallback model ${fallbackModel} succeeded.`);
        } catch (fallbackErr) {
          console.error(`[vision] Fallback model also failed: ${fallbackErr.message}`);
        }
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
        used_thinking: lastFromThinking,
        done_reason: lastDoneReason,
        analysis: ok ? analysis : '',
        error: ok ? undefined : 'empty-analysis',
      }, null, 2));
    } else if (ok) {
      console.log(renderHumanFriendly(analysis, activeModel));
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