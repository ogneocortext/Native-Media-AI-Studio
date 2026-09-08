import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on('console', msg => {
  if (['error','warning'].includes(msg.type())) errors.push(`${msg.type()}: ${msg.text()}`);
});
page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));

await page.goto('http://localhost:5174/audio-analysis', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const fs = await import('fs');
fs.mkdirSync('packages/frontend/tests/browser/out', { recursive: true });
await page.screenshot({ path: 'packages/frontend/tests/browser/out/audio-analysis-full.png', fullPage: true });
await page.screenshot({ path: 'packages/frontend/tests/browser/out/audio-analysis-viewport.png' });

const report = {
  url: page.url(),
  title: await page.title(),
  consoleErrors: errors,
  bodyLength: await page.evaluate(() => document.body.innerHTML.length),
  bodySnippet: await page.evaluate(() => document.body.innerHTML.slice(0, 500)),
};

fs.writeFileSync('packages/frontend/tests/browser/out/audio-analysis-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
