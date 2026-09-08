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
const VISION_MODEL = process.env.VISION_MODEL || 'gemma4:e2b-it-qat';
const VISION_MAX_DIM = parseInt(process.env.VISION_MAX_DIM || '1280');
const VISION_QUALITY = parseInt(process.env.VISION_QUALITY || '80');

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
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mode' && argv[i + 1]) { args.mode = argv[++i]; }
    else if (arg === '--viewport' && argv[i + 1]) { args.viewport = argv[++i]; }
    else if (arg === '--label' && argv[i + 1]) { args.label = argv[++i]; }
    else if (arg === '--context' && argv[i + 1]) { args.context = argv[++i]; }
    else if (arg === '--prompt' && argv[i + 1]) { args.prompt = argv[++i]; }
    else if (arg === '--section' && argv[i + 1]) { args.section = argv[++i]; }
    else if (arg === '--low') { args.low = true; }
    else if (arg === '--high') { args.high = true; }
    else if (arg === '--json') { args.json = true; }
    else if (arg === '--source' && argv[i + 1]) { args.sourceFiles.push(argv[++i]); }
    else if (!arg.startsWith('--')) {
      if (!args.prompt && args.images.length > 0) {
        args.prompt = arg;
      } else if (fs.existsSync(arg)) {
        args.images.push(arg);
      }
    }
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
      return `You are a professional music-video director reviewing a rendered frame${section}.

Evaluate this frame against broadcast-quality standards:
1. COMPOSITION: Rule of thirds, leading lines, head room, look room, depth layers (foreground/midground/background)
2. LIGHTING: Key light, rim light, color temperature consistency, exposure balance
3. COLOR: Dominant palette, mood alignment, saturation vs. intended genre${section}
4. ENERGY: Rate 1-10. Is this appropriate${section}?
5. IMPACT: Strongest visual element and first gaze target
6. ISSUES: Top 3 improvements ranked by impact
7. BEAT SYNC: Would this frame cut cleanly on a strong beat? Why or why not?`;

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

async function analyzeWithOllama(images, prompt) {
  const imageData = await Promise.all(images.map(encodeImage));
   
  const body = {
    model: VISION_MODEL,
    prompt: prompt,
    images: imageData,
    stream: false,
    options: {
      temperature: 0.3,
      num_predict: 1024,
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
  return result.response;
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
  if (args.viewport) console.error(`Viewport: ${args.viewport}`);

  try {
    const analysis = await analyzeWithOllama(args.images, fullPrompt);
    
    if (args.json) {
      console.log(JSON.stringify({
        images: args.images,
        mode: args.mode,
        model: VISION_MODEL,
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
