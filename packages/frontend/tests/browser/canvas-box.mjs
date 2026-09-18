#!/usr/bin/env node
/** Print the visualizer canvas bounding box (CSS px) as JSON. */
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: false,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await page.goto(`${base}/visualizer`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.viz-canvas-wrap canvas', { timeout: 60000 });
await page.waitForTimeout(2000);
const box = await page.locator('.viz-canvas-wrap canvas').first().boundingBox();
console.log(JSON.stringify(box));
await browser.close();
