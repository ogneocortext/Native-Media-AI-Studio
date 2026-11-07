#!/usr/bin/env node
/**
 * walkthrough.mjs — record + analyze a multi-page UI walkthrough in one pass.
 *
 * Replaces the hand-rolled qa-*.mjs capture scripts: drives Playwright through
 * a list of routes, records a video, screenshots each page, attributes console
 * errors and >=400 responses to the page that produced them, then (with
 * --analyze) runs tools/vision/analyze.mjs per page plus a --video pass over
 * the recording, and writes a consolidated report.md / report.json.
 *
 * Usage:
 *   node tools/vision/walkthrough.mjs --pages "/library,/library/video,/analyze/audio"
 *   node tools/vision/walkthrough.mjs --spec walkthrough.json --analyze
 *   node tools/vision/walkthrough.mjs --pages "/,/create/video" --labels "dash,vid" --out ./out --no-video
 *
 * Spec file (JSON): { "base": "http://127.0.0.1:5173", "viewport": [1600,900],
 *   "dwellMs": 3000, "pages": [{"label":"library","path":"/library","dwellMs":4000}] }
 *
 * Flags:
 *   --base URL        app origin (default http://127.0.0.1:5173)
 *   --pages a,b,c     comma-separated routes; labels derived from last path segment
 *   --labels a,b,c    explicit labels, same order as --pages
 *   --spec file.json  full spec (overrides --pages/--labels/--base/--viewport)
 *   --out dir         output dir (default ./walkthrough-<timestamp> under cwd)
 *   --viewport WxH    viewport size (default 1600x900)
 *   --dwell ms        per-page settle time (default 3000)
 *   --wait-until STATE  navigation wait state: load|domcontentloaded|
 *                       networkidle|commit (default domcontentloaded).
 *                       Data-heavy pages (media library scans) still need
 *                       dwell time after this — combine with --dwell.
 *   --wait-for SEL    per-page CSS selector that must appear before the
 *                       screenshot (spec pages may also set "waitFor").
 *                       Use for skeleton→content transitions.
 *   --analyze         run per-page ui analysis + video analysis + report.md
 *   --no-video        skip Playwright video recording
 *   --video-only      skip screenshots; only record + analyze video
 *   --mode MODE       analyze mode for pages (default ui)
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const ANALYZE = path.join(HERE, 'analyze.mjs');

// Playwright is a frontend devDependency — resolve it through that package
// so this tool works from any cwd without its own node_modules.
const requireFrontend = createRequire(path.join(REPO, 'packages', 'frontend', 'package.json'));
const { chromium } = requireFrontend('playwright');

function parseArgs(argv) {
  const args = {
    base: 'http://127.0.0.1:5173',
    pages: null,
    labels: null,
    spec: null,
    out: null,
    viewport: '1600x900',
    dwellMs: 3000,
    waitUntil: 'domcontentloaded',
    waitFor: null,
    analyze: false,
    noVideo: false,
    videoOnly: false,
    mode: 'ui',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--base') args.base = next();
    else if (a === '--pages') args.pages = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--labels') args.labels = next().split(',').map((s) => s.trim());
    else if (a === '--spec') args.spec = next();
    else if (a === '--out') args.out = next();
    else if (a === '--viewport') args.viewport = next();
    else if (a === '--dwell') args.dwellMs = parseInt(next(), 10);
    else if (a === '--wait-until') args.waitUntil = next();
    else if (a === '--wait-for') args.waitFor = next();
    else if (a === '--analyze') args.analyze = true;
    else if (a === '--no-video') args.noVideo = true;
    else if (a === '--video-only') args.videoOnly = true;
    else if (a === '--mode') args.mode = next();
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function labelFor(route, idx, labels) {
  if (labels && labels[idx]) return labels[idx];
  const seg = route.split('/').filter(Boolean).pop() || 'home';
  return seg.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
}

function runAnalyze(image, label, mode, contextText, jsonOut, prompt) {
  const argv = [ANALYZE, image, '--mode', mode, '--label', label, '--json'];
  if (contextText) argv.push('--context', contextText.slice(0, 4000));
  if (prompt) argv.push('--prompt', prompt);
  const res = spawnSync(process.execPath, argv, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 300_000,
  });
  fs.writeFileSync(jsonOut, res.stdout || '');
  if (res.status !== 0) {
    console.error(`[walkthrough] analyze ${label} exited ${res.status}: ${(res.stderr || '').slice(-300)}`);
  }
  return jsonOut;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Spec file overrides individual flags. Pages normalize to objects so
  // per-page dwellMs/waitFor survive.
  let base = args.base;
  let viewport = args.viewport;
  let dwellMs = args.dwellMs;
  let waitUntil = args.waitUntil;
  let pageSpecs = (args.pages || []).map((p, i) => ({
    path: p,
    label: args.labels && args.labels[i] ? args.labels[i] : null,
    dwellMs: null,
    waitFor: args.waitFor || null,
    prompt: null,
  }));
  if (args.spec) {
    const spec = JSON.parse(fs.readFileSync(args.spec, 'utf8'));
    base = spec.base || base;
    if (spec.viewport) viewport = `${spec.viewport[0]}x${spec.viewport[1]}`;
    dwellMs = spec.dwellMs ?? dwellMs;
    waitUntil = spec.waitUntil || waitUntil;
    pageSpecs = spec.pages.map((p) =>
      typeof p === 'string'
        ? { path: p, label: null, dwellMs: null, waitFor: args.waitFor || null, prompt: null }
        : {
            path: p.path,
            label: p.label || null,
            dwellMs: p.dwellMs ?? null,
            waitFor: p.waitFor || args.waitFor || null,
            prompt: p.prompt || null,
          },
    );
  }
  if (pageSpecs.length === 0) {
    console.error('No pages. Pass --pages "/a,/b" or --spec file.json');
    process.exit(1);
  }
  const pages = pageSpecs.map((p) => p.path);
  const labels = pageSpecs.map((p) => p.label);
  const [vw, vh] = viewport.split('x').map((n) => parseInt(n, 10));

  const outDir = args.out
    ? path.resolve(args.out)
    : path.join(process.cwd(), `walkthrough-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(outDir, { recursive: true });
  const shotsDir = path.join(outDir, 'shots');
  if (!args.videoOnly) fs.mkdirSync(shotsDir, { recursive: true });

  const marks = [];
  const consoleErrors = []; // {page, text}
  const badResponses = []; // {page, status, url}
  let currentPage = 'start';

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: vw, height: vh },
    // Dedicated video dir: a stale .webm from a previous failed run in --out
    // must never be picked up as this run's recording.
    ...(args.noVideo ? {} : { recordVideo: { dir: path.join(outDir, 'video'), size: { width: vw, height: vh } } }),
  });
  const page = await context.newPage();
  // Playwright starts the webm at page creation, not at t0 — marks must use
  // this clock or video timestamps drift by the browser-launch offset.
  const videoT0 = Date.now();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push({ page: currentPage, text: m.text().slice(0, 300) });
  });
  page.on('pageerror', (e) =>
    consoleErrors.push({ page: currentPage, text: `PAGEERROR: ${String(e).slice(0, 300)}` }),
  );
  page.on('response', (r) => {
    if (r.status() >= 400)
      badResponses.push({ page: currentPage, status: r.status(), url: r.url() });
  });

  // First page: direct goto (cold load is part of the measurement).
  const settle = async (spec) => {
    const dwell = spec.dwellMs ?? dwellMs;
    await page.waitForTimeout(dwell);
    if (spec.waitFor) {
      await page.waitForSelector(spec.waitFor, { timeout: 15_000 }).catch(() => {
        console.error(`[walkthrough] waitFor "${spec.waitFor}" timed out on ${currentPage}`);
      });
      await page.waitForTimeout(400); // let the revealed content paint
    }
  };

  const firstSpec = pageSpecs[0];
  const firstLabel = labelFor(pages[0], 0, labels);
  currentPage = firstLabel;
  marks.push({ t: 0, label: firstLabel });
  await page.goto(base + pages[0], { waitUntil });
  await settle(firstSpec);
  if (!args.videoOnly) {
    await page.screenshot({ path: path.join(shotsDir, `shot-${firstLabel}.png`) });
  }

  // Remaining pages: prefer the real sidebar link (user path), goto fallback.
  for (let i = 1; i < pages.length; i++) {
    const route = pages[i];
    const spec = pageSpecs[i];
    const label = labelFor(route, i, labels);
    marks.push({ t: +(Date.now() - videoT0).toFixed(0), label });
    currentPage = label;
    const link = page.locator(`a[href="${route}"]`).first();
    if ((await link.count()) > 0) {
      await link.click().catch(async () => {
        await page.goto(base + route, { waitUntil });
      });
    } else {
      await page.goto(base + route, { waitUntil });
    }
    await settle(spec);
    if (!args.videoOnly) {
      await page.screenshot({ path: path.join(shotsDir, `shot-${label}.png`) });
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(800);
      await page.mouse.wheel(0, -500);
      await page.waitForTimeout(500);
    }
  }

  // Close context to flush the webm before reading the dir.
  await context.close();
  await browser.close();

  // recordVideo writes into outDir/video; pick the newest webm defensively.
  const videoDir = path.join(outDir, 'video');
  const scanDirs = [videoDir, outDir];
  let videoPath = null;
  let videoMtime = 0;
  for (const d of scanDirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((f) => f.endsWith('.webm'))) {
      const p = path.join(d, f);
      const mt = fs.statSync(p).mtimeMs;
      if (mt > videoMtime) { videoMtime = mt; videoPath = p; }
    }
  }

  fs.writeFileSync(path.join(outDir, 'marks.json'), JSON.stringify(marks, null, 1));
  fs.writeFileSync(path.join(outDir, 'console-errors.json'), JSON.stringify(consoleErrors, null, 1));
  fs.writeFileSync(path.join(outDir, 'bad-responses.json'), JSON.stringify(badResponses, null, 1));

  console.log(`pages: ${marks.map((m) => `${m.t}:${m.label}`).join(' ')}`);
  console.log(`console errors: ${consoleErrors.length} | bad responses: ${badResponses.length}`);
  console.log(`video: ${videoPath || '(none)'}`);
  console.log(`out: ${outDir}`);

  if (!args.analyze) return;

  // Per-page analysis — sequential on purpose: one resident vision model,
  // parallel calls would thrash the 8 GB VRAM budget.
  const report = { outDir, marks, video: videoPath, pages: {}, consoleErrors, badResponses };
  const lines = ['# Walkthrough report', ''];
  lines.push(`Pages: ${pages.length} | console errors: ${consoleErrors.length} | >=400 responses: ${badResponses.length}`);
  lines.push('');
  if (videoPath) lines.push(`Video: \`${path.basename(videoPath)}\``);
  lines.push('');

  for (const [idx, m] of marks.entries()) {
    const shot = path.join(shotsDir, `shot-${m.label}.png`);
    if (!fs.existsSync(shot)) continue;
    const pageErrors = consoleErrors.filter((e) => e.page === m.label).map((e) => e.text);
    const pageBad = badResponses.filter((r) => r.page === m.label);
    const ctxParts = [];
    if (pageErrors.length) ctxParts.push(`Console errors on this page:\n${pageErrors.join('\n')}`);
    if (pageBad.length)
      ctxParts.push(`HTTP >=400 responses on this page:\n${pageBad.map((r) => `${r.status} ${r.url}`).join('\n')}`);
    const jsonOut = path.join(outDir, `analysis-${m.label}.json`);
    console.error(`[walkthrough] analyzing ${m.label}...`);
    runAnalyze(shot, m.label, args.mode, ctxParts.join('\n\n') || null, jsonOut, pageSpecs[idx]?.prompt);
    try {
      const raw = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
      report.pages[m.label] = raw.analysis_parsed ?? raw.analysis;
      const findings = raw.analysis_parsed?.findings;
      if (Array.isArray(findings)) {
        lines.push(`## ${m.label}`, '');
        for (const f of findings) {
          const sev = f.severity ? `[${f.severity}]` : '';
          const conf = f.confidence ? ` (${f.confidence} confidence)` : '';
          lines.push(`- **${f.issue ?? f.element ?? ''}** ${sev}${conf} — ${f.fix ?? ''}`);
        }
        if (raw.analysis_parsed?.summary) lines.push('', `_${raw.analysis_parsed.summary}_`);
        lines.push('');
      }
    } catch {
      report.pages[m.label] = { error: 'unparseable analysis output' };
    }
  }

  if (videoPath) {
    const videoJson = path.join(outDir, 'analysis-video.json');
    console.error('[walkthrough] analyzing video...');
    // Feed the page marks so the model can correlate video time with routes.
    const marksContext = `Page navigation marks (seconds into the recording, label = destination page):\n${marks.map((m) => `  t=${(m.t / 1000).toFixed(1)}s -> ${m.label}`).join('\n')}`;
    const res = spawnSync(
      process.execPath,
      // Denser than analyze.mjs defaults but not maximal: gemma4:e2b-it-qat
      // degenerates (repeats one frame description across all keyframes) at
      // ~10 images; 8 keyframes kept temporal claims coherent in testing.
      [ANALYZE, '--video', videoPath, '--mode', 'video', '--json',
        '--video-frames', '32', '--video-keyframes', '8', '--context', marksContext],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600_000 },
    );
    fs.writeFileSync(videoJson, res.stdout || '');
    try {
      const raw = JSON.parse(res.stdout);
      const parsed = raw.analysis_parsed ?? raw.analysis;
      report.video_analysis = parsed;
      const transitions = parsed?.transitions;
      const overlaps = parsed?.overlaps;
      if (Array.isArray(transitions) && transitions.length) {
        lines.push('## video (temporal)', '');
        for (const tr of transitions) {
          lines.push(`- **t=${tr.t ?? '?'}** ${tr.change ?? tr.transition ?? ''} _(${tr.severity ?? 'info'})_`);
        }
        if (Array.isArray(overlaps) && overlaps.length) {
          lines.push('', '### Overlaps observed', '');
          for (const o of overlaps) {
            lines.push(`- **t=${o.t ?? '?'}** ${o.elements ?? o.issue ?? ''} _(${o.severity ?? 'info'})_`);
          }
        }
        if (parsed?.summary) lines.push('', `_${parsed.summary}_`);
        lines.push('');
      }
    } catch {
      report.video_analysis = { error: 'unparseable video analysis' };
    }
  }

  if (consoleErrors.length) {
    lines.push('## Console errors', '');
    for (const e of consoleErrors.slice(0, 30)) lines.push(`- [${e.page}] ${e.text}`);
    lines.push('');
  }
  if (badResponses.length) {
    lines.push('## HTTP >=400', '');
    for (const r of badResponses.slice(0, 30)) lines.push(`- [${r.page}] ${r.status} ${r.url}`);
    lines.push('');
  }

  fs.writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'));
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  console.log(`report: ${path.join(outDir, 'report.md')}`);
}

main().catch((e) => {
  console.error(`walkthrough failed: ${e.message}`);
  process.exit(1);
});
