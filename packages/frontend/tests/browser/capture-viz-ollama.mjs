import { chromium } from 'playwright';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-gl=angle',
    '--enable-unsafe-swiftshader',
    '--enable-features=UnsafeSwiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-gpu-sandbox',
  ],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', msg => {
  if (msg.type() === 'error') errors.push({ source: 'console-error', text: msg.text() });
});
page.on('pageerror', err => errors.push({ source: 'pageerror', text: err.message }));
page.on('requestfailed', req => {
  if (req.url().includes('/api/')) {
    errors.push({ source: 'requestfailed', url: req.url(), failure: req.failure()?.errorText });
  }
});
page.on('response', res => {
  if (res.url().includes('/api/integrations/ollama/visualizer')) {
    console.log(`[API RESPONSE] ${res.status} ${res.url()}`);
  }
});

console.log('Navigating to visualizer...');
await page.goto('http://localhost:5173/render/visualizer', { waitUntil: 'networkidle' });
await sleep(5000);

// Open more menu and AI panel
await page.locator('.viz-more-menu-toggle').first().click({ force: true });
await sleep(1000);
await page.locator('[aria-label="AI generate preset"]').first().click({ force: true });
await sleep(2000);

// Enter description
const taValue = await page.evaluate(() => {
  const ta = document.querySelector('textarea.viz-ai-input');
  if (!ta) return null;
  ta.value = 'dark phonk with aggressive red glitch';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return ta.value;
});
console.log('Textarea value:', taValue);

// Click Generate and wait full 120s
console.log('Clicking Generate...');
await page.locator('.viz-ai-generate-btn').first().click({ force: true });

let loading = true;
let elapsed = 0;
while (loading && elapsed < 130000) {
  await sleep(10000);
  elapsed += 10000;
  loading = await page.locator('.viz-ai-generate-btn[disabled]').count() > 0;
  console.log(`Still loading... ${elapsed/1000}s`);
}
console.log(`Loading done after ${elapsed/1000}s`);

await page.screenshot({ path: 'packages/frontend/tests/browser/out/viz-ollama-final.png', fullPage: true });

const presetName = await page.locator('.viz-ai-preview-name').textContent().catch(() => '(none)');
console.log('Generated preset name:', presetName);

const errorMsg = await page.locator('.viz-ai-error').textContent().catch(() => '(none)');
console.log('Error message:', errorMsg);

console.log('--- Errors ---');
if (errors.length === 0) console.log('(none)');
else errors.forEach(e => console.log(JSON.stringify(e)));

await browser.close();
process.exit(0);
