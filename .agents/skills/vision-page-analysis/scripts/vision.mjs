#!/usr/bin/env node
/**
 * Vision Analysis Script
 * 
 * Analyzes screenshots using local Ollama vision model (gemma4:e2b-it-qat).
 * Supports: analyze, compare, diff modes.
 * 
 * Usage:
 *   node scripts/vision.mjs analyze <image> [prompt]
 *   node scripts/vision.mjs compare <img1> <img2>
 *   node scripts/vision.mjs diff <old> <new>
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.VISION_MODEL || 'gemma4:e2b-it-qat';

// Try to import sharp for image resizing
let sharp;
try {
  sharp = require('sharp');
} catch {
  // sharp not installed - will use raw image
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || !['analyze', 'compare', 'diff'].includes(command)) {
  console.error('Usage: node scripts/vision.mjs <analyze|compare|diff> [args]');
  console.error('  analyze <image> [prompt]   - Analyze a screenshot');
  console.error('  compare <img1> <img2>       - Compare two screenshots');
  console.error('  diff <old> <new>            - Diff two screenshots');
  process.exit(1);
}

// Parse options
function parseArgs(args) {
  const opts = { low: false, high: false, quality: 80, raw: false, model: DEFAULT_MODEL };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--low') opts.low = true;
    else if (args[i] === '--high') opts.high = true;
    else if (args[i] === '--raw') opts.raw = true;
    else if (args[i] === '--model' && args[i + 1]) { opts.model = args[++i]; }
    else if (args[i] === '--quality' && args[i + 1]) { opts.quality = parseInt(args[++i]); }
    else positional.push(args[i]);
  }
  return { opts, positional };
}

// Resize image using sharp
async function resizeImage(inputPath, opts) {
  if (!sharp) return inputPath;
  
  const maxDim = opts.low ? 640 : opts.high ? 1280 : 1024;
  const outputPath = inputPath.replace(/(\.[^.]+)$/, `-resized$1`);
  
  await sharp(inputPath)
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: opts.quality })
    .toFile(outputPath);
  
  return outputPath;
}

// Read image as base64
function readImageBase64(path) {
  const buffer = readFileSync(path);
  return buffer.toString('base64');
}

// Call Ollama vision API
async function callOllama(model, prompt, imageBase64) {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      images: [imageBase64],
      stream: false,
      options: { temperature: 0.3, num_predict: 1024 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.response;
}

// Check if Ollama is running
async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

// Main analysis
async function analyze(imagePath, customPrompt, opts) {
  if (!existsSync(imagePath)) {
    console.error(`Image not found: ${imagePath}`);
    process.exit(1);
  }

  const resized = await resizeImage(imagePath, opts);
  const imageBase64 = readImageBase64(resized);

  const prompt = opts.raw ? customPrompt || '' : `You are a UI/UX design expert reviewing a web application screenshot.

${customPrompt || 'Analyze this page for UX issues, visual hierarchy, layout problems, and design improvements.'}

Focus on:
- Visual hierarchy and readability
- Spacing and alignment
- Color contrast and accessibility
- Component organization
- User flow clarity
- Any visual bugs or glitches

Provide specific, actionable feedback.`;

  const result = await callOllama(opts.model, prompt, imageBase64);
  console.log(result);
  return result;
}

// Compare two images
async function compare(img1Path, img2Path, opts) {
  if (!existsSync(img1Path) || !existsSync(img2Path)) {
    console.error('One or both images not found');
    process.exit(1);
  }

  const [resized1, resized2] = await Promise.all([
    resizeImage(img1Path, opts),
    resizeImage(img2Path, opts),
  ]);

  const [base641, base642] = [readImageBase64(resized1), readImageBase64(resized2)];

  const prompt = `Compare these two UI screenshots. The first is the original, the second is the updated version.

Identify:
1. What changed between the two versions
2. Whether the changes improve or worsen the UX
3. Any new issues introduced
4. What could be further improved

Be specific and actionable.`;

  // Send both images
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      prompt,
      images: [base641, base642],
      stream: false,
      options: { temperature: 0.3, num_predict: 1024 },
    }),
  });

  if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
  const data = await response.json();
  console.log(data.response);
}

// Diff two images (visual regression)
async function diff(oldPath, newPath, opts) {
  if (!existsSync(oldPath) || !existsSync(newPath)) {
    console.error('One or both images not found');
    process.exit(1);
  }

  const [resized1, resized2] = await Promise.all([
    resizeImage(oldPath, opts),
    resizeImage(newPath, opts),
  ]);

  const [base641, base642] = [readImageBase64(resized1), readImageBase64(resized2)];

  const prompt = `These are two versions of a UI page. Identify all visual differences between them.

List:
1. Elements that moved, resized, or changed position
2. Color or style changes
3. New or removed elements
4. Layout shifts
5. Any visual regressions

Be exhaustive and specific about locations.`;

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      prompt,
      images: [base641, base642],
      stream: false,
      options: { temperature: 0.2, num_predict: 1024 },
    }),
  });

  if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
  const data = await response.json();
  console.log(data.response);
}

// Run
async function main() {
  const { opts, positional } = parseArgs(args.slice(1));

  const ollamaReady = await checkOllama();
  if (!ollamaReady) {
    console.error(`Ollama is not reachable at ${OLLAMA_URL}`);
    console.error('Start Ollama first: ollama serve');
    process.exit(1);
  }

  switch (command) {
    case 'analyze': {
      const imagePath = positional[0];
      const customPrompt = positional.slice(1).join(' ');
      await analyze(imagePath, customPrompt, opts);
      break;
    }
    case 'compare': {
      await compare(positional[0], positional[1], opts);
      break;
    }
    case 'diff': {
      await diff(positional[0], positional[1], opts);
      break;
    }
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
