#!/usr/bin/env node
/**
 * Debug test: Check what's on the experiment page
 */
import { chromium } from 'playwright';

const pageUrl = 'http://127.0.0.1:8765/chromium-experiment.html';

async function runTests() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle',
      '--enable-unsafe-swiftshader',
    ],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    const consoleLogs = [];
    page.on('console', (msg) => consoleLogs.push(`${msg.type()}: ${msg.text()}`));
    page.on('pageerror', (err) => consoleLogs.push(`PAGE ERROR: ${err.message}`));

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Check page title and body content
    const title = await page.title();
    const bodyText = await page.locator('body').innerText().catch(() => 'N/A');
    
    console.log('Page title:', title);
    console.log('Body text (first 500 chars):', bodyText.substring(0, 500));
    console.log('\nConsole logs:');
    consoleLogs.forEach((l) => console.log(`  ${l}`));

    // Check if elements exist
    const elements = ['htmlCanvas', 'webgpuBox', 'testAudio', 'cssRandomBox'];
    for (const id of elements) {
      const count = await page.locator(`#${id}`).count();
      console.log(`Element #${id}: ${count} found`);
    }

    // Try evaluating JavaScript to check feature support directly
    const featureSupport = await page.evaluate(() => {
      const results = {};
      
      // Test WebGPU
      if (navigator.gpu) {
        results.webgpu = 'available';
      } else {
        results.webgpu = 'not available';
      }

      // Test AudioContext
      if (window.AudioContext || window.webkitAudioContext) {
        results.audioContext = 'available';
      } else {
        results.audioContext = 'not available';
      }

      // Test Canvas
      const canvas = document.createElement('canvas');
      results.canvas = canvas ? 'available' : 'not available';

      // Test CSS random() - create a test element
      const testDiv = document.createElement('div');
      testDiv.style.position = 'fixed';
      testDiv.style.left = '-9999px';
      testDiv.style.top = '-9999px';
      testEl.style.width = 'random(100px, 200px)';
      document.body.appendChild(testDiv);
      const computed = window.getComputedStyle(testDiv);
      results.cssRandomWidth = computed.width;
      document.body.removeChild(testDiv);

      return results;
    });

    console.log('\nDirect feature support check:');
    console.log(featureSupport);

    await browser.close();
  } catch (err) {
    console.error('Test failed:', err);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

runTests();
