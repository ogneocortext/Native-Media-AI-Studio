#!/usr/bin/env node
// Summarize the last browser-test run. Shows pass/fail per step and lists problems.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportPath = resolve(__dirname, '..', '..', '..', '..', '..',
  'Self-Built-Web-and-Mobile-Apps', 'Moto Monitor (Created June 2026)',
  'browser-test', 'out', 'report.json');

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch {
  console.log('No report found. Run the browser test first: node browser-test/run.mjs');
  process.exit(1);
}

console.log(`Report: ${report.startedAt} → ${report.finishedAt}`);
console.log(`Status text: ${report.statusText ?? 'n/a'}`);
console.log(`Total problems: ${report.totalProblems}`);
console.log('');

let failures = 0;
for (const s of report.steps) {
  const flag = !s.ok ? 'X' : s.problems.length ? '!' : '.';
  if (!s.ok) failures++;
  console.log(`  [${flag}] ${s.name}${s.error ? '  → ' + s.error.split('\n')[0] : ''}`);
  for (const p of s.problems || []) {
    const msg =
      p.kind === 'pageerror' ? `PAGEERROR: ${p.text}` :
      p.kind === 'requestfailed' ? `REQFAIL: ${p.method} ${p.url} (${p.error})` :
      p.kind === 'response-bad' ? `HTTP ${p.status}: ${p.method} ${p.url}` :
      `${p.type.toUpperCase()}: ${p.text}`;
    console.log('        ' + msg.slice(0, 300));
  }
}

console.log('');
console.log(failures ? `⚠ ${failures} step(s) failed.` : '✓ All steps passed.');
process.exit(failures ? 1 : 0);
