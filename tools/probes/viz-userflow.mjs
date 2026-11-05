// Comprehensive user-flow QA for /render/visualizer — headed, real GPU.
// Simulates a user: pick track, play, cycle modes, transport, loop, layers,
// menus, mixer, EQ, remix, settings, focus mode, track switch.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/frontend/tests/browser/out");
mkdirSync(OUT, { recursive: true });

const consoleLog = [];
const failedReqs = [];
const report = {};
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type()))
    consoleLog.push(`[${m.type()}] ${m.text().slice(0, 250)}`);
});
page.on("pageerror", (e) => consoleLog.push(`[pageerror] ${String(e).slice(0, 250)}`));
page.on("requestfailed", (r) => failedReqs.push(`${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes(".lrc")) failedReqs.push(`${r.status()} ${r.url().slice(0, 120)}`); });

const shot = (n) => page.screenshot({ path: resolve(OUT, n) });
const sleep = (ms) => page.waitForTimeout(ms);
const $ = (sel) => page.locator(sel);
const btn = (label) => page.locator(`button:has-text("${label}")`).first();
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`); };

// ---------- 1. load / empty state ----------
await page.goto("http://127.0.0.1:5173/render/visualizer", { waitUntil: "networkidle", timeout: 40000 });
await sleep(2500);
await shot("u01-empty.png");
report.emptyStateVisible = await page.locator(".viz-empty-state, .viz-empty-card, [class*=empty]").first().isVisible().catch(() => false);

