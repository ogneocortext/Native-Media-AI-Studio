#!/usr/bin/env node
/**
 * Three.js Studio — checks for the 2026-09-29 UX audit (F2/F3/F4/F5/F9) plus
 * the idle-vs-playing frame pair used to investigate F8.
 *
 * Usage: node tests/browser/three-studio-audit-checks.mjs [baseUrl]
 * Screenshots land in tests/browser/out/.
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2] || "http://127.0.0.1:5173";
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-gl=angle",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 900 } })
).newPage();

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const results = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const objectCount = async () => {
  const text = await page.locator(".hud").innerText();
  const m = text.match(/Objects\s*(\d+)/);
  return m ? Number(m[1]) : null;
};
const selectedName = async () => {
  const rows = page.locator(".bottom-drawer [class*='cursor-pointer']");
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const cls = (await rows.nth(i).getAttribute("class")) || "";
    if (cls.includes("bg-purple-600/30"))
      return (await rows.nth(i).innerText()).replace(/\s+/g, " ").trim();
  }
  return null;
};

console.log(`Navigating to ${base}/three-js-studio …`);
await page.goto(`${base}/three-js-studio`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForSelector("canvas", { timeout: 60000 });
await page
  .waitForFunction(
    () => !document.body.innerText.includes("Initializing 3D scene"),
    null,
    { timeout: 30000 },
  )
  .catch(() => {});
await sleep(2500);

const startCount = await objectCount();
check("scene loaded with default crown", startCount === 1, `Objects=${startCount}`);

// F8 — idle vs playing frames (same scene, same camera mode)
await page.screenshot({ path: `${out}/three-studio-idle.png` });
const playButton = page.locator(".playback-controls button").first();
const playTitle = await playButton.getAttribute("title");
check("F9 preview label", /preview/i.test(playTitle || ""), playTitle || "");
await playButton.click();
await sleep(4000);
await page.screenshot({ path: `${out}/three-studio-playing.png` });
check(
  "preview plays without crash",
  (await objectCount()) !== null,
  `Objects=${await objectCount()}`,
);
await playButton.click();
await sleep(500);

// F2 — add must be visible and acknowledged
await page.locator('button[title="Add Sphere"]').click();
await page.waitForSelector(".toast.toast-success", { timeout: 5000 });
const toastText = await page
  .locator(".toast.toast-success .toast__msg")
  .first()
  .innerText();
const afterAdd = await objectCount();
check(
  "F2 add feedback + scene count",
  afterAdd === startCount + 1 && /added/i.test(toastText),
  `Objects=${afterAdd}, toast="${toastText}"`,
);
await sleep(1500);
await page.screenshot({ path: `${out}/three-studio-after-add.png` });

// F4 — disabled generate button explains itself
const genButton = page.locator("button", { hasText: "Generate Scene" }).first();
const genDisabled = await genButton.isDisabled().catch(() => null);
const hintVisible = await page
  .locator("text=/No Ollama model selected|No track selected|Loading track metadata/")
  .first()
  .isVisible()
  .catch(() => false);
check(
  "F4 disabled reason shown",
  genDisabled === false || hintVisible === true,
  `disabled=${genDisabled}, hintVisible=${hintVisible}`,
);

// F5 — HUD uses full labels
const hudText = await page.locator(".hud").innerText();
check(
  "F5 HUD labels spelled out",
  /Objects/.test(hudText) && /Camera/.test(hudText),
  hudText.replace(/\n/g, " | "),
);

// F6 — model select does not overflow the panel; beat sync reads as a toggle
const selectOverflow = await page.evaluate(() => {
  const panel = document.querySelector(".ai-panel");
  const select = panel?.querySelector("select");
  if (!panel || !select) return { ok: false, reason: "missing" };
  const p = panel.getBoundingClientRect();
  const s = select.getBoundingClientRect();
  return { ok: s.width <= p.width + 1 && s.right <= p.right + 1, reason: `${Math.round(s.width)} vs panel ${Math.round(p.width)}` };
});
check("F6 model select fits panel", selectOverflow.ok, selectOverflow.reason);
const syncTitle = await page
  .locator('button[aria-pressed]')
  .first()
  .getAttribute("title")
  .catch(() => null);
check("F6 beat sync toggle labelled", /beat/i.test(syncTitle || ""), syncTitle || "");

// F3 — click-to-select (raycast) + Delete removes the hit object
await page.locator('button[title="Toggle controls panel"]').click();
await sleep(600);
const box = await page.locator("canvas").boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.click(cx, cy - 140); // crown band, clear of the drawer overlay
await sleep(500);
const picked = await selectedName();
check("F3 canvas click selects object", picked === "Crown", `selected=${picked}`);
await page.keyboard.press("Delete");
await sleep(1200);
const afterDelete = await objectCount();
check(
  "F3 Delete removes selected object",
  afterDelete === startCount,
  `Objects=${afterDelete} (expected ${startCount})`,
);

console.log("\nConsole errors:", consoleErrors.length ? consoleErrors : "none");
const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
