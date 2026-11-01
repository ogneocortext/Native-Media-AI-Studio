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

const pages = [
  { name: 'ollama-chat', path: '/analyze/chat', viewport: { width: 1440, height: 900 } },
  { name: 'ollama-ai-tools', path: '/analyze/ai', viewport: { width: 1440, height: 900 } },
  { name: 'ollama-health', path: '/system/health', viewport: { width: 1440, height: 900 } },
  { name: 'ollama-settings', path: '/system/settings', viewport: { width: 1440, height: 900 } },
];

for (const { name, path, viewport } of pages) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push({ source: 'console', text: msg.text() });
  });
  page.on('pageerror', err => errors.push({ source: 'pageerror', text: err.message }));
  page.on('requestfailed', req => {
    if (req.url().includes('/api/')) {
      errors.push({ source: 'requestfailed', url: req.url(), failure: req.failure()?.errorText });
    }
  });

  console.log(`Navigating to ${path}...`);
  try {
    await page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(5000);

    const screenshotPath = `packages/frontend/tests/browser/out/ollama-${name}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved: ${screenshotPath}`);

    if (errors.length > 0) {
      console.log('Errors:', JSON.stringify(errors));
    }
  } catch (e) {
    console.log(`Error navigating to ${path}: ${e}`);
  }

  await page.close();
}

await browser.close();
console.log('All Ollama page screenshots captured');
