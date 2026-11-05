// Quick visual check of the visualizer after the CSS chrome restore.
// Headless is fine for layout/DOM verification; pixel check via vision model.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/frontend/tests/browser/out");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://127.0.0.1:5173/render/visualizer", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: OUT + "/css-after-top.png" });

// select first real track and play
const sel = page.locator("select.viz-track-select, .viz-track-select select, select").first();
const opts = await sel.locator("option").allTextContents();
console.log("track options:", opts.length, opts.slice(0, 3));
if (opts.length > 1) {
  await sel.selectOption({ index: 1 });
  await page.waitForTimeout(3000);
}
await page.screenshot({ path: OUT + "/css-after-loaded.png", fullPage: false });

// probe key computed styles
const probe = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const cs = (el, props) => el ? Object.fromEntries(props.map(p => [p, getComputedStyle(el)[p]])) : null;
  return {
    iconBtn: cs(q(".viz-icon-btn"), ["width", "height", "backgroundColor", "borderRadius", "borderTopWidth"]),
    topbar: cs(q(".viz-topbar"), ["display", "padding", "backgroundColor"]),
    playheadTrack: cs(q(".viz-playhead-track"), ["transform", "position"]),
    bottombar: cs(q(".viz-bottombar"), ["display", "position"]),
    tuningGroup: cs(q(".viz-tuning-group"), ["display", "borderTopWidth"]),
    moreMenu: cs(q(".viz-more-menu"), ["position", "zIndex"]),
  };
});
console.log(JSON.stringify(probe, null, 1));
console.log("js errors:", errors.length ? errors.slice(0, 10) : "none");
await browser.close();
