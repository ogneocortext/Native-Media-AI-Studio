#!/usr/bin/env node
/**
 * Diagnose audio skipping: track audio element presence + currentTime over time.
 * Usage: node tests/browser/diag-audio-skip.mjs [baseUrl]
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

page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto(`${base}/visualizer`, { waitUntil: "domcontentloaded", timeout: 20000 });
await sleep(4000);

const trackSelect = page.locator('select[data-testid="viz-track-select"]');
if ((await trackSelect.locator("option").count()) > 1) {
  await trackSelect.selectOption({ index: 1 });
  await sleep(4000);
}

await page.locator('button[aria-label*="Play"]').first().click({ timeout: 3000 }).catch(() => {});
await sleep(500);

// Sample every 100ms for 20 seconds, tracking presence
const events = [];
let lastPresent = null;
for (let i = 0; i < 200; i++) {
  const s = await page.evaluate(() => {
    const el = document.querySelector("audio[data-main-player]");
    if (!el) return { present: false };
    return {
      present: true,
      t: el.currentTime,
      paused: el.paused,
      readyState: el.readyState,
    };
  });
  const present = s.present;
  if (present !== lastPresent) {
    events.push({ i, present, t: s.t, paused: s.paused });
    lastPresent = present;
  } else if (present && i % 10 === 0) {
    // log every 1s while present
    events.push({ i, present, t: s.t, paused: s.paused, periodic: true });
  }
  await sleep(100);
}

console.log("Events (presence changes + periodic):");
for (const e of events) {
  console.log(
    `  #${e.i} ${e.present ? "PRESENT" : "GONE"} t=${e.t?.toFixed(2)} paused=${e.paused} ${e.periodic ? "(periodic)" : ""}`,
  );
}

await page.screenshot({ path: path.join(out, "diag-audio-skip.png") });
await browser.close();
