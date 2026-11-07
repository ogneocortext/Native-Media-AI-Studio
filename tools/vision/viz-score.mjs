#!/usr/bin/env node
/**
 * viz-score.mjs — score each captured visualizer mode from a viz-capture
 * recording. Slices the webm per mode segment, grabs N frames from the
 * steady-state window (after the mode-fade settle, before the next switch),
 * runs analyze.mjs --mode vizmode on each mode's frame set, and writes a
 * ranked scorecard.md / scorecard.json.
 *
 * Works with either vision backend output:
 *   - gemma4 → analysis_parsed.scores (JSON schema)
 *   - qwen3.5 → === SCORES === text section (thinking mode, no JSON schema)
 *
 * Usage:
 *   node tools/vision/viz-score.mjs --dir ./viz-capture-2026-...
 *   node tools/vision/viz-score.mjs --dir ./viz-capture-... --model qwen3.5:4b --frames 4
 *   node tools/vision/viz-score.mjs --dir ./viz-capture-... --only "2d:bars,shader:neonRain"
 *   node tools/vision/viz-score.mjs --dir ./viz-capture-... --skip-analyze   # frames only
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeVideo } from './video-frames.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANALYZE = path.join(HERE, 'analyze.mjs');

const SCORE_KEYS = ['composition', 'reactivity', 'readability', 'motion', 'color', 'polish', 'overall'];

function parseArgs(argv) {
  const args = { dir: null, model: null, frames: 3, only: null, skipAnalyze: false, fps: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--dir') args.dir = next();
    else if (a === '--model') args.model = next();
    else if (a === '--frames') args.frames = parseInt(next(), 10);
    else if (a === '--only') args.only = next();
    else if (a === '--skip-analyze') args.skipAnalyze = true;
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

function findVideo(dir) {
  const candidates = [];
  for (const d of [path.join(dir, 'video'), dir]) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((f) => f.endsWith('.webm'))) {
      candidates.push({ path: path.join(d, f), mtime: fs.statSync(path.join(d, f)).mtimeMs });
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path || null;
}

/** Grab one PNG at `sec` via input-side seek (fast, keyframe-accurate enough
 *  for UI capture — the canvas repaints every frame anyway). */
function grabFrame(videoPath, sec, outPath) {
  execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-ss', sec.toFixed(2), '-i', videoPath,
      '-frames:v', '1', '-y', outPath],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

/** Parse the === SCORES === section of qwen structured text into an object. */
function parseTextScores(text) {
  const m = String(text || '').match(/===\s*SCORES\s*===([\s\S]*?)(?====|$)/i);
  if (!m) return null;
  const scores = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*([a-z_]+)\s*:\s*([\d.]+)/i);
    if (kv) scores[kv[1].toLowerCase()] = parseFloat(kv[2]);
  }
  return Object.keys(scores).length ? scores : null;
}

function parseTextList(text, section) {
  const m = String(text || '').match(new RegExp(`===\\s*${section}\\s*===([\\s\\S]*?)(?====|$)`, 'i'));
  if (!m) return [];
  return m[1].split('\n')
    .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((l) => l.length > 3 && !l.startsWith('==='));
}

function parseTextFindings(text) {
  const m = String(text || '').match(/===\s*FINDINGS\s*===([\s\S]*?)(?====|$)/i);
  if (!m) return [];
  const out = [];
  for (const line of m[1].split('\n')) {
    const f = line.match(/\[SEVERITY:\s*(\w+)\]\s*([^|]+)\|\s*Issue:\s*([^|]+)\|\s*(?:Shortest\s+)?Fix:\s*(.+)/i);
    if (f) out.push({ severity: f[1].toLowerCase(), element: f[2].trim(), issue: f[3].trim(), fix: f[4].trim() });
  }
  return out;
}

function normalizeResult(raw) {
  // gemma path: analysis_parsed is the schema-shaped object
  const parsed = raw?.analysis_parsed;
  if (parsed && typeof parsed === 'object') {
    return {
      scores: parsed.scores || null,
      strengths: parsed.strengths || [],
      findings: parsed.findings || [],
      topFixes: parsed.top_fixes || [],
      summary: parsed.summary || '',
      uncertain: parsed.uncertain || [],
      format: 'json',
    };
  }
  // qwen path: structured text
  const text = typeof raw?.analysis === 'string' ? raw.analysis : '';
  return {
    scores: parseTextScores(text),
    strengths: parseTextList(text, 'STRENGTHS'),
    findings: parseTextFindings(text),
    topFixes: parseTextList(text, 'TOP 3 FIXES'),
    summary: (text.match(/===\s*OBSERVATION\s*===([\s\S]*?)(?====|$)/i)?.[1] || '').split('\n').slice(-2).join(' ').trim(),
    uncertain: parseTextList(text, 'UNCERTAIN'),
    format: 'text',
  };
}

