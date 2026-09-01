#!/usr/bin/env node
/**
 * Quick vision analysis - reads image, resizes with sharp, sends to Ollama
 * Usage: node scripts/vision-quick.mjs <image> [prompt]
 */

import sharp from "sharp";
import fs from "fs";

const imagePath = process.argv[2];
const prompt = process.argv[3] || "Describe what you see in this screenshot. Focus on layout, visual hierarchy, and any issues.";

if (!imagePath) {
  console.error("Usage: node scripts/vision-quick.mjs <image> [prompt]");
  process.exit(1);
}

// Read and resize
const inputBuffer = fs.readFileSync(imagePath);
const resized = await sharp(inputBuffer)
  .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
  .jpeg({ quality: 80, mozjpeg: true })
  .toBuffer();

const base64 = resized.toString("base64");
console.error(`[vision] Resized to ${resized.length} bytes`);

// Send to Ollama
const response = await fetch("http://127.0.0.1:11434/api/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "gemma4:e2b-it-qat",
    prompt,
    images: [base64],
    stream: false,
    options: { temperature: 0.3, num_predict: 2048 },
  }),
});

const data = await response.json();
console.log(data.response || "No response");
