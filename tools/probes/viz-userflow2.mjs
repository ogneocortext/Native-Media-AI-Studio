// User-flow part 2: verify overlap fix, browse button, A-B loop, mixer,
// EQ, remix panel, track switch, bottom bar.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/frontend/tests/browser/out");
mkdirSync(OUT, { recursive: true });
const consoleLog = [];
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${n} ${d}`); };

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => { if (["error","warning"].includes(m.type())) consoleLog.push(m.text().slice(0,200)); });
page.on("pageerror", (e) => consoleLog.push("[pageerror] " + String(e).slice(0,200)));
const shot = (n) => page.screenshot({ path: resolve(OUT, n) });
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto("http://127.0.0.1:5173/render/visualizer", { waitUntil: "networkidle", timeout: 40000 });
await sleep(2500);

// --- overlap fix probe ---
const overlap = await page.evaluate(() => {
  const more = document.querySelector('[data-testid="viz-more-toggle"]');
  const lt = document.querySelector(".layout-topbar");
  if (!more || !lt) return { more: !!more, lt: !!lt };
  const r = more.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { hit: hit?.getAttribute("aria-label") || hit?.className?.toString().slice(0,60), moreRight: r.right, ltLeft: lt.getBoundingClientRect().left };
});
console.log("overlap probe:", JSON.stringify(overlap));
check("more-button-not-under-topbar", overlap.hit !== "Notifications (1 unread)" && overlap.hit !== "notification-bell", JSON.stringify(overlap.hit));
await shot("v01-topbar-fixed.png");

// --- select + play ---
await page.evaluate(() => {
  const s = document.getElementById("viz-track-select");
  const opt = [...s.options].find((o) => o.textContent.includes("Clever Mistakes"));
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(s, opt.value); s.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(5000);
await page.locator('button[aria-label="Play"]').first().click();
await sleep(3000);

// --- browse button opens file browser ---
const browseBtn = page.locator('button[aria-label="Browse audio library"]');
check("browse-button-present", await browseBtn.count() === 1);
await browseBtn.click();
await sleep(800);
check("file-browser-opens", await page.locator(".viz-file-browser").isVisible().catch(() => false));
await shot("v02-file-browser.png");
// pick a different track via search
await page.locator('.viz-file-browser-search input').fill("Suno");
await sleep(500);
const firstCard = page.locator(".viz-file-browser-card").first();
check("browser-search-filters", await firstCard.count() > 0);
await shot("v03-browser-search.png");
await page.locator('button[aria-label="Close file browser"]').click();
await sleep(400);

// --- A-B loop via keyboard (blur first) ---
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press("l"); await sleep(300);
const anchorSet = await page.evaluate(() => !!document.querySelector(".viz-loop-anchor"));
await page.locator('input[aria-label="Seek"]').fill("60"); await sleep(400);
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press("l"); await sleep(800);
const loopRegion = await page.evaluate(() => !!document.querySelector(".viz-loop-region"));
check("ab-loop-anchor", anchorSet);
check("ab-loop-region", loopRegion);
await shot("v04-ab-loop.png");
// verify loop wraps: wait until past end
await sleep(8000);
const loopT = await page.evaluate(() => document.querySelector("audio")?.currentTime?.toFixed(1));
console.log("loop currentTime:", loopT);
await page.keyboard.press("l"); await sleep(300); // clear
await page.evaluate(() => document.activeElement?.blur());

// --- mixer toggle ---
const mixerBtn = page.locator('button:has-text("Simple Mixer"),button:has-text("Professional Mixer")').first();
check("mixer-toggle-present", await mixerBtn.count() === 1);
await mixerBtn.click(); await sleep(1000);
await shot("v05-pro-mixer.png");
// stem sliders present?
const stemControls = await page.evaluate(() => document.querySelectorAll('.viz-audio-player input[type="range"]').length);
console.log("mixer range inputs:", stemControls);

// --- EQ panel ---
const eqPanel = await page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find(e => e.textContent?.trim() === "Master EQ" || e.textContent?.includes("Master EQ"));
  return !!el;
});
console.log("eq panel present:", eqPanel);

// --- remix panel ---
const remixBtn = page.locator('button:has-text("Remix"), [class*=remix] button, summary:has-text("Remix")').first();
const remixAny = await page.locator('text=/remix/i').first().count();
console.log("remix elements:", remixAny);
await page.evaluate(() => {
  const el = [...document.querySelectorAll("button,summary,div[role=button]")].find(e => /remix/i.test(e.textContent||""));
  el?.click();
});
await sleep(2000);
await shot("v06-remix.png");
const remixProbes = await page.evaluate(() => performance.getEntriesByType("resource").filter(r => r.name.includes("remix/probe")).length);
console.log("remix probe requests:", remixProbes);

// --- scroll bottom ---
await page.evaluate(() => { const m = document.querySelector(".layout-main") || document.scrollingElement; m.scrollTop = m.scrollHeight; });
await sleep(800);
await shot("v07-bottom.png");
const bottom = await page.evaluate(() => {
  const t = document.querySelector(".viz-audio-player");
  const r = t?.getBoundingClientRect();
  return r ? { visible: r.bottom <= innerHeight && r.top >= 0, top: r.top, bottom: r.bottom } : null;
});
console.log("audio player rect:", JSON.stringify(bottom));

// --- track switch while playing ---
await page.evaluate(() => {
  const s = document.getElementById("viz-track-select");
  const opts = [...s.options].filter(o => o.value);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(s, opts[Math.min(2, opts.length - 1)].value);
  s.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(4000);
const sw = await page.evaluate(() => ({ t: document.querySelector("audio")?.currentTime?.toFixed(1), paused: document.querySelector("audio")?.paused, src: document.querySelector("audio")?.src?.split("/").pop()?.slice(0,40) }));
console.log("after switch:", JSON.stringify(sw));
await shot("v08-switched.png");

writeFileSync(resolve(OUT, "userflow2-report.json"), JSON.stringify({ results, consoleLog: consoleLog.slice(0,40) }, null, 2));
console.log("\nconsole issues:", consoleLog.length, consoleLog.slice(0,15).join(" | "));
await browser.close();
