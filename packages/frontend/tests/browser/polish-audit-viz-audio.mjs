#!/usr/bin/env node
/**
 * Capture the visualizer with audio actually playing (FX + 2D + 3D).
 * Usage: node tests/browser/polish-audit-viz-audio.mjs [baseUrl]
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

const errs = [];
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text());
});
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

await page.goto(`${base}/visualizer`, { waitUntil: "domcontentloaded", timeout: 20000 });
await sleep(4000);

const trackSelect = page.locator('select[data-testid="viz-track-select"]');
if ((await trackSelect.locator("option").count()) > 1) {
  await trackSelect.selectOption({ index: 1 });
  await sleep(4000);
}

// Press play
await page.locator('button[aria-label*="Play"]').first().click({ timeout: 3000 }).catch((e) => console.log("play:", e.message));
await sleep(4000);
const playing = await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label*="Play"]');
  return btn?.getAttribute("aria-label");
});
console.log("play state:", playing);
await page.screenshot({ path: path.join(out, "av-audio-fx.png") });
console.log("shot av-audio-fx");

// 2D with audio
await page.locator('button[aria-label*="Visualization mode"]').click();
await sleep(3500);
await page.screenshot({ path: path.join(out, "av-audio-2d.png") });
console.log("shot av-audio-2d");

// 3D with audio
await page.locator('button[aria-label*="Visualization mode"]').click();
await sleep(3500);
await page.screenshot({ path: path.join(out, "av-audio-3d.png") });
console.log("shot av-audio-3d");

console.log("errors:", errs.length ? errs.slice(0, 8) : "none");
await browser.close();
