import { chromium } from 'playwright';
const APP_URL = 'http://[::1]:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', msg => { if (msg.type()==='error') errors.push(msg.text()); });
page.on('pageerror', e => errors.push(e.message));
page.on('requestfailed', r => errors.push(`failed:${r.url()} ${r.failure()?.errorText}`));

console.log('goto visualizer');
await page.goto(`${APP_URL}/visualizer`, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(2000);

// Check visualizer loaded
const title = await page.title();
console.log('title', title);
const url = page.url();
console.log('url', url);

// Check for key elements
const checks = {};
checks.visualizerPage = await page.locator('.viz-page').count();
checks.canvas = await page.locator('canvas').count();
checks.trackSelector = await page.locator('.viz-track-select').count();
checks.aiPanelBtn = await page.locator('button:has-text("AI")').count();
checks.shaderBtn = await page.locator('button[title*="Shader"]').count();
checks.lrcOverlay = await page.locator('.viz-lyrics').count();
checks.canvasWrap = await page.locator('.viz-canvas-wrap').count();

console.log('checks', JSON.stringify(checks, null, 2));

// Try opening AI panel
const aiBtn = page.locator('.viz-ai-toggle, button:has-text("AI generate")').first();
if (await aiBtn.count()) {
  await aiBtn.click();
  await page.waitForTimeout(800);
  console.log('AI panel opened');
  const gallery = await page.locator('.viz-gallery, .viz-ai-panel').count();
  console.log('gallery/panel count', gallery);
  const presetCards = await page.locator('.viz-gallery-card').count();
  console.log('presetCards', presetCards);
}

// Check for LRC-related console / network
const hasLrcSync = await page.evaluate(() => {
  return {
    hasLrcVizController: !!document.querySelector('[data-section]'),
    hasVizLyrics: !!document.querySelector('.viz-lyrics'),
    bodyText: document.body.innerText.slice(0,500)
  };
});
console.log('hasLrc', JSON.stringify(hasLrcSync, null, 2));

// Screenshot
await page.screenshot({ path: 'packages/frontend/tests/browser/out/visualizer-lrc.png', fullPage: true });
console.log('screenshot saved');

// Check for JS errors
console.log('errors', errors.slice(0,10));

// Test API: check visualization-presets
const apiCheck = await page.evaluate(async () => {
  try {
    const r = await fetch('/api/integrations/visualization-presets');
    const j = await r.json();
    return {ok:true, count: j.count, presets: j.presets?.length};
  } catch(e){ return {ok:false, err:e.message} }
});
console.log('api presets', apiCheck);

// Check backend health
const health = await page.evaluate(async () => {
  try {
    const r = await fetch('/api/health/ping');
    return await r.json();
  } catch(e){ return {err:e.message} }
});
console.log('health', health);

await browser.close();
console.log('done');
