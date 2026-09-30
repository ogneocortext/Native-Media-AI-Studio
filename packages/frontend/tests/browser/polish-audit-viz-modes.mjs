#!/usr/bin/env node
/**
 * Capture the visualizer in each mode (FX shader / 2D / 3D) with a track playing.
 * Usage: node tests/browser/polish-audit-viz-modes.mjs [baseUrl]
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

await page.goto(`${base}/visualizer`, { waitUntil: "domcontentloaded", timeout: 20000 });
await sleep(4000);

// Select a track via the native select
const trackSelect = page.locator('select[data-testid="viz-track-select"]');
const optCount = await trackSelect.locator("option").count();
console.log("track options:", optCount);
if (optCount > 1) {
  await trackSelect.selectOption({ index: 1 });
  await sleep(4000); // let analysis load
}

// Press play
const state = await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label*="Play"]');
  return { hasPlayBtn: !!btn, label: btn?.getAttribute("aria-label") };
});
console.log("play button:", state);
await page.locator('button[aria-label*="Play"]').first().click({ timeout: 3000 }).catch((e) => console.log("play click:", e.message));
await sleep(3500);
await page.screenshot({ path: path.join(out, "av-viz-fx-playing.png") });
console.log("shot av-viz-fx-playing");

// Switch to 2D mode
try {
  await page.locator("button[title*='2D'], button[aria-label*='2D']").first().click({ timeout: 2000 });
  await sleep(2500);
} catch {
  // fallback: use the mode select in the test panel — skip if not reachable
  console.log("2D button not found, trying mode cycle");
}
await page.screenshot({ path: path.join(out, "av-viz-2d-playing.png") });
console.log("shot av-viz-2d-playing");

// Switch to 3D mode
try {
  await page.locator("button[title*='3D'], button[aria-label*='3D']").first().click({ timeout: 2000 });
  await sleep(2500);
} catch {
  console.log("3D button not found");
}
await page.screenshot({ path: path.join(out, "av-viz-3d-playing.png") });
console.log("shot av-viz-3d-playing");

console.log("\nConsole errors:", consoleErrors.length ? consoleErrors.slice(0, 10) : "none");
await browser.close();
