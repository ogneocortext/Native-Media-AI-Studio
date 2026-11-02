/**
 * interaction-sweep.mjs — click every visible, enabled interactive element on
 * the key pages and report which ones misbehave (uncaught exception, request
 * failure / 500, unexpected navigation).
 *
 * Reliability notes:
 *  - The live DOM is re-scanned after every click (and after every nav-induced
 *    reload), because identities shift — sidebar titles flip "Collapse X" to
 *    "Expand X", and the visualizer mounts its controls asynchronously.
 *  - Elements are matched by identity (data-testid > aria-label > title > text
 *    > class) plus class, so two buttons that share text (e.g. "Create" as a
 *    sidebar header and as a page link) are both reachable.
 *  - Errors are captured per-click (handlers attached, drained, detached) so a
 *    failure is attributed to the button that caused it.
 *
 * Usage: node tests/browser/interaction-sweep.mjs [url...]
 * Defaults to the visualizer + a few key pages. Each page is visited fresh.
 */
import { chromium } from "playwright";
import { CHROMIUM_LAUNCH_OPTIONS } from "./browser-launch.mjs";

const DEFAULT_URLS = [
  "http://127.0.0.1:5173/render/visualizer",
  "http://127.0.0.1:5173/analyze/audio",
  "http://127.0.0.1:5173/create/remix",
  "http://127.0.0.1:5173/system/health",
  "http://127.0.0.1:5173/system/queue",
];

const urls = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_URLS;

async function scan(page) {
  return page.evaluate(() => {
    const list = [];
    for (const b of Array.from(document.querySelectorAll("button, [role='button']"))) {
      const r = b.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (b.disabled) continue;
      const identity =
        b.getAttribute("data-testid") ||
        b.getAttribute("aria-label") ||
        b.getAttribute("title") ||
        (b.textContent || "").trim().slice(0, 40) ||
        b.className.slice(0, 40);
      list.push({
        identity,
        cls: b.className.slice(0, 40),
        text: (b.textContent || "").trim().slice(0, 30),
      });
    }
    return list;
  });
}

async function sweep(page, url) {
  const errors = [];
  const pageErrorHandler = (e) => errors.push("pageerror:" + String(e).slice(0, 160));
  const consoleHandler = (m) => {
    if (m.type() === "error") errors.push("console:" + m.text().slice(0, 160));
  };
  const reqFailHandler = (r) =>
    errors.push("reqfail:" + r.url() + ":" + (r.failure()?.errorText || ""));
  function attach() {
    page.on("pageerror", pageErrorHandler);
    page.on("console", consoleHandler);
    page.on("requestfailed", reqFailHandler);
  }
  function drain() {
    page.off("pageerror", pageErrorHandler);
    page.off("console", consoleHandler);
    page.off("requestfailed", reqFailHandler);
    const e = errors.slice();
    errors.length = 0;
    return e;
  }

  await page.goto(url, { waitUntil: "domcontentloaded" });
  // The visualizer mounts its controls after the Three.js canvas initializes,
  // so wait for the first interactive element rather than a fixed timeout.
  try {
    await page.waitForSelector("button, [role='button']", { timeout: 8000 });
  } catch {
    /* page has no buttons at all — still worth reporting */
  }
  await page.waitForTimeout(500);

  let buttons = await scan(page);
  const initialCount = buttons.length;
  const clicked = new Set();
  const results = [];
  let safety = 0;
  while (buttons.length && safety < 5000) {
    safety++;
    const b = buttons[0];
    const dedupeKey = b.identity + "|" + b.cls;
    if (clicked.has(dedupeKey)) {
      buttons = buttons.slice(1);
      continue;
    }
    clicked.add(dedupeKey);
    const beforeUrl = page.url();
    attach();
    let hit;
    try {
      hit = await page.evaluate(
        ({ identity, cls }) => {
          const all = Array.from(document.querySelectorAll("button, [role='button']"));
          const visible = all.filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width >= 4 && r.height >= 4 && !el.disabled;
          });
          const matches = visible.filter((el) => {
            const id =
              el.getAttribute("data-testid") ||
              el.getAttribute("aria-label") ||
              el.getAttribute("title") ||
              (el.textContent || "").trim().slice(0, 40) ||
              el.className.slice(0, 40);
            return id === identity && el.className.slice(0, 40) === cls;
          });
          if (!matches.length) return false;
          matches[0].click();
          return true;
        },
        { identity: b.identity, cls: b.cls },
      );
    } catch (e) {
      drain();
      results.push({ ...b, outcome: "click-failed", detail: String(e).slice(0, 120) });
      buttons = buttons.slice(1);
      continue;
    }
    if (!hit) {
      drain();
      results.push({ ...b, outcome: "not-found" });
      buttons = buttons.slice(1);
      continue;
    }
    await page.waitForTimeout(500);
    const afterUrl = page.url();
    const errs = drain();
    const nav = afterUrl !== beforeUrl;
    const after = await scan(page);
    if (nav) {
      results.push({ ...b, outcome: "navigated", to: afterUrl, detail: (errs[0] || "").slice(0, 160) });
      // Reset to the original page and re-scan so the remaining buttons are
      // evaluated against fresh state (identities shift on reload).
      await page.goto(url, { waitUntil: "domcontentloaded" });
      try {
        await page.waitForSelector("button, [role='button']", { timeout: 8000 });
      } catch {
        /* no buttons on the reset page */
      }
      await page.waitForTimeout(500);
      buttons = await scan(page);
    } else if (errs.length) {
      results.push({ ...b, outcome: "error", detail: errs[0].slice(0, 160), all: errs.map((e) => e.slice(0, 160)) });
      // DOM may have changed under us (e.g. a collapse toggled the main panel
      // open); re-scan rather than trusting the stale snapshot.
      buttons = after;
    } else {
      // No navigation and no error: still re-scan, because toggling a sidebar
      // section reflows the whole panel (the visualizer went from 9 to 44
      // buttons when "Collapse Create" fired). Re-scan keeps the sweep honest.
      buttons = after;
    }
  }
  return { url, buttons: initialCount, results };
}

const browser = await chromium.launch({ ...CHROMIUM_LAUNCH_OPTIONS, headless: true });
const page = await browser.newPage();
const out = [];
for (const url of urls) {
  try {
    out.push(await sweep(page, url));
  } catch (e) {
    out.push({ url, error: String(e).slice(0, 200) });
  }
}
await browser.close();

console.log(JSON.stringify(out, null, 2));