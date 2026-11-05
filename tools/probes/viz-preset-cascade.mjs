// Verify the track-load preset cascade: single batched apply, fade pulse,
// delayed mode switch, one toast — not everything firing at once.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/frontend/tests/browser/out");
mkdirSync(OUT, { recursive: true });
const consoleLog = [];
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") consoleLog.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => consoleLog.push("[pageerror] " + String(e).slice(0, 160)));
const shot = (n) => page.screenshot({ path: resolve(OUT, n) });
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto("http://127.0.0.1:5173/render/visualizer", { waitUntil: "networkidle", timeout: 40000 });
await sleep(2500);

const pickTrack = (idx) => page.evaluate((i) => {
  const s = document.getElementById("viz-track-select");
  const opts = [...s.options].filter((o) => o.value);
  const opt = opts[i] ?? opts[0];
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(s, opt.value);
  s.dispatchEvent(new Event("change", { bubbles: true }));
  return opt.textContent;
}, idx);

const state = () => page.evaluate(() => ({
  ...(window.__VIZ_TEST__?.getState() ?? {}),
  fade: parseFloat(getComputedStyle(document.querySelector(".viz-mode-fade") || document.body).opacity || "0"),
}));

// Baseline: load track 0 first so analysis is warm, then switch to track 1 —
// the second load exercises the full cascade with cached-vs-fresh paths.
console.log("track0:", await pickTrack(0));
await sleep(6000);
const s0 = await state();
console.log("after track0:", JSON.stringify({ mode: s0.vizMode, kin: s0.kineticPreset, preset: s0.activeVisualPresetId, fade: s0.fade }));
await shot("p01-track0-settled.png");

// Switch to track 1 and sample the cascade at 120ms resolution.
console.log("track1:", await pickTrack(1));
const samples = [];
const t0 = Date.now();
for (let i = 0; i < 50; i++) {
  samples.push({ t: Date.now() - t0, ...(await state()) });
  await sleep(120);
}
const transitions = samples.filter((s, i) => i === 0 || s.vizMode !== samples[i - 1].vizMode || s.activeVisualPresetId !== samples[i - 1].activeVisualPresetId || s.kineticPreset !== samples[i - 1].kineticPreset);
console.log("state transitions:", JSON.stringify(transitions.map((s) => ({ t: s.t, mode: s.vizMode, kin: s.kineticPreset, preset: s.activeVisualPresetId, fade: +s.fade.toFixed(2) }))));
const maxFade = Math.max(...samples.map((s) => s.fade));
const fadeIdx = samples.findIndex((s) => s.fade > 0.5);
const modeChangeIdx = samples.findIndex((s) => s.vizMode !== samples[0].vizMode);
console.log(`maxFade=${maxFade.toFixed(2)} fadeSeenAt=${samples[fadeIdx]?.t ?? "never"}ms modeChangeAt=${samples[modeChangeIdx]?.t ?? "never"}ms`);
await shot("p02-track1-mid.png");
await sleep(2500);
await shot("p03-track1-settled.png");
const s1 = await state();
console.log("after track1:", JSON.stringify({ mode: s1.vizMode, kin: s1.kineticPreset, preset: s1.activeVisualPresetId, fade: s1.fade }));

// Toast count: exactly one "Applied" toast expected per load.
const toasts = await page.evaluate(() => [...document.querySelectorAll(".viz-toast, [class*=toast]")].map((e) => e.textContent?.trim()).filter(Boolean));
console.log("toasts:", JSON.stringify(toasts.slice(0, 6)));

writeFileSync(resolve(OUT, "preset-cascade-report.json"), JSON.stringify({ transitions, samples: samples.filter((_, i) => i % 5 === 0), toasts, consoleLog }, null, 2));
console.log("console errors:", consoleLog.length, consoleLog.slice(0, 8).join(" | "));
await browser.close();
