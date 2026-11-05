// Headed visualizer QA: real GPU, real rAF. Run from packages/frontend:
//   node ../../tools/probes/headed-viz-check.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve("tests/browser/out");
mkdirSync(OUT, { recursive: true });

const consoleLog = [];
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type()))
    consoleLog.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => consoleLog.push(`[pageerror] ${String(e).slice(0, 300)}`));

const shot = (name) => page.screenshot({ path: resolve(OUT, name), fullPage: false });
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto("http://127.0.0.1:5173/render/visualizer", { waitUntil: "networkidle" });
await sleep(2500);
await shot("headed-01-loaded.png");

// select track
await page.evaluate(() => {
  const s = document.getElementById("viz-track-select");
  const opt = [...s.options].find((o) => o.textContent.includes("Clever Mistakes"));
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(s, opt.value);
  s.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(4000);
await shot("headed-02-track-loaded.png");

// play
await page.evaluate(() => document.querySelector('button[aria-label="Play"]')?.click());
await sleep(5000);
await shot("headed-03-playing-default.png");

const report = { modes: {} };

async function checkMode(name, clickLabel, settleMs = 3500) {
  if (clickLabel) {
    await page.evaluate((label) => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.textContent.trim() === label,
      );
      b?.click();
    }, clickLabel);
    await sleep(settleMs);
  }
  const state = await page.evaluate(() => {
    const a = document.querySelector("audio");
    const panel = document.querySelector(".viz-latency-panel");
    return {
      t: a?.currentTime?.toFixed(1),
      paused: a?.paused,
      latency: panel?.innerText?.replace(/\n/g, " | ").slice(0, 220) ?? null,
      mode: document
        .querySelector('button[aria-label*="Visualization mode"]')
        ?.getAttribute("aria-label"),
    };
  });
  await shot(`headed-${name}.png`);
  report.modes[name] = state;
  return state;
}

// default is 3D
await checkMode("3d-mode", null);
await checkMode("2d-bars", "2D");
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Bars");
  b?.click();
});
await sleep(2500);
await shot("headed-2d-bars-playing.png");
report.modes["2d-bars-playing"] = await page.evaluate(() => {
  const a = document.querySelector("audio");
  return { t: a?.currentTime?.toFixed(1), paused: a?.paused };
});
await checkMode("fx-shader", "FX", 4000);

writeFileSync(resolve(OUT, "headed-report.json"), JSON.stringify({ report, consoleLog }, null, 2));
console.log(JSON.stringify({ report, consoleLog: consoleLog.slice(0, 30) }, null, 2));
await browser.close();
