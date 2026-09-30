import { chromium } from "playwright";
const base = process.argv[2] || "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`${base}/three-js-studio`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("canvas");
await page.waitForFunction(() => !document.body.innerText.includes("Initializing 3D scene"), null, { timeout: 30000 });
await sleep(2500);
const mem = async () => page.evaluate(() => ({
  geometries: window.__renderer.info.memory.geometries,
  textures: window.__renderer.info.memory.textures,
  programs: window.__renderer.info.programs.length,
}));
const count = async () => (await page.locator(".hud").innerText()).match(/Objects\s*(\d+)/)[1];
console.log("baseline:", JSON.stringify(await mem()), "objects", await count());
for (let i = 0; i < 6; i++) {
  await page.locator('button[title="Add Sphere"]').click();
  await sleep(250);
}
await sleep(1500);
console.log("after 6 adds:", JSON.stringify(await mem()), "objects", await count());
await page.locator('button[title="Toggle controls panel"]').click();
await sleep(600);
for (let i = 0; i < 6; i++) {
  const rows = page.locator(".bottom-drawer [class*='cursor-pointer']");
  const n = await rows.count();
  let removed = false;
  for (let r = n - 1; r >= 0; r--) {
    const txt = (await rows.nth(r).innerText()).replace(/\s+/g, " ");
    if (/Sphere/.test(txt)) {
      await rows.nth(r).locator('button[title="Remove"]').click();
      removed = true;
      break;
    }
  }
  if (!removed) break;
  await sleep(400);
}
await sleep(1500);
console.log("after removing them:", JSON.stringify(await mem()), "objects", await count());
await browser.close();
