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

console.log('--- Test 1: Direct fetch to backend (port 8000) ---');
const result1 = await page.evaluate(async () => {
  try {
    const res = await fetch('http://127.0.0.1:8000/api/integrations/ollama/visualizer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'test visual',
        model: 'gemma4:e2b-it-qat',
        temperature: 0.7,
        track: { bpm: 120, energy: 0.5, duration_seconds: 180, genre: 'ambient' }
      }),
    });
    return { status: res.status, ok: res.ok };
  } catch (e) {
    return { error: e.message };
  }
});
console.log('Direct backend:', JSON.stringify(result1));

console.log('--- Test 2: Proxied fetch via Vite (/api/...) ---');
const result2 = await page.evaluate(async () => {
  try {
    const res = await fetch('/api/integrations/ollama/visualizer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'test visual',
        model: 'gemma4:e2b-it-qat',
        temperature: 0.7,
        track: { bpm: 120, energy: 0.5, duration_seconds: 180, genre: 'ambient' }
      }),
    });
    return { status: res.status, ok: res.ok, url: res.url };
  } catch (e) {
    return { error: e.message };
  }
});
console.log('Proxied:', JSON.stringify(result2));

await browser.close();
process.exit(0);
