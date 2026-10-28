#!/usr/bin/env node
/**
 * Shared browser launch configuration for headless Chromium testing.
 *
 * Provides consistent launch options across all browser test scripts,
 * ensuring GPU acceleration is available for WebGL/WebGPU features
 * in headless mode.
 *
 * Usage:
 *   import { launchChromium, chromiumLaunchOptions } from './browser-launch.mjs';
 *   const browser = await launchChromium();
 */

import { chromium } from 'playwright';

/**
 * Standard launch arguments for headless Chromium.
 * Includes GPU acceleration flags needed for WebGL/WebGPU in headless mode.
 */
export const CHROMIUM_ARGS = [
  '--use-gl=angle',
  '--enable-unsafe-swiftshader',
  '--enable-features=UnsafeSwiftshader',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-gpu-sandbox',
];

/**
 * Standard launch options for headless Chromium.
 */
export const CHROMIUM_LAUNCH_OPTIONS = {
  headless: true,
  args: CHROMIUM_ARGS,
};

/**
 * Launch a Chromium browser with consistent options for headless testing.
 *
 * @param {Object} options - Additional launch options to merge
 * @returns {Promise<import('playwright').Browser>}
 */
export async function launchChromium(options = {}) {
  return await chromium.launch({
    ...CHROMIUM_LAUNCH_OPTIONS,
    ...options,
    args: [...CHROMIUM_ARGS, ...(options.args || [])],
  });
}

/**
 * Check if WebGPU is available in the current browser context.
 * Returns false if dxcompiler.dll or other dependencies are missing
 * (common in headless Windows environments).
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
export async function isWebGPUAvailable(page) {
  return await page.evaluate(() => {
    if (!navigator.gpu) return false;
    try {
      // Try requesting an adapter - this will fail if dxcompiler.dll is missing
      return navigator.gpu.requestAdapter().then(
        () => true,
        () => false
      );
    } catch {
      return false;
    }
  });
}

/**
 * Check if WebAudio renderSizeHint is supported.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
export async function isWebAudioRenderSizeHintAvailable(page) {
  return await page.evaluate(() => {
    if (!window.AudioContext && !window.webkitAudioContext) return false;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      new AudioContext({ renderSizeHint: 'hardware' }).close();
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Check if CSS random() function is supported.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
export async function isCssRandomSupported(page) {
  return await page.evaluate(() => {
    const testEl = document.createElement('div');
    testEl.style.position = 'fixed';
    testEl.style.left = '-9999px';
    testEl.style.top = '-9999px';
    testEl.style.width = 'random(100px, 200px)';
    document.body.appendChild(testEl);
    const computed = window.getComputedStyle(testEl);
    const width = computed.width;
    document.body.removeChild(testEl);
    const widthNum = parseFloat(width);
    return /^\d+(\.\d+)?px$/.test(width) && widthNum >= 90 && widthNum <= 210;
  });
}

/**
 * Check if media element pseudo-classes (:playing, :paused, etc.) are supported.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
export async function isMediaPseudoClassesSupported(page) {
  return await page.evaluate(() => {
    const testAudio = document.createElement('audio');
    document.body.appendChild(testAudio);
    let result = false;
    try {
      await testAudio.play().catch(() => {});
      const computed = window.getComputedStyle(testAudio, ':playing');
      result = computed && computed.display !== 'none';
      testAudio.pause();
    } catch {
      result = false;
    }
    document.body.removeChild(testAudio);
    return result;
  });
}

/**
 * Check if HTML-in-canvas is supported.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
export async function isHtmlInCanvasSupported(page) {
  return await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    if (!canvas || !canvas.getContext) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    try {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjNDRhZTgwIi8+PC9zdmc+';
      return new Promise((resolve) => {
        img.onload = () => {
          try {
            ctx.drawImage(img, 0, 0, 100, 100);
            resolve(true);
          } catch {
            resolve(false);
          }
        };
        img.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  });
}

/**
 * Run all Chromium feature checks and return results.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Object>}
 */
export async function checkAllChromiumFeatures(page) {
  return {
    webgpu: await isWebGPUAvailable(page),
    webaudioRenderSizeHint: await isWebAudioRenderSizeHintAvailable(page),
    cssRandom: await isCssRandomSupported(page),
    mediaPseudoClasses: await isMediaPseudoClassesSupported(page),
    htmlInCanvas: await isHtmlInCanvasSupported(page),
  };
}
