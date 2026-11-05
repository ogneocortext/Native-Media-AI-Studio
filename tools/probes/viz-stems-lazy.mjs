// Verify stems-analysis fetch is lazy: absent on track load, fires once
// when the inspector Mixer tab opens, not again on tab switches.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/frontend/tests/browser/out");
mkdirSync(OUT, { recursive: true });
const stemsReqs = [];
const consoleErrs = [];
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("request", (r) => { if (r.url().includes("stems-analysis")) stemsReqs.push(r.url()); });
page.on("pageerror", (e) => consoleErrs.push(String(e).slice(0, 160)));
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto("http://127.0.0.1:5173/render/visualizer", { waitUntil: "networkidle", timeout: 40000 });
await sleep(2500);

// Select a track — stems fetch must NOT fire.
await page.evaluate(() => {
  const s = document.getElementById("viz-track-select");
  const opt = [...s.options].find((o) => o.value);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(s, opt.value); s.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(6000);
console.log("stems reqs after track load:", stemsReqs.length, stemsReqs);

// Open inspector → Mixer tab — fetch should fire exactly once.
await page.locator('[data-testid="viz-inspector-toggle"], button[aria-label*="nspector"]').first().click().catch(async () => {
  await page.locator("button", { hasText: /inspector/i }).first().click();
});
await sleep(600);
await page.locator(".viz-inspector-tab", { hasText: "Mixer" }).first().click();
await sleep(3000);
console.log("stems reqs after mixer open:", stemsReqs.length, stemsReqs);

// Switch away and back — no second fetch (per-track cache).
await page.locator(".viz-inspector-tab", { hasText: "Scene" }).first().click();
await sleep(400);
await page.locator(".viz-inspector-tab", { hasText: "Mixer" }).first().click();
await sleep(1500);
console.log("stems reqs after tab revisit:", stemsReqs.length);

// FX mode also needs stems — switch mode and confirm fetch fires (if not cached).
await page.keyboard.press("Escape");
await sleep(300);
await page.locator(".viz-mode-btn", { hasText: "FX" }).click();
await sleep(2500);
console.log("stems reqs final:", stemsReqs.length);

writeFileSync(resolve(OUT, "stems-lazy-report.json"), JSON.stringify({ stemsReqs, consoleErrs }, null, 2));
console.log("pageerrors:", consoleErrs.length, consoleErrs.slice(0, 5).join(" | "));
await browser.close();
