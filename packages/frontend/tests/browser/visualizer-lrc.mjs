import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTS_PATH = path.resolve(__dirname, '..', '..', '..', 'config', 'ports.json');
let ports = {};
try {
  if (fs.existsSync(PORTS_PATH)) {
    ports = JSON.parse(fs.readFileSync(PORTS_PATH, 'utf-8'));
  }
} catch { /* ignore */ }
const APP_URL = process.env.VITE_URL || ports.frontend_url || `http://127.0.0.1:${ports.frontend_port || 5173}`;

const browser = await chromium.launch({ headless: true });
try {
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
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, 'visualizer-lrc.png'), fullPage: true });
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
} finally {
  await browser.close();
}
console.log('done');
