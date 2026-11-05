import { chromium } from "playwright";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/frontend/tests/browser/out");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://127.0.0.1:5173/render/visualizer", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2000);
const sel = page.locator(".viz-track-select select, select.viz-track-select, .viz-track-selector select").first();
await sel.selectOption({ index: 1 });
await page.waitForTimeout(2500);
// press play via transport button or space
const playBtn = page.locator("button[aria-label*='play' i], button[title*='play' i]").first();
if (await playBtn.count()) await playBtn.click(); else await page.keyboard.press(" ");
await page.waitForTimeout(3000);
const state = await page.evaluate(() => {
  const t = document.querySelector(".viz-playhead-track");
  const m = document.querySelector(".viz-playhead-marker");
  const r = document.querySelector(".viz-playhead-readout");
  return {
    trackTransform: t ? getComputedStyle(t).transform : null,
    markerLeft: m ? m.style.left : null,
    readout: r ? r.textContent : null,
    audio: !!document.querySelector("audio.viz-audio, .viz-audio"),
  };
});
console.log(JSON.stringify(state));
await page.screenshot({ path: OUT + "/css-playing.png" });

// narrow viewport pass
await page.setViewportSize({ width: 820, height: 900 });
await page.waitForTimeout(800);
await page.screenshot({ path: OUT + "/css-narrow.png" });
const narrow = await page.evaluate(() => {
  const tb = document.querySelector(".viz-topbar");
  const r = tb?.getBoundingClientRect();
  return { topbarH: r?.height, scrollW: document.documentElement.scrollWidth, winW: innerWidth };
});
console.log("narrow:", JSON.stringify(narrow));
await browser.close();
