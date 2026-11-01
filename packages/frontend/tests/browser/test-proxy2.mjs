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

// Log ALL network activity
const apiCalls = [];
page.on('request', req => {
  if (req.url().includes('5173')) apiCalls.push({ type: 'request', url: req.url(), method: req.method() });
});
page.on('response', res => {
  if (res.url().includes('5173')) apiCalls.push({ type: 'response', url: res.url(), status: res.status() });
});
page.on('requestfailed', req => {
  if (req.url().includes('5173')) apiCalls.push({ type: 'failed', url: req.url(), failure: req.failure()?.errorText });
});

console.log('Navigating to visualizer...');
await page.goto('http://localhost:5173/render/visualizer', { waitUntil: 'networkidle' });
await sleep(3000);

// Try a simple GET through the proxy
console.log('--- Testing proxy GET /api/health ---');
const healthResult = await page.evaluate(async () => {
  try {
    const res = await fetch('/api/health');
    return { status: res.status, ok: res.ok, body: await res.text().slice(0, 200) };
  } catch (e) {
    return { error: e.message };
  }
});
console.log('Health via proxy:', JSON.stringify(healthResult));

// Try POST through the proxy
console.log('--- Testing proxy POST /api/integrations/ollama/visualizer ---');
const postResult = await page.evaluate(async () => {
  try {
    const res = await fetch('/api/integrations/ollama/visualizer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'test', model: 'gemma4:e2b-it-qat', temperature: 0.7, track: {} }),
    });
    const body = await res.text();
    return { status: res.status, ok: res.ok, body: body.slice(0, 500) };
  } catch (e) {
    return { error: e.message };
  }
});
console.log('POST via proxy:', JSON.stringify(postResult));

console.log('--- All API calls ---');
if (apiCalls.length === 0) console.log('(none)');
else apiCalls.slice(0, 20).forEach(c => console.log(JSON.stringify(c)));

await browser.close();
process.exit(0);
