#!/usr/bin/env node
/**
 * Vision Analysis Script
 * 
 * Routes screenshots through the local Ollama vision model (gemma4-e2b).
 * Usage:
 *   node scripts/vision.mjs analyze <image> [prompt]     # Analyze an image
 *   node scripts/vision.mjs compare <a> <b> [prompt]    # Compare two images
 *   node scripts/vision.mjs diff <old> <new> [prompt]   # Diff two images
 * 
 * Options:
 *   --low          Resize to 640px max (sharpens text)
 *   --high         Resize to 1280px max
 *   --model <name> Override Ollama model (default: gemma4:e2b-it-qat)
 *   --quality <n>  JPEG quality 1-100 (default: 80)
 *   --raw          Skip metadata block
 *   --json         Machine-readable output
 *   --viewport WxH Intended viewport size
 *   --label <text> Screen label
 *   --context <text> Free-form context note
 *   --lines        Line-number attached source code
 *   --mode <mode>  ui|responsive|regression|compare
 * 
 * Environment:
 *   OLLAMA_URL     Ollama server URL (default: http://127.0.0.1:11434)
 *   VISION_MODEL   Default model (default: gemma4:e2b-it-qat)
 *   VISION_MAX_DIM Max dimension (default: 1024)
 *   VISION_QUALITY JPEG quality (default: 80)
 */

import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.VISION_MODEL || "gemma4:e2b-it-qat";
const MAX_DIM = parseInt(process.env.VISION_MAX_DIM || "1024", 10);
const JPEG_QUALITY = parseInt(process.env.VISION_QUALITY || "80", 10);

// ─── CLI Parsing ───
const args = process.argv.slice(2);
const command = args[0];
const options = {
  low: false,
  high: false,
  model: DEFAULT_MODEL,
  quality: JPEG_QUALITY,
  raw: false,
  json: false,
  viewport: null,
  label: null,
  context: null,
  lines: false,
  mode: "ui",
};

const positional = [];
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--low") options.low = true;
  else if (arg === "--high") options.high = true;
  else if (arg === "--model" && args[i + 1]) { options.model = args[++i]; }
  else if (arg === "--quality" && args[i + 1]) { options.quality = parseInt(args[++i], 10); }
  else if (arg === "--raw") options.raw = true;
  else if (arg === "--json") options.json = true;
  else if (arg === "--viewport" && args[i + 1]) { options.viewport = args[++i]; }
  else if (arg === "--label" && args[i + 1]) { options.label = args[++i]; }
  else if (arg === "--context" && args[i + 1]) { options.context = args[++i]; }
  else if (arg === "--lines") options.lines = true;
  else if (arg === "--mode" && args[i + 1]) { options.mode = args[++i]; }
  else if (!arg.startsWith("--")) positional.push(arg);
}

// ─── Image Processing ───
async function resizeImage(imagePath) {
  const maxDim = options.low ? 640 : options.high ? 1280 : MAX_DIM;
  
  // Read file as buffer first (avoids sharp file format detection issues)
  const inputBuffer = fs.readFileSync(imagePath);
  const buffer = await sharp(inputBuffer)
    .resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: options.quality, mozjpeg: true })
    .toBuffer();
  
  const stats = await sharp(buffer).metadata();
  return {
    buffer,
    base64: buffer.toString("base64"),
    width: stats.width,
    height: stats.height,
    sizeKB: Math.round(buffer.length / 1024),
  };
}

// ─── Ollama API ───
async function analyzeWithOllama(images, prompt, model) {
  const url = `${OLLAMA_URL}/api/generate`;
  
  const body = {
    model,
    prompt,
    images: images.map(img => img.base64),
    stream: false,
    options: {
      temperature: 0.3,
      num_predict: 2048,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.response || "No response from model";
}

// ─── Prompt Building ───
function buildPrompt(imageCount) {
  if (options.raw) return null;

  const parts = [];
  
  // Mode-specific context
  switch (options.mode) {
    case "responsive":
      parts.push("You are reviewing a webpage's responsive layout.");
      break;
    case "regression":
      parts.push("You are performing a visual regression review. Compare the screenshot against the intended design.");
      break;
    case "compare":
      parts.push("You are comparing two screenshots. Identify differences in layout, content, and styling.");
      break;
    default:
      parts.push("You are analyzing a screenshot of a web application.");
  }

  // Viewport context
  if (options.viewport) {
    parts.push(`Intended viewport: ${options.viewport}.`);
  }

  // Label context
  if (options.label) {
    parts.push(`Screen: ${options.label}.`);
  }

  // Free-form context
  if (options.context) {
    parts.push(options.context);
  }

  // Mode-specific instructions
  if (options.mode === "regression") {
    parts.push("End your analysis with a 'Top 3 fixes' list, most impactful first.");
  } else if (options.mode === "compare") {
    parts.push("List all differences found, organized by severity.");
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

// ─── Commands ───
async function analyze(imagePaths, customPrompt) {
  const images = [];
  for (const p of imagePaths) {
    if (!fs.existsSync(p)) {
      console.error(`Error: File not found: ${p}`);
      process.exit(1);
    }
    const img = await resizeImage(p);
    images.push(img);
    if (!options.json) {
      console.error(`[vision] Resized ${path.basename(p)} → ${img.width}x${img.height} (${img.sizeKB}KB)`);
    }
  }

  const defaultPrompt = images.length === 1
    ? "Describe what you see in this screenshot. Focus on layout, visual hierarchy, text readability, color scheme, and any UI issues."
    : "Compare these screenshots. Identify differences in layout, content, and styling.";
  
  const systemPrompt = buildPrompt(images.length);
  const prompt = systemPrompt
    ? `${systemPrompt}\n\n${customPrompt || defaultPrompt}`
    : customPrompt || defaultPrompt;

  const analysis = await analyzeWithOllama(images, prompt, options.model);
  
  if (options.json) {
    console.log(JSON.stringify({ analysis, images: images.map(i => ({ width: i.width, height: i.height, sizeKB: i.sizeKB })) }, null, 2));
  } else {
    console.log(analysis);
  }
}

async function compare(imagePaths, customPrompt) {
  options.mode = "compare";
  await analyze(imagePaths, customPrompt);
}

// ─── Main ───
async function main() {
  if (!command || !["analyze", "compare", "diff"].includes(command)) {
    console.log("Usage: node scripts/vision.mjs <analyze|compare|diff> <image> [image2] [prompt]");
    console.log("Run 'node scripts/vision.mjs --help' for full options.");
    process.exit(1);
  }

  const imagePaths = positional.filter(p => !p.startsWith("--") && fs.existsSync(p));
  const customPrompt = positional.find(p => !fs.existsSync(p) && !p.startsWith("--")) || null;

  if (imagePaths.length === 0) {
    console.error("Error: No valid image files provided.");
    process.exit(1);
  }

  try {
    switch (command) {
      case "analyze":
        await analyze(imagePaths, customPrompt);
        break;
      case "compare":
      case "diff":
        await compare(imagePaths, customPrompt);
        break;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
