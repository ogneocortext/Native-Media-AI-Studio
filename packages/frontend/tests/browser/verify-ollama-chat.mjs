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
  if (msg.type() === 'error') errors.push({ source: 'console', text: msg.text() });
});
page.on('pageerror', err => errors.push({ source: 'pageerror', text: err.message }));

console.log('Navigating to Ollama Chat page...');
await page.goto('http://localhost:5173/analyze/chat', { waitUntil: 'networkidle', timeout: 30000 });
await sleep(5000);

// Check for the "offline" message
const offlineText = await page.locator('text=offline').count();
const onlineText = await page.locator('text=online').count();
const engineStatus = await page.locator('.viz-engine-status, [class*="engine-status"], [class*="status"]').allTextContents();
console.log('Offline text count:', offlineText);
console.log('Online text count:', onlineText);
console.log('Engine status elements:', engineStatus);

// Check model selector
const modelSelect = await page.locator('select, [role="combobox"], .viz-model-select').count();
console.log('Model selector count:', modelSelect);

// Check input field
const inputField = await page.locator('textarea, input[type="text"]').count();
console.log('Input field count:', inputField);

// Check send button
const sendBtn = await page.locator('button').filter({ hasText: 'Send' }).count();
console.log('Send button count:', sendBtn);

await page.screenshot({ path: 'packages/frontend/tests/browser/out/ollama-chat-verified.png', fullPage: true });
console.log('Verification screenshot saved');

console.log('--- Errors ---');
if (errors.length === 0) console.log('(none)');
else errors.forEach(e => console.log(JSON.stringify(e)));

await browser.close();
process.exit(0);
