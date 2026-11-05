import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto("http://127.0.0.1:5173/render/visualizer", {
  waitUntil: "networkidle",
  timeout: 45000,
});
await p.waitForSelector('[data-testid="viz-track-select"]', { timeout: 30000 });
await p.click('button[aria-label="More controls"]');
await p.waitForTimeout(500);
const r = await p.evaluate(() => {
  const btn = [...document.querySelectorAll(".viz-more-menu button")].find((b) =>
    b.textContent.includes("Loop"),
  );
  if (!btn) return { err: "no btn" };
  const rc = btn.getBoundingClientRect();
  const cx = rc.x + rc.width / 2;
  const cy = rc.y + rc.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  const cs = (e) => {
    const s = getComputedStyle(e);
    return { pos: s.position, z: s.zIndex };
  };
  return {
    hit: hit ? hit.className || hit.tagName : null,
    btnRect: { x: Math.round(rc.x), y: Math.round(rc.y) },
    topbar: cs(document.querySelector(".viz-topbar")),
    menu: cs(document.querySelector(".viz-more-menu")),
    scrim: cs(document.querySelector(".viz-overlay-scrim")),
    page: cs(document.querySelector(".viz-page")),
  };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
