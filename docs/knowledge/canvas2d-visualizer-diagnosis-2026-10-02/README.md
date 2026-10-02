# Canvas2D Visualizer Diagnosis — Code Audit Handoff (2026-10-02)

**For the implementing agent:** the 2D visualizations look like a mess.
This doc is the diagnosis from a source-code read, not a redesign. Pair it
with `docs/knowledge/gemini-motion-design-2026-10-02/` — that doc was written
for exactly this file.

## Provenance

- Source: code audit of
  `packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx`
  (1,544 lines, 13 modes), 2026-10-02.
- Status: findings to verify against the live render, then fix in the
  recommended sequence below.

## The visual problem: no effect hierarchy

Every frame draws **all** of these full-screen or large-area effects,
regardless of mode, before the mode's own rendering:

| # | Effect | Location | Notes |
|---|---|---|---|
| 1 | Trail / ghost fill | ~L505 | Persistence smear; alpha chosen by 4-level nested ternary |
| 2 | Phrase flash | ~L537 | Full-screen white overlay on every lyric phrase start |
| 3 | Beat vignette | ~L542 | Radial edge-darkening, up to 45% alpha on transients |
| 4 | Drum shockwaves | ~L441 spawn / ~L443 draw | Expanding rings on **every** beat, color-coded by drum type |
| 5+ | Mode's own glows | per mode | See below — each mode adds more |

5–7 simultaneous large-area effects with no staging and no dominant focal
point. This is the "visual noise" failure the motion-design doc describes:
multiple elements competing for attention, no single kinetic thought.
Everything reacts to everything, so nothing reads clearly.

Worst offenders among the modes:

- **radial** (~L1179): 64 spokes + pulsing glow core + secondary orbital
  ring + section rotation. Four competing centers of interest.
- **particles** (~L1412): per-particle `shadowBlur` (expensive and muddy at
  count) + center radial glow on top of the global stack.
- **aurora** (~L1455): own beat-flash rectangle + own top vignette, in
  addition to the global flash/vignette/shockwaves.

## The code problem: one file, thirteen modes, no seams

- 13 modes live in a single `if/else` chain inside one `draw()` closure.
  Tuning or disabling one mode's look requires wading through the other
  twelve. Nobody can see the mess to fix it.
- The perceptual frequency-map selector (`bark`/`mel`/`log`/`linear`) is
  copy-pasted **6 times** (~L600, 715, 804, 873, 950, 1023) instead of one
  shared helper.
- Global effects are hardwired **before** the mode dispatch — no mode can
  opt out of the flash/vignette/shockwave/trail stack.
- Trail alpha is a 4-level nested ternary with duplicated
  `prefersReducedMotion` branches (~L508–521).
- Bar-spring state is sized by inline mode conditionals (64 vs 48)
  (~L479–497); fragile and unreadable.

## Recommended fix sequence

### 1. Effect budget per mode (visual fix, no refactor)
Each mode declares which global effects it uses. Cap simultaneous
full-screen effects at **2**. Suggested starting point:
- Keep trails only on `particles` and `waveform`.
- Keep shockwaves only on beat-forward modes (`bars`, `radial`); remove
  from `aurora`, `spectrogram`, `lissajous`, `constellation`.
- Keep phrase flash only where lyrics are the point (`bars` with LRC);
  remove elsewhere.
- Beat vignette: halve the alpha ceiling globally, then re-evaluate.

### 2. Split the file (structural fix)
One renderer module per mode, each exporting `render(ctx, state)`.
`Canvas2DVisualizer.tsx` becomes a dispatcher + shared frame setup
(buffers, palettes, reduced-motion scaling). Deduplicate `freqMap` into a
single helper in `canvas2dHelpers.ts` (it already has unit tests —
extend them).

### 3. Apply the motion-design doc (craft fix)
- **Derivative triggers** (amateur tell #1): bind motion to
  `max(0, dE/dt)` with a noise gate, not raw energy. The current code
  reads smoothed energy directly in most modes.
- **Asymmetric envelopes** (tell #3): 0–16 ms attack, 120–600 ms decay.
  The radial spring (`springK 0.24, damping 0.74`) is effectively
  symmetric — retune per the doc.
- **Staging / driver dominance**: one dominant driver per moment. Start
  with `radial`: pick spokes OR core OR ring as the hero, demote the rest
  to shader-level accents.

## What NOT to do

- Do not add a 14th mode until the effect budget exists — new modes
  inherit the full stack and look just as messy.
- Do not "fix" this with more glow, bloom, or post-processing. The
  problem is too many effects, not too few.
- Do not tune by staring at one track. Validate any change against at
  least 3 tracks: one dense EDM drop, one sparse verse, one acoustic.

## Open questions

- Should the effect budget live in a per-mode config object (data) or in
  each renderer module (code)? Recommend data — it makes the budget
  reviewable in one place.
- `spectrogram` already opts out of trails; check whether it should also
  opt out of shockwaves (likely yes).
