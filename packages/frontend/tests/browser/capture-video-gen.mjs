import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-gl=angle",
      "--enable-unsafe-swiftshader",
      "--enable-features=UnsafeSwiftshader",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[CONSOLE ${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[PAGE ERROR] ${err.message}`));

  await page.goto("http://localhost:5173/create/video", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });

  await page.waitForTimeout(3000);

  const outDir = path.resolve("tests/browser/out");
  fs.mkdirSync(outDir, { recursive: true });
  const screenshotPath = path.join(outDir, "video-generation-screenshot.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log(`Screenshot saved: ${screenshotPath}`);
  console.log(`Errors captured: ${errors.length}`);
  for (const e of errors) console.log(e);

  const title = await page.title();
  console.log(`Page title: ${title}`);
  console.log(`URL: ${page.url()}`);

  await browser.close();
})().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
