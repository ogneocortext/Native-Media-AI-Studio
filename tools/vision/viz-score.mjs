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

function parseArgs(argv) {
  const args = { dir: null, model: null, frames: 3, only: null, skipAnalyze: false, fromAnalyses: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--dir') args.dir = next();
    else if (a === '--model') args.model = next();
    else if (a === '--frames') args.frames = Math.max(1, parseInt(next(), 10) || 3);
    else if (a === '--only') args.only = next();
    else if (a === '--skip-analyze') args.skipAnalyze = true;
    else if (a === '--from-analyses') args.fromAnalyses = true;
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
export function parseTextScores(text) {
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

/** Parse one [SEVERITY: x] block. Models emit two shapes:
 *  a) inline:  "[SEVERITY: major] elem | issue | fix"
 *  b) block:   "[SEVERITY: major] Element | Issue | Shortest Fix" (literal
 *     header echo) followed by prose lines — last line is the fix.
 *  Returns {severity, element, issue, fix} or null. */
function parseSeverityBlock(sev, rest, followingLines) {
  const severity = sev.toLowerCase();
  let body = rest.trim();
  // Strip a literal column-header echo: "Element | Issue | Shortest Fix".
  body = body.replace(/^Element\s*\|\s*Issue\s*\|\s*(Shortest\s+)?Fix\s*$/i, '').trim();
  if (body.includes('|')) {
    // Drop literal column-header tokens models echo back ("Element", "Issue",
    // "Shortest Fix") — observed in real qwen output as a 4-col row where
    // cols[0] === 'Element' literally.
    const cols = body.split('|').map((c) => c.trim()).filter(Boolean)
      .filter((c) => !/^(element|issue|shortest fix|fix|severity|description|details?)$/i.test(c));
    if (cols.length >= 3) {
      return { severity, element: cols[0], issue: cols[1], fix: cols.slice(2).join(' | ') };
    }
    // 1-2 real cols: fold into the prose path so continuation lines survive.
    body = cols.join(' | ');
  }
  // Block format: gather following prose lines until the next severity tag
  // or section end. Issue = all but last line; fix = last line.
  const prose = [];
  for (const l of followingLines) {
    if (/\[SEVERITY:/i.test(l) || /^===/.test(l.trim())) break;
    const t = l.trim().replace(/^\|+|\|+$/g, '').trim();
    if (!t || /^:?-{3,}:?$/.test(t) || /^[-:| ]+$/.test(t)) continue; // md table separators
    prose.push(t);
  }
  if (body) prose.unshift(body);
  if (!prose.length) return null;
  const fix = prose.length > 1 ? prose.pop() : '';
  const issue = prose.join(' ');
  if (!issue) return null;
  return { severity, element: '', issue, fix };
}

export function parseTextFindings(text) {
  const m = String(text || '').match(/===\s*FINDINGS\s*===([\s\S]*?)(?====|$)/i);
  if (!m) return [];
  const lines = m[1].split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const sev = lines[i].match(/\[SEVERITY:\s*(\w+)\]\s*(.*)/i);
    if (!sev) continue;
    const parsed = parseSeverityBlock(sev[1], sev[2], lines.slice(i + 1));
    if (parsed) out.push(parsed);
  }
  return out;
}

export function normalizeResult(raw) {
  // Parsed-object path: gemma schema output uses lowercase keys, but qwen
  // sometimes returns JSON that analyze.mjs parses into analysis_parsed with
  // UPPERCASE keys (SCORES/FINDINGS/TOP 3 FIXES). Normalize both.
  const parsed = raw?.analysis_parsed;
  if (parsed && typeof parsed === 'object') {
    const pick = (...names) => {
      for (const n of names) {
        const hit = Object.entries(parsed).find(([k]) => k.toLowerCase() === n.toLowerCase());
        if (hit) return hit[1];
      }
      return undefined;
    };
    const rawScores = pick('scores', 'SCORES');
    const scores = rawScores && typeof rawScores === 'object'
      ? Object.fromEntries(Object.entries(rawScores).map(([k, v]) => [k.toLowerCase(), typeof v === 'number' ? v : parseFloat(v)]))
      : null;
    const rawFindings = pick('findings', 'FINDINGS');
    const findings = Array.isArray(rawFindings)
      ? rawFindings.map((f) => ({
          severity: String(f.severity || 'info').toLowerCase(),
          confidence: f.confidence,
          element: f.element || '',
          issue: f.issue || '',
          fix: f.fix || f.shortest_fix || '',
        }))
      : [];
    const rawFixes = pick('top_fixes', 'TOP 3 FIXES', 'TOP_FIXES');
    const rawStrengths = pick('strengths', 'STRENGTHS');
    const rawUncertain = pick('uncertain', 'UNCERTAIN');
    return {
      scores: scores && Object.values(scores).some(Number.isFinite) ? scores : null,
      strengths: typeof rawStrengths === 'string' ? [rawStrengths] : (rawStrengths || []),
      findings,
      topFixes: Array.isArray(rawFixes) ? rawFixes.map(String) : [],
      summary: String(pick('summary', 'OBSERVATION', 'observation') || '').slice(0, 300),
      uncertain: Array.isArray(rawUncertain) ? rawUncertain.map(String) : (rawUncertain ? [String(rawUncertain)] : []),
      format: 'json',
    };
  }
  // qwen path: structured text — but qwen sometimes ignores the format and
  // emits a JSON object anyway (observed: neonRain returned {"SCORES": {...}}).
  const text = typeof raw?.analysis === 'string' ? raw.analysis : '';
  let scores = parseTextScores(text);
  let findings = parseTextFindings(text);
  let strengths = parseTextList(text, 'STRENGTHS');
  let topFixes = parseTextList(text, 'TOP 3 FIXES');
  let uncertain = parseTextList(text, 'UNCERTAIN');
  let summary = (text.match(/===\s*OBSERVATION\s*===([\s\S]*?)(?====|$)/i)?.[1] || '').split('\n').slice(-2).join(' ').trim();

  if (!scores) {
    try {
      const j = JSON.parse(text);
      const js = j.SCORES || j.scores;
      if (js && typeof js === 'object') {
        scores = {};
        for (const [k, v] of Object.entries(js)) {
          const n = parseFloat(v);
          if (Number.isFinite(n)) scores[k.toLowerCase()] = n;
        }
      }
      const jf = j.FINDINGS || j.findings;
      if (Array.isArray(jf)) {
        findings = jf.map((f) => ({
          severity: String(f.severity || f.SEVERITY || 'info').toLowerCase(),
          element: f.element || f.ELEMENT || '',
          issue: f.issue || f.ISSUE || '',
          fix: f.shortest_fix || f.fix || f.FIX || '',
        }));
      }
      const jt = j['TOP 3 FIXES'] || j.top_fixes || j.TOP_FIXES;
      if (Array.isArray(jt)) topFixes = jt.map(String);
      const jn = j.STRENGTHS || j.strengths;
      if (typeof jn === 'string') strengths = [jn];
      else if (Array.isArray(jn)) strengths = jn.map(String);
      uncertain = Array.isArray(j.UNCERTAIN || j.uncertain) ? (j.UNCERTAIN || j.uncertain).map(String) : uncertain;
      summary = j.OBSERVATION || j.observation || j.summary || summary;
      if (scores && Object.keys(scores).length) {
        return { scores, strengths, findings, topFixes, summary: String(summary).slice(0, 300), uncertain, format: 'qwen-json' };
      }
    } catch { /* not JSON — keep text-parse results */ }
  }
  return { scores, strengths, findings, topFixes, summary, uncertain, format: 'text' };
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
  const audioDead = manifest.audioVerified === false;
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
  // --from-analyses: rebuild the scorecard from existing analysis-*.json
  // files with the CURRENT parser — no ffmpeg, no GPU. Use after parser
  // fixes or to recover a run that died before writing scorecard.md.
  if (args.fromAnalyses) {
    for (const [i, m] of modes.entries()) {
      const af = path.join(dir, `analysis-${m.kind}-${m.id}.json`);
      if (!fs.existsSync(af)) {
        results.push({ mode: m, error: 'no analysis file' });
        continue;
      }
      let raw;
      try { raw = JSON.parse(fs.readFileSync(af, 'utf8')); }
      catch { raw = { analysis: fs.readFileSync(af, 'utf8') }; }
      results.push({ mode: m, ...normalizeResult(raw), analysisFile: path.basename(af) });
      console.log(`[viz-score] ${i + 1}/${modes.length} ${m.label} — from ${path.basename(af)}`);
    }
  }
  for (const [i, m] of args.fromAnalyses ? [] : modes.entries()) {
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
      audioDead
        ? 'WARNING: audio playback was NOT verified during capture — the transport may have been stalled. Score visual quality, but treat reactivity/motion scores as measuring idle visuals, not audio-driven motion.'
        : 'Audio playback was verified advancing during capture.',
      `Frames are chronological samples from one continuous playback session; app chrome (topbar, preset bar, inspector, HUD text) is part of the page — score the visualization stage itself and only flag chrome that degrades or overlaps the stage.`,
    ].join(' ');
    const raw = runAnalyze(frames, `${m.kind}:${m.id}`, context, path.join(dir, `analysis-${m.kind}-${m.id}.json`), args.model);
    const norm = normalizeResult(raw || {});
    results.push({ mode: m, ...norm, analysisFile: `analysis-${m.kind}-${m.id}.json` });
    // Checkpoint partial results — a 23-mode run is ~30-60 min of GPU time;
    // a crash at mode 20 must not lose modes 1-19 (analysis-*.json survive,
    // but the assembled scorecard would not exist).
    fs.writeFileSync(
      path.join(dir, 'results-partial.json'),
      JSON.stringify({ manifest, results }, null, 1),
    );
  }

  // Scorecard — sorted by overall desc, unscored last.
  const scored = results
    .map((r) => ({ ...r, overall: r.scores?.overall ?? null }))
    .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

  const card = ['# Visualizer mode scorecard', ''];
  card.push(`Track: ${manifest.track || '?'} | modes: ${results.length} | frames/mode: ${args.frames}${audioDead ? ' | ⚠ AUDIO NOT VERIFIED — reactivity scores measure idle visuals' : ''}`);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`viz-score failed: ${e.message}`);
    process.exit(1);
  });
}
