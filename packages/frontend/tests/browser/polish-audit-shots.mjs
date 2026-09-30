#!/usr/bin/env node
/**
 * Capture screenshots of the main routes for the UI polish audit.
 * Usage: node tests/browser/polish-audit-shots.mjs [baseUrl]
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2] || "http://127.0.0.1:5173";
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "out", "polish");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const routes = [
  ["dashboard", "/"],
  ["queue", "/queue"],
  ["music-video-wizard", "/music-video-wizard"],
  ["three-js-studio", "/three-js-studio"],
  ["audio-analysis", "/audio-analysis"],
  ["generate-3d", "/generate-3d"],
  ["visualizer", "/visualizer"],
  ["kinetic-typography", "/kinetic-typography"],
  ["settings", "/settings"],
  ["health", "/health"],
  ["docs", "/docs"],
  ["library", "/library"],
  ["gpu", "/gpu"],
  ["log-analytics", "/log-analytics"],
];

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

import { mkdirSync } from "node:fs";
mkdirSync(out, { recursive: true });

for (const [name, route] of routes) {
  try {
    await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await sleep(2500);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    console.log(`shot ${name} ${route}`);
  } catch (e) {
    console.log(`FAIL ${name} ${route}: ${e.message}`);
  }
}

console.log("\nConsole errors:", consoleErrors.length ? consoleErrors : "none");
await browser.close();