// ---------- 2. select track ----------
await page.evaluate(() => {
  const s = document.getElementById("viz-track-select");
  const opt = [...s.options].find((o) => o.textContent.includes("Clever Mistakes"));
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(s, opt.value);
  s.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(5000);
await shot("u02-track-loaded.png");
report.audioUrl = await page.evaluate(() => !!document.querySelector("audio.viz-audio"));

// ---------- 3. play (3D default) ----------
await page.locator('button[aria-label="Play"]').first().click();
await sleep(4000);
await shot("u03-3d-playing.png");
report.playing = await page.evaluate(() => { const a = document.querySelector("audio"); return a && !a.paused && a.currentTime > 0; });
check("playback-starts", !!report.playing);

// ---------- 4. cycle modes via keyboard ----------
for (const [key, name] of [["ArrowRight", "2d"], ["ArrowRight", "fx"]]) {
  await page.keyboard.press(key);
  await sleep(key === "ArrowRight" ? 3000 : 3500);
}
await shot("u04-fx-mode.png");
report.modeAfterCycle = await page.evaluate(() => document.querySelector(".viz-mode-chip, [class*=mode]")?.textContent);

// back to 2D + sub-modes via number keys
await page.keyboard.press("ArrowLeft"); // FX->2D? cycle order FX->2D->3D; ArrowLeft cycles back
await sleep(1500);
await page.keyboard.press("2"); // 2D mode #2?
await sleep(1500);
await shot("u05-2d-submode.png");

// ---------- 5. transport ----------
const transport = await page.evaluate(() => {
  const seek = document.querySelector('input[aria-label="Seek"]');
  const vol = document.querySelector('input[aria-label="Volume"]');
  const rate = document.querySelector('select[aria-label="Playback speed"]');
  return { seek: !!seek, vol: !!vol, rate: rate?.value };
});
check("transport-controls-present", transport.seek && transport.vol && !!transport.rate, JSON.stringify(transport));

// seek to ~30s
await page.locator('input[aria-label="Seek"]').fill("30");
await sleep(800);
report.seeked = await page.evaluate(() => document.querySelector("audio")?.currentTime?.toFixed(1));
// speed 1.5x
await page.locator('select[aria-label="Playback speed"]').selectOption("1.5");
await sleep(400);
report.rate = await page.evaluate(() => document.querySelector("audio")?.playbackRate);
// volume 0.4
await page.locator('input[aria-label="Volume"]').fill("0.4");
await sleep(300);
report.volume = await page.evaluate(() => document.querySelector("audio")?.volume);
await shot("u06-transport.png");
check("seek-works", Math.abs((report.seeked ?? 0) - 30) < 3, `t=${report.seeked}`);
check("speed-works", report.rate === 1.5);
check("volume-works", Math.abs((report.volume ?? 0) - 0.4) < 0.05);
// restore
await page.locator('select[aria-label="Playback speed"]').selectOption("1");
await page.locator('input[aria-label="Volume"]').fill("1");

// ---------- 6. A-B loop ----------
await page.keyboard.press("l"); // set A
await sleep(400);
await page.locator('input[aria-label="Seek"]').fill("45");
await sleep(500);
await page.keyboard.press("l"); // set B
await sleep(1200);
report.loop = await page.evaluate(() => ({
  region: !!document.querySelector(".viz-loop-region"),
  anchor: !!document.querySelector(".viz-loop-anchor"),
  t: document.querySelector("audio")?.currentTime?.toFixed(1),
}));
await shot("u07-ab-loop.png");
check("ab-loop-region", report.loop.region, JSON.stringify(report.loop));
await page.keyboard.press("l"); // clear
await sleep(400);

// ---------- 7. layers toggles ----------
const layerBtns = await page.evaluate(() =>
  [...document.querySelectorAll("button[aria-label^='Hide'],button[aria-label^='Show']")].map(b => b.getAttribute("aria-label")));
report.layerButtons = layerBtns;
// toggle visuals off/on
const visBtn = page.locator("button[aria-label^='Hide visuals'],button[aria-label^='Show visuals']").first();
if (await visBtn.count()) { await visBtn.click(); await sleep(800); await shot("u08-visuals-hidden.png"); await visBtn.click(); await sleep(500); }

// ---------- 8. shortcuts menu (H) ----------
await page.keyboard.press("h");
await sleep(600);
report.shortcutsOpen = await page.locator(".viz-shortcuts-menu").isVisible().catch(() => false);
await shot("u09-shortcuts.png");
check("shortcuts-menu", report.shortcutsOpen);
await page.keyboard.press("Escape");
await sleep(400);

// ---------- 9. focus mode (F) ----------
await page.keyboard.press("f");
await sleep(900);
report.focusMode = await page.evaluate(() => document.querySelector(".viz-page")?.className.includes("viz-focus-mode"));
await shot("u10-focus-mode.png");
check("focus-mode", !!report.focusMode);
await page.keyboard.press("f");
await sleep(700);

// ---------- 10. More menu ----------
await page.locator('button[aria-label="More controls"]').first().click();
await sleep(600);
report.moreMenu = await page.locator(".viz-more-menu").isVisible().catch(() => false);
await shot("u11-more-menu.png");
check("more-menu", report.moreMenu);
// freeze scene
const freeze = page.locator('button[aria-label*="Freeze scene"],button[aria-label*="Unfreeze scene"]').first();
if (await freeze.count()) { await freeze.click(); await sleep(400); await shot("u12-frozen.png"); }
// settings
const settingsBtn = page.locator('button[aria-label*="settings" i]').first();
if (await settingsBtn.count()) { await settingsBtn.click(); await sleep(800); await shot("u13-settings.png"); report.settingsOpen = await page.evaluate(() => !!document.querySelector(".viz-settings-panel,[class*=settings]")); }
await page.keyboard.press("Escape");
await sleep(400);

// ---------- 11. mixer + EQ + remix ----------
await page.locator('button:has-text("Simple Mixer"),button:has-text("Professional Mixer")').first().click().catch(() => {});
await sleep(600);
await shot("u14-mixer.png");
const mixerToggle = page.locator('button:has-text("Professional Mixer"),button:has-text("Simple Mixer")').first();
if (await mixerToggle.count()) { await mixerToggle.click(); await sleep(800); await shot("u15-pro-mixer.png"); }
// remix panel expand
const remixHeader = page.locator('text=Remix').first();
if (await remixHeader.count()) { await remixHeader.click().catch(() => {}); await sleep(1500); await shot("u16-remix.png"); }
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await sleep(600);
await shot("u17-bottom.png");

// ---------- 12. switch track while playing ----------
await page.evaluate(() => {
  const s = document.getElementById("viz-track-select");
  const opts = [...s.options].filter(o => o.value);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(s, opts[opts.length - 1].value);
  s.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(4000);
report.trackSwitched = await page.evaluate(() => ({ t: document.querySelector("audio")?.currentTime?.toFixed(1), paused: document.querySelector("audio")?.paused }));
await shot("u18-track-switched.png");
check("track-switch-keeps-state", report.trackSwitched.t !== undefined, JSON.stringify(report.trackSwitched));

// pause at end
await page.locator('button[aria-label="Pause"],button[aria-label="Play"]').first().click().catch(() => {});
await sleep(500);

writeFileSync(resolve(OUT, "userflow-report.json"), JSON.stringify({ report, results, consoleLog: consoleLog.slice(0, 60), failedReqs: [...new Set(failedReqs)].slice(0, 30) }, null, 2));
console.log("\n=== console errors/warnings:", consoleLog.length, "| failed reqs:", new Set(failedReqs).size);
console.log(consoleLog.slice(0, 25).join("\n"));
await browser.close();
