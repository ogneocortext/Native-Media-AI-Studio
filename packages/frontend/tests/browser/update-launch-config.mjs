#!/usr/bin/env node
/**
 * Update all browser test scripts to use shared launchChromium()
 * Replaces inline chromium.launch() calls with launchChromium()
 */
import { readFileSync, writeFileSync } from 'fs';

const files = [
  'capture-viz-timing.mjs',
  'capture-interaction-states.mjs',
  'polish-audit-av-shots.mjs',
  'chromium-debug.mjs',
  'polish-audit-shots.mjs',
  'capture\\capture-viz-timing.mjs',
  'polish-audit-viz-2d3d.mjs',
  'debug-audio.mjs',
  'capture\\record-geometric.mjs',
  'polish-audit-viz-audio.mjs',
  'capture\\shot-preview.mjs',
  'debug-cors.mjs',
  'capture\\shot.mjs',
  'debug-cors2.mjs',
  'polish-audit-viz-modes.mjs',
  'diag-audio-skip.mjs',
  'audit\\three-studio-audit-checks.mjs',
  'debug\\adhoc-audio-analysis.mjs',
  'debug\\debug-audio.mjs',
  'polish-audit-viz-modes.mjs',
  'debug\\debug-cors.mjs',
  'debug\\debug-cors2.mjs',
  'debug\\debug-page.mjs',
  'debug\\diag-audio-skip.mjs',
  'shot-preview.mjs',
  'shot.mjs',
  'theatre-debug.mjs',
  'theatre-final-test.mjs',
  'visualizer-lrc.mjs',
];

const baseDir = 'D:\\Backup of Important Data for Windows 11 Upgrade\\Native Media AI Studio\\packages\\frontend\\tests\\browser';

for (const file of files) {
  const path = baseDir + '\\' + file;
  try {
    let content = readFileSync(path, 'utf8');
    
    // Skip if already using launchChromium
    if (content.includes('launchChromium')) {
      console.log(`SKIP (already uses launchChromium): ${file}`);
      continue;
    }
    
    // Replace chromium.launch({ headless: true }) with launchChromium()
    content = content.replace(
      /chromium\.launch\(\{ headless: true \}\)/g,
      'launchChromium()'
    );
    
    // Replace chromium.launch({ headless: false }) with launchChromium({ headless: false })
    content = content.replace(
      /chromium\.launch\(\{ headless: false \}\)/g,
      'launchChromium({ headless: false })'
    );
    
    // Replace chromium.launch({ headless: true, args: [...] }) with launchChromium({ args: [...] })
    content = content.replace(
      /chromium\.launch\(\{ headless: true, args: \[([^\]]+)\] \}\)/g,
      'launchChromium({ args: [$1] })'
    );
    
    // Replace chromium.launch({ args: [...] }) with launchChromium({ args: [...] })
    content = content.replace(
      /chromium\.launch\(\{ args: \[([^\]]+)\] \}\)/g,
      'launchChromium({ args: [$1] })'
    );
    
    // Replace chromium.launch({}) with launchChromium()
    content = content.replace(
      /chromium\.launch\(\{\}\)/g,
      'launchChromium()'
    );
    
    // Add import for launchChromium if not already present
    if (!content.includes('from "./browser-launch.mjs"')) {
      content = content.replace(
        /^import \{ chromium \} from 'playwright';/,
        "import { chromium } from 'playwright';\nimport { launchChromium } from './browser-launch.mjs';"
      );
    }
    
    writeFileSync(path, content);
    console.log(`UPDATED: ${file}`);
  } catch (err) {
    console.error(`ERROR updating ${file}: ${err.message}`);
  }
}

console.log('\nDone updating test scripts.');
