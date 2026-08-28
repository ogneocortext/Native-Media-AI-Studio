#!/usr/bin/env node
/**
 * Vision Analysis Script for Native Media AI Studio
 * Routes images through local Ollama vision model for analysis.
 * 
 * Usage:
 *   node scripts/vision/analyze.mjs <image_path> ["custom prompt"]
 *   node scripts/vision/analyze.mjs <image_path> <source_code> --prompt "does this match?"
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
const VISION_MODEL = process.env.VISION_MODEL || 'qwen3-vl:4b';
const VISION_MAX_DIM = parseInt(process.env.VISION_MAX_DIM || '1024');
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
      return `Analyze this music video frame${section} for:
1. COMPOSITION: Is the subject well-framed? Apply rule of thirds. Is there depth (foreground, midground, background)?
2. LIGHTING: What is the mood created by lighting? Is it consistent with a${section || ' music video'} section?
3. COLOR: What is the dominant color palette? Does it match the intended mood?
4. ENERGY: On a scale of 1-10, how energetic does this frame feel? Is that appropriate${section}?
5. IMPACT: What is the strongest visual element? What draws the eye first?
6. ISSUES: What are the top 3 things that could be improved?
7. BEAT SYNC: Would this frame work for a hard cut on a beat? Why or why not?`;
    case 'responsive':
      return 'Analyze this UI for responsive layout issues. Check if elements fit within the viewport, text is readable, and layout adapts well. List top 3 issues.';
    case 'regression':
      return 'Compare this render against the provided source code. Identify any visual discrepancies, missing elements, or layout issues. List top 3 fixes.';
    case 'compare':
      return 'Compare these two images. Identify differences, improvements, or regressions. Summarize the key changes.';
    case 'consistency':
      return 'Analyze these frames for consistency. Check if the color palette, lighting style, and visual grammar are consistent across all frames. Identify any jarring transitions or inconsistencies.';
    default:
      return 'Describe this scene in detail. What objects are present? What is the lighting quality like? What materials are visible? What is the overall composition and mood?';
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
    console.error('Usage: node scripts/vision/analyze.mjs <image_path> ["prompt"] [options]');
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
