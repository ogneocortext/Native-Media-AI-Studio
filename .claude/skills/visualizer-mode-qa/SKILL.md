---
name: visualizer-mode-qa
description: Measure /render/visualizer mode presentation quality across real playback using video-frame analysis — capture a mode-cycling recording, slice per-mode segments, score each mode with the vizmode rubric, and rank results for redesign. Use when auditing, comparing, or redesigning the 3D / FX shader / Canvas2D visualizer modes.
---

# Visualizer Mode QA

Scores every reachable visualization mode (3D stage, 8 FX shader presets,
14 Canvas2D modes) on the SAME track and SAME playback session, so mode
comparisons are apples-to-apples. Output is a ranked scorecard plus
per-mode findings — the input for redesign work, not a vague "looks fine".

## When to use
- Before redesigning any visualizer mode (get the baseline first)
- After changing a mode's render code (regression check vs. scorecard)
- When comparing a new mode/preset against the existing field
- Periodic polish audits — run on a track with strong transients (drums,
  clear section changes) so reactivity is actually exercised

## Pipeline

```bash
# 1. Capture — records video while cycling every mode with audio playing.
#    Modes grammar: "all" | "3d" | "shader" | "2d" | "shader:neonRain" | "2d:bars"
node tools/vision/viz-capture.mjs --track "<library filename>" --modes all --dwell 6000

# 2. Score — slices the webm per mode, grabs 3 steady-state frames each,
#    runs analyze.mjs --mode vizmode, writes scorecard.md/json.
node tools/vision/viz-score.mjs --dir ./viz-capture-<timestamp>

# Or one shot:
node tools/vision/viz-capture.mjs --track "x.wav" --modes all --analyze --model qwen3.5:4b
```

- `--track` takes the library filename as shown in the track picker
  (hash-prefixed names work). Tracks WITHOUT cached analysis still
  capture fine — the visualizer falls back to live-FFT data.
- `--dwell` default 6000ms per mode; settle (~1.2s mode fade) is excluded
  from scoring windows automatically.
- `--frames N` (score) controls frames per mode — 3 is the sweet spot;
  more frames mostly repeat the same pose.
- `--only "2d:bars,shader:neonRain"` re-scores a subset without
  recapturing (needs the same marks.json + webm in --dir).
- `--skip-analyze` extracts frames only (cheap sanity check of the
  segment boundaries before spending GPU time).
- `--from-analyses` rebuilds scorecard.md/json from existing
  `analysis-*.json` files with the current parser — no ffmpeg, no GPU.
  Use after parser fixes or to recover a run that died mid-scoring.

## What gets measured

The `vizmode` analyze mode attaches 3 chronological frames per mode and
scores six dimensions 1-5 plus an honest overall:

| Dimension | What it judges |
|---|---|
| composition | focal hierarchy, rule-of-thirds, negative space |
| reactivity | is AUDIO visibly driving motion (beats/bass/spectrum) vs decorative noise |
| readability | glanceable parsing, HUD/text legibility, contrast |
| motion | eased intentional movement vs jitter/strobe/step (from frame deltas) |
| color | palette cohesion vs rainbow/default-hue slop; glow restraint |
| polish | anti-aliasing, particle quality, edge treatment, designed vs demo finish |

Gemma4 returns schema JSON (`analysis_parsed.scores`); qwen3.5 returns
`=== SCORES ===` text — viz-score.mjs normalizes both into the same
scorecard. qwen3.5:4b is the more accurate judge for aesthetic questions;
gemma4 is faster and machine-clean. Resident-stickiness in analyze.mjs
means whichever model is warm usually wins unless `--model` is passed.

## Interpreting the scorecard

- Rank by `overall`, but read `reactivity` and `motion` separately —
  a pretty static mode can outscore a reactive one; for a MUSIC
  visualizer reactivity is the product.
- `findings` are per-mode and actionable; `top_fixes` are the redesign
  shortlist. Cross-mode patterns (e.g. "every mode lacks negative space")
  are systemic, not per-mode bugs.
- Scores are VLM judgments — verify the top 2-3 findings against the
  frames in `frames/<kind>__<id>/` before acting. The model occasionally
  invents HUD elements that aren't there.

## Redesign loop

1. Baseline: full `--modes all` run on a representative track → scorecard.
2. Pick the weakest modes + any mode below ~3.0 overall.
3. Research: `docs/knowledge-library/` has the domain depth — start with
   `3d-visualization-best-practices-2026.md`, `2d-visualization-2026.md`,
   `audio-reactive-best-practices-2026.md`, `audio-reactive-visualization-2026-11.md`,
   `character-driven-visualization-research.md`, `color-strategy-2026.md`.
   The Canvas2D modes live in `canvas2dModes.ts` (one render fn per mode,
   shared `VisualizerModeRenderContext`); shader presets are GLSL in
   `shaders.ts`; 3D is the react-three-fiber scene.
4. Change ONE mode, re-run `--only "<kind>:<id>"` scoring against the
   baseline scorecard — keep or revert on evidence, not vibes.
5. Mode render contract: `visualizerModeRegistry.ts` documents the
   context/state shape every mode must respect (deterministic, no
   wall-clock randomness except through `rand`, respect `motionScale`).

## Gotchas

- Requires the Vite DEV server (the `__VIZ_TEST__` harness is
  `import.meta.env.DEV`-gated) — production builds have no harness.
- `selectTrack` on unanalyzed tracks used to crash on
  `analysis.energy_curve` (fixed 2026-11-08); if a track fails to load,
  pick one with a `✓` in the picker or let analysis finish first.
- Audio autoplay in headless Chromium is gesture-gated — the capture
  script clicks the transport button as fallback; if `isPlaying` stays
  false in marks, the video shows idle visuals and scores will be wrong.
- **Playback is verified, not assumed**: after load, viz-capture polls
  the `<audio>` element's `currentTime` twice — if it isn't advancing,
  it logs a loud warning and writes `audioVerified: false` into
  marks.json; viz-score then banners the scorecard and tells the model
  reactivity/motion scores measured idle visuals. A dead backend leaves
  the element at `readyState 0` forever while `isPlaying` can still read
  true — this actually happened (2026-11-07 baseline scored a dead
  backend's idle visuals). Check `audioVerified` before trusting
  reactivity scores.
- The recording is one continuous playback — different modes sample
  different song sections. That's intentional (real usage), but don't
  compare a mode captured on a quiet verse against one on a drop without
  noting it in the scorecard context.
- GPU budget: scoring is sequential per mode (~1-3 min each on the 8 GB
  card). A full 23-mode run is ~30-60 min of vision time; use `--only`
  subsets while iterating.
