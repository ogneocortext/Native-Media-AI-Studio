#!/usr/bin/env node
/**
 * Capture screenshots of the visualization / audio-driven routes.
 * Usage: node tests/browser/polish-audit-av-shots.mjs [baseUrl]
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const base = process.argv[2] || "http://127.0.0.1:5173";
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "out", "polish");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--enable-unsafe-swiftshader"],
});
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 900 } })
).newPage();

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

// 1. Visualizer — idle (no track)
await page.goto(`${base}/visualizer`, { waitUntil: "domcontentloaded", timeout: 20000 });
await sleep(4000);
await page.screenshot({ path: path.join(out, "av-visualizer-idle.png") });
console.log("shot av-visualizer-idle");

// 2. Visualizer — with a track selected + playing
try {
  const trackSelect = page.locator("select").first();
  const options = await trackSelect.locator("option").allTextContents();
  console.log("track options:", options.slice(0, 5));
  // pick the first real track (skip "Demo Mode" / empty)
  const idx = options.findIndex((o) => o && !o.toLowerCase().includes("demo") && !o.toLowerCase().includes("none"));
  if (idx > 0) {
    await trackSelect.selectOption({ index: idx });
    await sleep(3000);
    // press play
    const playBtn = page.locator('button[aria-label*="Play"], button:has-text("Play")').first();
    await playBtn.click({ timeout: 3000 }).catch(() => {});
    await sleep(3000);
  }
} catch (e) {
  console.log("track select failed:", e.message);
}
await page.screenshot({ path: path.join(out, "av-visualizer-playing.png") });
console.log("shot av-visualizer-playing");

// 3. Kinetic typography — with library track playing
await page.goto(`${base}/kinetic-typography`, { waitUntil: "domcontentloaded", timeout: 20000 });
await sleep(3500);
try {
  const libSelect = page.locator('select[aria-label*="lyric library"], select[aria-label*="Lyric library"]').first();
  await libSelect.selectOption({ index: 1 }).catch(() => {});
  await sleep(2500);
  const playBtn = page.locator('button:has-text("Play")').first();
  await playBtn.click({ timeout: 3000 }).catch(() => {});
  await sleep(3000);
} catch (e) {
  console.log("kt play failed:", e.message);
}
await page.screenshot({ path: path.join(out, "av-kinetic-playing.png") });
console.log("shot av-kinetic-playing");

// 4. Three.js studio — with track + preview playing
await page.goto(`${base}/three-js-studio`, { waitUntil: "domcontentloaded", timeout: 20000 });
await sleep(4000);
try {
  const previewBtn = page.locator('button[title*="Preview"], button:has-text("Preview")').first();
  await previewBtn.click({ timeout: 3000 }).catch(() => {});
  await sleep(3000);
} catch (e) {
  console.log("studio preview failed:", e.message);
}
await page.screenshot({ path: path.join(out, "av-studio-playing.png") });
console.log("shot av-studio-playing");

console.log("\nConsole errors:", consoleErrors.length ? consoleErrors.slice(0, 10) : "none");
await browser.close();
