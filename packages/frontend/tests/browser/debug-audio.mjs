#!/usr/bin/env node
import { launchChromium } from "./browser-launch.mjs";
const base = process.argv[2] || "http://127.0.0.1:5173";
const browser = await launchChromium();
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto(`${base}/analyze/audio`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  const result = await page.evaluate(() => document.title);
  console.log(JSON.stringify({ title: result }));
} finally {
  await browser.close();
}
