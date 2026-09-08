import { chromium } from 'playwright';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

console.log('Navigating to Remotion Studio...');
await page.goto('http://localhost:8080', { waitUntil: 'networkidle' });
await sleep(3000);

// Take screenshot
await page.screenshot({ path: 'packages/frontend/tests/browser/out/remotion-studio.png', fullPage: false });
console.log('Screenshot saved to packages/frontend/tests/browser/out/remotion-studio.png');

await browser.close();
