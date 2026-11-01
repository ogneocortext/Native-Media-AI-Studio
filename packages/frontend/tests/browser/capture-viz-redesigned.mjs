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

console.log('Navigating to visualizer...');
await page.goto('http://localhost:5173/render/visualizer', { waitUntil: 'networkidle' });
await sleep(3000);

// Test 1: Click more toggle using data-testid (no force needed)
console.log('--- Test 1: Open more menu via data-testid ---');
await page.locator('[data-testid="viz-more-toggle"]').click();
await sleep(1000);
console.log('More menu opened');

// Test 2: Click AI toggle from within the open menu (previously intercepted!)
console.log('--- Test 2: Open AI panel from open menu (previously intercepted) ---');
await page.locator('[data-testid="viz-ai-toggle"]').click();
await sleep(2000);
console.log('AI panel opened');

// Test 3: Click generate button using data-testid (no force needed)
console.log('--- Test 3: Enter description and click generate ---');
await page.locator('[data-testid="viz-ai-input"]').fill('dark phonk with aggressive red glitch');
await sleep(500);
await page.locator('[data-testid="viz-ai-generate"]').click();
console.log('Generate clicked');

// Wait for generation
let loading = true;
let elapsed = 0;
while (loading && elapsed < 120000) {
  await sleep(5000);
  elapsed += 5000;
  loading = await page.locator('[data-testid="viz-ai-generate"][disabled]').count() > 0;
  console.log(`Still loading... ${elapsed/1000}s`);
}
console.log(`Loading done after ${elapsed/1000}s`);

await page.screenshot({ path: 'packages/frontend/tests/browser/out/viz-ui-redesigned.png', fullPage: true });

const presetName = await page.locator('.viz-ai-preview-name').textContent().catch(() => '(none)');
console.log('Generated preset name:', presetName);

const errorMsg = await page.locator('.viz-ai-error').textContent().catch(() => '(none)');
console.log('Error message:', errorMsg);

const applyBtn = await page.locator('[data-testid="viz-ai-apply"]').count();
console.log('Apply button present:', applyBtn > 0);

console.log('--- Errors ---');
if (errors.length === 0) console.log('(none)');
else errors.forEach(e => console.log(JSON.stringify(e)));

await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
