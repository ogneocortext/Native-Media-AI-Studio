#!/usr/bin/env node
/**
 * Test Chromium 157 features with headless shell
 * Tests: HTML-in-canvas, WebGPU color spaces, media pseudo-classes,
 *        CSS random(), WebAudio render quantum
 */
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:8765';
const pageUrl = `${base}/chromium-experiment.html`;

async function runTests() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle',
      '--enable-unsafe-swiftshader',
      '--enable-features=UnsafeSwiftshader',
    ],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();

    const consoleLogs = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleLogs.push(`ERROR: ${msg.text()}`);
    });
    page.on('pageerror', (err) => consoleLogs.push(`PAGE ERROR: ${err.message}`));

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // Check page title
    const title = await page.title();
    console.log('Page title:', title);

    // Check elements exist
    const elements = ['htmlCanvas', 'webgpuBox', 'testAudio', 'cssRandomBox'];
    for (const id of elements) {
      const count = await page.locator(`#${id}`).count();
      console.log(`Element #${id}: ${count} found`);
    }

    // Extract all test results
    const results = await page.evaluate(() => {
      const getStatus = (id) => {
        const el = document.getElementById(id);
        return el ? { text: el.textContent, className: el.className || '' } : null;
      };
      const getResult = (id) => {
        const el = document.getElementById(id);
        return el ? el.innerHTML || '' : null;
      };

      return {
        htmlCanvas: { status: getStatus('htmlCanvasStatus'), result: getResult('htmlCanvasResult') },
        webgpu: { status: getStatus('webgpuStatus'), result: getResult('webgpuResult') },
        mediaPseudo: { status: getStatus('mediaPseudoStatus'), result: getResult('mediaPseudoResult') },
        cssRandom: { status: getStatus('cssRandomStatus'), result: getResult('cssRandomResult') },
        webaudio: { status: getStatus('webaudioStatus'), result: getResult('webaudioResult') },
      };
    });

    console.log('\n=== Chromium 157 Feature Test Results ===\n');

    const features = [
      { name: 'HTML-in-Canvas', data: results.htmlCanvas },
      { name: 'WebGPU Color Spaces', data: results.webgpu },
      { name: 'Media Pseudo-Classes', data: results.mediaPseudo },
      { name: 'CSS random()', data: results.cssRandom },
      { name: 'WebAudio Render Quantum', data: results.webaudio },
    ];

    let allSupported = true;
    for (const { name, data } of features) {
      if (!data.status) {
        console.log(`✗ ${name}: NOT TESTED (element missing)`);
        allSupported = false;
        continue;
      }
      const supported = data.status.className.includes('status-supported');
      if (!supported) allSupported = false;
      console.log(`${supported ? '✓' : '✗'} ${name}`);
      console.log(`   Status: ${data.status.text}`);
      const details = data.result?.replace(/<[^>]*>/g, '') || 'N/A';
      console.log(`   Details: ${details}`);
      console.log('');
    }

    if (consoleLogs.length > 0) {
      console.log('Console logs:');
      consoleLogs.forEach((l) => console.log(`  ${l}`));
    }

    console.log(`\nOverall: ${allSupported ? 'ALL SUPPORTED' : 'SOME FEATURES NOT SUPPORTED'}`);

    return allSupported ? 0 : 1;
  } finally {
    await browser.close();
  }
}

runTests().then((code) => process.exit(code)).catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
