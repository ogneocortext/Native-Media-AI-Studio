#!/usr/bin/env node
/**
 * Capture the visualizer across all interaction states a real user would traverse.
 *
 * Usage: node tests/browser/capture-interaction-states.mjs [baseUrl] [outDir]
 *
 * States captured (in order):
 *   01-modal-closed       - base state after page load
 *   02-track-dropdown     - track selector dropdown open
 *   03-focus-bass         - focus tab "Bass" active
 *   04-focus-vocals       - focus tab "Vocals" active
 *   05-focus-highs        - focus tab "Highs" active
 *   06-genre-edm          - genre preset "EDM" selected
 *   07-genre-phonk-bass   - genre preset "Phonk / Bass" selected
 *   08-mode-3d            - visualization mode "3D" active
 *   09-mode-2d            - visualization mode "2D" active
 *
 * Each state is captured as a PNG for subsequent vision analysis.
 * Screenshots are written to <outDir>/<state>.png.
 *
 * VRAM safety: this script only captures screenshots. It does not load any
 * vision models. Run run-interaction-audit.mjs to analyze the captures
 * with VRAM-guarded model switching.
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const base = process.argv[2] || "http://127.0.0.1:5173";
const outDir = process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), "out", "interaction-states");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Interaction states: each step describes an action to perform before screenshot.
const states = [
  { id: "01-modal-closed",   action: "none",              desc: "Base state after page load" },
  { id: "02-track-dropdown", action: "open-track-dropdown", desc: "Track selector dropdown open" },
  { id: "03-focus-bass",     action: "focus-bass",        desc: "Focus tab Bass active" },
  { id: "04-focus-vocals",   action: "focus-vocals",      desc: "Focus tab Vocals active" },
  { id: "05-focus-highs",    action: "focus-highs",       desc: "Focus tab Highs active" },
  { id: "06-genre-edm",      action: "genre-edm",         desc: "Genre preset EDM selected" },
  { id: "07-genre-phonk-bass", action: "genre-phonk-bass", desc: "Genre preset Phonk / Bass selected" },
  { id: "08-mode-3d",        action: "mode-3d",           desc: "Visualization mode 3D active" },
  { id: "09-mode-2d",        action: "mode-2d",           desc: "Visualization mode 2D active" },
];

const browser = await chromium.launch({
  headless: true,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-gl=angle",
    "--enable-unsafe-swiftshader",
  ],
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
await sleep(4000); // let page hydrate

// Select a track so the visualizer has content
const trackSelect = page.locator('select[data-testid="viz-track-select"]');
const optCount = await trackSelect.locator("option").count();
console.log("track options:", optCount);
if (optCount > 1) {
  await trackSelect.selectOption({ index: 1 });
  await sleep(4000); // let analysis load
}

// Press play if a play button exists
try {
  await page.locator('button[aria-label*="Play"]').first().click({ timeout: 2000 });
  await sleep(3000);
} catch {
  // play button may not exist in all states; non-fatal
}

mkdirSync(outDir, { recursive: true });
const manifest = [];

for (const state of states) {
  try {
    switch (state.action) {
      case "open-track-dropdown":
        // Click the track selector to open its dropdown
        await page.locator('button:has-text("Select a track...")').first().click({ timeout: 3000 });
        await sleep(1500); // let dropdown render
        break;
      case "focus-bass":
        await page.locator('button:has-text("Bass")').first().click({ timeout: 3000 });
        await sleep(1200);
        break;
      case "focus-vocals":
        await page.locator('button:has-text("Vocals")').first().click({ timeout: 3000 });
        await sleep(1200);
        break;
      case "focus-highs":
        await page.locator('button:has-text("Highs")').first().click({ timeout: 3000 });
        await sleep(1200);
        break;
      case "genre-edm":
        await page.locator('button:has-text("EDM")').first().click({ timeout: 3000 });
        await sleep(1200);
        break;
      case "genre-phonk-bass":
        await page.locator('button:has-text("Phonk / Bass")').first().click({ timeout: 3000 });
        await sleep(1200);
        break;
      case "mode-3d":
        await page.locator('button:has-text("3D")').first().click({ timeout: 3000 });
        await sleep(1200);
        break;
      case "mode-2d":
        await page.locator('button:has-text("2D")').first().click({ timeout: 3000 });
        await sleep(1200);
        break;
      case "none":
      default:
        // base state, no action needed
        break;
    }

    const outPath = path.join(outDir, `${state.id}.png`);
    await page.screenshot({ path: outPath, type: "png", scale: "css" });
    manifest.push({ id: state.id, desc: state.desc, file: outPath });
    console.log(`shot ${state.id} — ${state.desc}`);
  } catch (e) {
    console.log(`SKIP ${state.id} — ${state.desc}: ${e.message}`);
    manifest.push({ id: state.id, desc: state.desc, file: null, error: e.message });
  }
}

// Write a machine-readable manifest for the audit runner
const manifestPath = path.join(outDir, "manifest.json");
writeFileSync(manifestPath, JSON.stringify({ base, states: manifest, consoleErrors }, null, 2));
console.log(`\nManifest written: ${manifestPath}`);
console.log(`Console errors: ${consoleErrors.length ? consoleErrors.slice(0, 10).join(" | ") : "none"}`);
await browser.close();
