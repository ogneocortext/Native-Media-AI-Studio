import { chromium } from 'playwright';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const sizes = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'small-laptop', width: 768, height: 600 },
  { name: 'tablet', width: 1024, height: 768 },
];

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

for (const { name, width, height } of sizes) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push({ source: 'console', text: msg.text() });
  });

  console.log(`Navigating to visualizer at ${width}x${height}...`);
  await page.goto('http://localhost:5173/render/visualizer', { waitUntil: 'networkidle' });
  await sleep(3000);

  const path = `packages/frontend/tests/browser/out/viz-small-${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`Screenshot saved: ${path}`);

  if (errors.length > 0) {
    console.log('Errors:', JSON.stringify(errors));
  }

  await page.close();
}

await browser.close();
console.log('All screenshots captured');
