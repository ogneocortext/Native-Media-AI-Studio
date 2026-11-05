// Verify: A-B loop wraps, track switch resumes playback, topbar layout.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/frontend/tests/browser/out");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto("http://127.0.0.1:5173/render/visualizer", { waitUntil: "networkidle", timeout: 40000 });
await sleep(2500);
await page.evaluate(() => {
  const s = document.getElementById("viz-track-select");
  const opt = [...s.options].find((o) => o.textContent.includes("Clever Mistakes"));
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(s, opt.value); s.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(5000);
await page.locator('button[aria-label="Play"]').first().click();
await sleep(3000);

// A-B loop: set A now, B at +8s via seek
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press("l"); await sleep(300);
const t0 = await page.evaluate(() => document.querySelector("audio")?.currentTime);
await page.evaluate((v) => {
  const s = document.querySelector('input[aria-label="Seek"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(s, String(v));
  s.dispatchEvent(new Event("input", { bubbles: true }));
  s.dispatchEvent(new Event("change", { bubbles: true }));
}, t0 + 8); await sleep(400);
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press("l"); await sleep(500);
const region = await page.evaluate(() => {
  const r = document.querySelector(".viz-loop-region");
  return r ? { left: r.style.left, width: r.style.width } : null;
});
console.log("loop region:", JSON.stringify(region), "anchor was ~", t0?.toFixed(1));
// wait for wrap: region end ~ t0+8, wait 10s
await sleep(10000);
const t1 = await page.evaluate(() => document.querySelector("audio")?.currentTime);
console.log("after 10s currentTime:", t1?.toFixed(1), "(should be < end ~" + (t0 + 8).toFixed(1) + ")");
const wrapped = t1 < t0 + 8;
console.log(wrapped ? "PASS loop-wraps" : "FAIL loop-does-not-wrap");
await page.screenshot({ path: resolve(OUT, "v09-loop-wrap.png") });
await page.keyboard.press("l"); await sleep(300);

// track switch while playing -> should resume
const before = await page.evaluate(() => ({ t: document.querySelector("audio")?.currentTime?.toFixed(1), paused: document.querySelector("audio")?.paused }));
await page.evaluate(() => {
  const s = document.getElementById("viz-track-select");
  const opts = [...s.options].filter(o => o.value);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(s, opts[3].value); s.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(6000);
const after = await page.evaluate(() => ({ t: document.querySelector("audio")?.currentTime?.toFixed(1), paused: document.querySelector("audio")?.paused }));
console.log("switch:", JSON.stringify(before), "->", JSON.stringify(after));
console.log(!after.paused && (after.t > 0.5 || after.t === "0.0") ? "PASS resume-on-switch" : "CHECK resume-on-switch");
await page.screenshot({ path: resolve(OUT, "v10-resume.png") });
console.log("pageerrors:", errs.length ? errs : "none");
await browser.close();
