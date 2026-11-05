import { chromium } from "playwright";

const b = await chromium.launch({ headless: false });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));

await p.goto("http://127.0.0.1:5173/render/visualizer", {
  waitUntil: "networkidle",
  timeout: 40000,
});
await p.waitForSelector('[data-testid="viz-track-select"]', { timeout: 30000 });
await p.waitForTimeout(3000);
await p.evaluate(() => {
  const s = document.getElementById("viz-track-select");
  const o = [...s.options].find((x) => x.textContent.includes("Clever"));
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  set.call(s, o.value);
  s.dispatchEvent(new Event("change", { bubbles: true }));
});
await p.waitForTimeout(5000);

await p.click('[data-testid="viz-inspector-toggle"]');
await p.waitForTimeout(400);
const tabs = await p.evaluate(() =>
  [...document.querySelectorAll(".viz-inspector-tab")].map((t) => t.textContent.trim()),
);
console.log("TABS", JSON.stringify(tabs));

await p.keyboard.press("Escape");
await p.click('button[aria-label="More controls"]');
await p.waitForTimeout(400);
const menu = await p.evaluate(() =>
  [...document.querySelectorAll(".viz-more-menu button")].map((b) => b.textContent.trim()),
);
console.log("MENU", JSON.stringify(menu));
await p.click('.viz-more-menu button:has-text("Remix Studio")');
await p.waitForTimeout(2500);
console.log("URL", p.url());
const state = await p.evaluate(() => ({
  pending: sessionStorage.getItem("__pendingTrackFilename"),
  open: sessionStorage.getItem("__pendingRemixOpen"),
}));
console.log("STATE", JSON.stringify(state));
await p.screenshot({ path: "packages/frontend/tests/browser/out/v13-remix-page.png" });
console.log("ERRS", JSON.stringify(errs.slice(0, 5)));
await b.close();