function runAnalyze(frames, label, context, jsonOut, model) {
  const argv = [ANALYZE, ...frames, '--mode', 'vizmode', '--label', label, '--json'];
  if (context) argv.push('--context', context.slice(0, 4000));
  if (model) argv.push('--model', model);
  const res = spawnSync(process.execPath, argv, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 420_000,
  });
  fs.writeFileSync(jsonOut, res.stdout || '');
  if (res.status !== 0) {
    console.error(`[viz-score] analyze ${label} exited ${res.status}: ${(res.stderr || '').slice(-300)}`);
    return null;
  }
  try {
    return JSON.parse(res.stdout);
  } catch {
    return { analysis: res.stdout, analysis_parsed: null };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) {
    console.error('Missing --dir <viz-capture output dir>');
    process.exit(1);
  }
  const dir = path.resolve(args.dir);
  const manifestPath = path.join(dir, 'marks.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`No marks.json in ${dir} — run viz-capture.mjs first`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const videoPath = manifest.video || findVideo(dir);
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error('No .webm recording found — recapture without --no-video');
    process.exit(1);
  }
  const meta = probeVideo(videoPath);
  const durationMs = meta?.duration ? meta.duration * 1000 : Infinity;
  console.log(`video: ${path.basename(videoPath)} ${meta?.duration?.toFixed(1) ?? '?'}s ${meta?.width}x${meta?.height}`);

  let modes = manifest.modes || [];
  if (args.only) {
    const want = new Set(args.only.split(',').map((s) => s.trim()));
    modes = modes.filter((m) => want.has(`${m.kind}:${m.id}`) || want.has(m.id) || want.has(m.kind));
  }
  if (!modes.length) {
    console.error('No modes to score');
    process.exit(1);
  }

  const framesDir = path.join(dir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  const settle = manifest.settleMs ?? 1200;
  const dwell = manifest.dwellMs ?? 6000;

  const results = [];
  for (const [i, m] of modes.entries()) {
    const segStart = m.t;
    const segEnd = modes[i + 1]?.t ?? Math.min(durationMs, segStart + settle + dwell + 2000);
    // Steady-state window: skip the settle + first fifth of dwell (mode fade
    // + any transition), stop before the next switch begins.
    const winStart = segStart + settle + dwell * 0.15;
    const winEnd = Math.min(segEnd - 300, segStart + settle + dwell * 0.9);
    const span = Math.max(winEnd - winStart, 500);
    const modeDir = path.join(framesDir, `${m.kind}__${m.id}`);
    fs.mkdirSync(modeDir, { recursive: true });

    const frames = [];
    for (let f = 0; f < args.frames; f++) {
      const frac = args.frames === 1 ? 0.5 : f / (args.frames - 1);
      const sec = (winStart + span * frac) / 1000;
      const out = path.join(modeDir, `f${f + 1}.png`);
      try {
        grabFrame(videoPath, sec, out);
        frames.push(out);
      } catch (e) {
        console.error(`[viz-score] frame grab failed for ${m.label} @${sec.toFixed(1)}s: ${e.message}`);
      }
    }
    if (!frames.length) {
      results.push({ mode: m, error: 'no frames extracted' });
      continue;
    }
    console.log(`[viz-score] ${i + 1}/${modes.length} ${m.label} — ${frames.length} frames`);
    if (args.skipAnalyze) {
      results.push({ mode: m, frames });
      continue;
    }

    const context = [
      `Visualizer mode under test: ${m.kind}${m.id !== m.kind ? ` / ${m.id}` : ''} (${m.label}).`,
      `Track: ${manifest.track || 'unknown'}.`,
      `Frames are chronological samples from one continuous playback session; the canvas chrome (topbar, preset bar, inspector) is part of the page, score the visualization stage itself.`,
    ].join(' ');
    const raw = runAnalyze(frames, `${m.kind}:${m.id}`, context, path.join(dir, `analysis-${m.kind}-${m.id}.json`), args.model);
    const norm = normalizeResult(raw || {});
    results.push({ mode: m, ...norm, analysisFile: `analysis-${m.kind}-${m.id}.json` });
  }

  // Scorecard — sorted by overall desc, unscored last.
  const scored = results
    .map((r) => ({ ...r, overall: r.scores?.overall ?? null }))
    .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

  const card = ['# Visualizer mode scorecard', ''];
  card.push(`Track: ${manifest.track || '?'} | modes: ${results.length} | frames/mode: ${args.frames}`);
  card.push('');
  card.push('| # | Mode | Overall | Comp | React | Read | Motion | Color | Polish | Findings |');
  card.push('|---|------|---------|------|-------|------|--------|-------|--------|----------|');
  scored.forEach((r, i) => {
    const s = r.scores || {};
    const cell = (k) => (typeof s[k] === 'number' ? s[k].toFixed(1) : '—');
    card.push(`| ${i + 1} | ${r.mode.label} | ${cell('overall')} | ${cell('composition')} | ${cell('reactivity')} | ${cell('readability')} | ${cell('motion')} | ${cell('color')} | ${cell('polish')} | ${r.findings?.length ?? 0} |`);
  });
  card.push('');
  for (const r of scored) {
    card.push(`## ${r.mode.label} — ${r.overall ?? 'unscored'}/5`, '');
    if (r.summary) card.push(`_${r.summary}_`, '');
    if (r.strengths?.length) {
      card.push('**Strengths:**');
      for (const s of r.strengths.slice(0, 4)) card.push(`- ${s}`);
      card.push('');
    }
    if (r.findings?.length) {
      card.push('**Findings:**');
      for (const f of r.findings.slice(0, 6)) {
        card.push(`- [${f.severity ?? 'info'}] ${f.element ? `${f.element}: ` : ''}${f.issue ?? ''} → ${f.fix ?? ''}`);
      }
      card.push('');
    }
    if (r.topFixes?.length) {
      card.push('**Top fixes:**');
      r.topFixes.slice(0, 3).forEach((f, i) => card.push(`${i + 1}. ${f}`));
      card.push('');
    }
  }
  fs.writeFileSync(path.join(dir, 'scorecard.md'), card.join('\n'));
  fs.writeFileSync(path.join(dir, 'scorecard.json'), JSON.stringify({ manifest, results: scored }, null, 1));
  console.log(`scorecard: ${path.join(dir, 'scorecard.md')}`);
}

main().catch((e) => {
  console.error(`viz-score failed: ${e.message}`);
  process.exit(1);
});
