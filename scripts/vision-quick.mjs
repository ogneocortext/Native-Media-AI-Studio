#!/usr/bin/env node
/**
 * Quick vision analysis — one screenshot through the local Ollama vision
 * model. Thin CLI plumbing only: image encoding, the /api/chat request,
 * response-shape handling and the thinking-field fallback all live in
 * tools/vision/vision-common.mjs (ollamaChat) — this script used to
 * re-implement the request and read `data.response` on a /api/chat call,
 * so it printed "No response" for every prompt (measured 2026-10-22).
 *
 * Usage: node scripts/vision-quick.mjs <image> [prompt]
 */

import fs from "fs";
import { encodeImage, analyzeWithOllama, DEFAULT_VISION_MODEL } from "../tools/vision/vision-common.mjs";

const imagePath = process.argv[2];
const prompt = process.argv[3] || "Describe what you see in this screenshot. Focus on layout, visual hierarchy, and any issues.";

if (!imagePath) {
  console.error("Usage: node scripts/vision-quick.mjs <image> [prompt]");
  process.exit(1);
}
if (!fs.existsSync(imagePath)) {
  console.error(`Error: Image not found: ${imagePath}`);
  process.exit(1);
}

const base64 = await encodeImage(imagePath);
console.error(`[vision] ${imagePath} -> ${DEFAULT_VISION_MODEL} (${Math.round((base64.length * 3) / 4 / 1024)}KB)`);
const reply = await analyzeWithOllama(base64, prompt, DEFAULT_VISION_MODEL);
if (reply) console.log(reply);
