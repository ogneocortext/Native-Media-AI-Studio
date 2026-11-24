// Diffuse-wrap verification: slider -> sceneConfig -> shared uniform, and
// every standard material in the scene carries the shader patch.
import { chromium } from "playwright";
const base = "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const shaderErrors = [];
page.on("console", (m) => {
  if (/shader|webgl program|glsl/i.test(m.text()) && m.type() !== "warning") shaderErrors.push(m.text().slice(0, 200));
});
await page.goto(`${base}/create/3d`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("canvas");
await page.waitForFunction(() => !document.body.innerText.includes("Initializing 3D scene"), null, { timeout: 30000 });
await sleep(2500);

const readUniform = () => page.evaluate(() => window.__diffuseWrapUniform?.value);
console.log("uniform at boot:", await readUniform());

await page.locator('button[title="Toggle controls panel"]').click({ force: true });
await sleep(400);
await page.locator('button:has-text("Scene"):not([disabled])').last().click();
await sleep(400);
const slider = page.locator(
  'xpath=//span[normalize-space(text())="Diffuse Wrap"]/ancestor::div[2]/input[@type="range"]',
);
console.log("wrap slider found:", (await slider.count()) > 0);
await slider.evaluate((el) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(el, "1");
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(800);
console.log("uniform after slider=1:", await readUniform());

const patched = await page.evaluate(() => {
  let found = 0, total = 0;
  window.__scene.traverse((n) => {
    const m = n.material;
    if (!m) return;
    (Array.isArray(m) ? m : [m]).forEach((mm) => {
      if (mm.isMeshStandardMaterial || mm.isMeshPhysicalMaterial) {
        total++;
        if (mm.userData.__studioDiffuseWrap) found++;
      }
    });
  });
  return { patched: found, standardTotal: total };
});
console.log("materials:", JSON.stringify(patched));
console.log("shader errors:", shaderErrors.length ? shaderErrors : "none");
await browser.close();
