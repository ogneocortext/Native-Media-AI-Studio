---
tags:
  - visualization
  - canvas2d
  - webgl
  - performance
  - motion-design
---

# Visualizer Smoothness Plan — "Clunky and Janky" (2026-11-03)

**For the implementing agent:** the owner reports the visualizations "look
clunky and janky." This plan separates that into three distinct defects with
distinct fixes, sequenced by impact per unit of work. Pair with
`docs/knowledge/canvas2d-visualizer-diagnosis-2026-10-02/README.md` (effect
hierarchy — already fixed via the effect budget) and
`docs/architecture/visualizer.md` (module map and rules; everything here
obeys them: audio-clock-driven motion, refs not props, one AudioContext).

## Provenance

- Code survey of `packages/frontend/src/features/visualizer/` at `1d31a74`
  (2026-11-03): `Canvas2DVisualizer.tsx`, `canvas2dModes.ts`, `particles.ts`,
  `canvas2dHelpers.ts`, `useSpectralTimeline.ts`, `viz-styles/`,
  `components/RenderStats.tsx`, `components/ShaderCanvas.tsx`.
- Web research, 2026-11-03 (sources at the end). Where a recommendation
  restates a source, the source is named inline.

## The three defects

"Clunky" and "janky" are different failures:

1. **Clunky = motion math.** The modes smooth with fixed per-frame constants
   (`springK = 0.28`, `springK = 0.26` in `canvas2dModes.ts`). A fixed
   per-frame lerp factor is frame-rate dependent by construction: the same
   spring converges twice as fast per second at 120 Hz as at 60 Hz, and
   lurches on every dropped frame. Motion speed is therefore a property of
   the display, not of the music. (Driscoll, "Frame Rate Independent
   Damping using Lerp": naive lerp "is broken because… the frame rate is
   variable, so the smoothing will also be variable.")
2. **Stepping = data path.** The visualizer reads `getByteFrequencyData`
   (`audioHooks.ts`): 256 quantization levels, then the AnalyserNode's own
   `smoothingTimeConstant` averaging, then per-mode springs — byte stepping
   plus two stacked smoothers. Slow fades visibly stair-step, and beats
   arrive smeared because transients travel through the same smoothed path
   as the spectrum.
3. **Janky = frame cost.** 22 `shadowBlur` call sites remain across
   `Canvas2DVisualizer.tsx`, `canvas2dModes.ts`, `particles.ts`. shadowBlur
   is the best-documented Canvas2D performance trap (software blur per draw
   call; every canvas perf guide says avoid it and pre-render instead).
   Add full-screen trail fills and per-frame gradient creation, and frame
   time spikes exactly when the music gets busy — "a steady 30 fps reads as
   smooth; 60 fps with a 120 ms hitch every second reads as broken"
   (Vibro, "Fluid Animation on the Web").

Already in place — do not redo: effect budget (`canvas2dModeBudget.ts`),
Bark/Mel/ERB perceptual mapping (`makeFreqMapper`), motion vocabulary
(`motion/`), DPR capped at 2, FPS telemetry (`RenderStats`), precomputed
analysis with per-frame lookup (`useSpectralTimeline`), ref-based drivers
for R3F styles.

## Sequence

### T-VIZ-14 (P0) — Frame-rate-independent damping, everywhere motion smooths

Add one helper and route every smoothing site through it:

```ts
// canvas2dHelpers.ts — dt in seconds, lambda = rate (1/s)
export const damp = (cur: number, target: number, lambda: number, dt: number) =>
  cur + (target - cur) * (1 - Math.exp(-lambda * dt));
```

- Replace fixed `springK`/lerp factors in `canvas2dModes.ts` (and any
  per-frame lerp in `particles.ts` and `viz-styles/*` useFrame loops) with
  `damp(...)` fed by the audio-clock delta the loops already compute.
  Convert an existing per-frame factor `k` at 60 fps to a rate with
  `lambda = -60 * ln(1 - k)` so the 60 Hz feel is preserved as the starting
  point (k = 0.28 → λ ≈ 19.7; k = 0.26 → λ ≈ 18.1).
- Acceptance: a unit test asserting the invariant the current code violates —
  damping a value toward a target for 1 simulated second in 60 steps of
  1/60 s and in 120 steps of 1/120 s lands within 1% of the same result.
  Runtime check: same track, same mode, motion speed visually identical at
  60 Hz and 120 Hz refresh.

### T-VIZ-15 (P0) — One attack/release envelope stage, wired at last

`asymmetricSmoothBands` (attack 0.8 / release 0.12) has sat in
`canvas2dHelpers.ts` unwired since 2026-10-02 (see the architecture doc).
Wire it — converted to time constants via the T-VIZ-14 helper
(`k = 1 - exp(-dt / tau)`) — as the *single* smoothing stage between band
data and every mode, and delete the per-mode springs it replaces.

- Per-band time constants, not one pair: transients snap, colour drifts.
  Starting ratios from a shipped reference implementation (veffects host
  envelopes, per-frame at 60 fps): bass attack 0.5 / release 0.06, mid
  0.5 / 0.07, treble 0.5 / 0.10, beat envelope 0.8 / 0.10, spectral
  centroid symmetric 0.05 / 0.05 — "those six numbers are most of the
  perceived feel of the whole program."
- Acceptance: modes consume enveloped bands only (grep: no mode reads raw
  band arrays); a kick hit visibly peaks within one frame and decays over
  ~0.5 s instead of snapping off.

### T-VIZ-16 (P0) — Float data path + split transient path

- Main visual path: `getFloatFrequencyData` (dB floats) instead of bytes;
  normalize in dB space against the analyser's min/maxDecibels. Byte data
  remains for meters (StemMixer, professional mixer), where 256 levels are
  fine. This removes the quantization stepping on slow fades.
- With T-VIZ-15 owning smoothing, *lower* the analyser's
  `smoothingTimeConstant` (target ~0.5; measure) — today the node smoothing
  and the mode springs compound, which is lag you can hear-feel as visuals
  trailing the beat.
- Split the paths (pattern from the Audio-Reactive Shader Playground design
  doc): a second analyser (or a second read with `smoothingTimeConstant = 0`)
  feeding spectral-flux onset detection for beat events, while the smoothed
  path feeds spectrum shapes. "Frequency resolution and transient response
  are opposed; one smoothingTimeConstant can't serve both." Onset should be
  a *decaying envelope*, not a boolean, so consumers stop re-implementing
  decay.
- Acceptance: onset envelope fires on isolated kick/snare hits in a test
  fixture; spectrum bars no longer double-smooth (compare beat-to-visual
  latency against the precomputed timeline on a click track).

### T-VIZ-17 (P1) — Remove shadowBlur; pre-rendered glow

- Replace all 22 `shadowBlur` sites with pre-rendered glow sprites: render
  each glow shape once per (shape, colour, radius bucket) to an offscreen
  canvas at mode init / palette change, then `drawImage` with
  `globalCompositeOperation = 'lighter'` and per-instance alpha/scale.
  Pre-rendered sprites + batched drawImage are the standard replacement
  (3–5× on particle-heavy modes per the canvas particle literature).
- Cache per-mode radial gradients the same way (keyed by mode + size
  bucket + palette); no `create*Gradient` inside the frame loop.
- Batch by style: group fills/strokes by `fillStyle`/composite within a
  mode's draw so state changes happen per batch, not per shape.
- Acceptance: `grep -rn shadowBlur` in the visualizer tree returns zero;
  RenderStats shows the busy-section frame time (below) inside budget.

### T-VIZ-18 (P1) — Adaptive quality governor (both surfaces)

Peak quality is not the goal; *held* frame time is. Extend `RenderStats`'
existing FPS measurement into a controller with a stepped ladder, applied
only on sustained breach (e.g. rolling p95 frame time > 20 ms for 2 s),
stepping back up after 10 s of headroom:

- Canvas2D ladder: DPR 2 → 1.5 → 1.25 → 1; then particle count; then trail
  persistence length.
- R3F ladder: drei `PerformanceMonitor` (`onDecline`/`onIncline`) driving
  the same DPR steps plus post-processing pass toggles — the documented
  R3F pattern (R3F "Scaling performance" docs). `ShaderCanvas` and
  `VisualizationFX` full-screen shaders are fragment-bound, so DPR is
  their highest-leverage knob (Vibro: fragment count is set by canvas
  resolution; DPR capping is "the single highest-leverage optimisation").
- Draw-call telemetry: surface `renderer.info.render.calls` in RenderStats
  for the 3D styles; budget ~150 calls (three.js perf guidance for smooth
  60 on mid hardware).
- Acceptance: on a thermally throttled run (or a 4× CPU throttle in
  DevTools), the governor steps down and frame time returns inside budget
  without user intervention; no oscillation (hysteresis as specified).

### T-VIZ-19 (P2) — Anticipation: drive beats from the precomputed timeline

The studio's structural advantage over shader-toy visualizers is that the
track is *already analysed* (sections, beats, spectral timeline). Use it
like one:

- Where a beat grid exists, motion should be phase-driven from
  `audioData.beatPhase` so visual peaks land *on* beats, not one
  onset-detection latency after them. Live flux (T-VIZ-16) is the fallback
  for unanalysed audio only. (Perception research consensus: visuals must
  align with *perceived* rhythm; anticipation via prediction beats
  reaction after the fact.)
- Interpolate `useSpectralTimeline` lookups between adjacent analysis
  frames (lerp band vectors by fractional frame position) instead of
  stepping frame to frame.
- Section-aware intensity: scale motion-vocabulary amplitude by section
  energy via `sectionStateMachine` (build vs drop), the way veffects
  places scene cuts on smoothed-loudness drift — structure first, spikes
  second.
- Acceptance: on a click-track fixture, visual beat peaks align with audio
  beat times within one frame at 60 fps; section changes visibly change
  motion intensity without a mode switch.

## Explicit non-goals

- **No WebGPU rewrite, no OffscreenCanvas worker migration.** Both are real
  techniques; neither is the bottleneck here. The defects above are in
  math and call discipline, fixable in place.
- **No new modes/styles** until T-VIZ-14…16 land; new modes written against
  raw bands and fixed springs would re-import the defects.
- **Unity visualizer is out of scope** for this plan (offline renders;
  frame pacing there is a different problem).

## Measurement protocol (before and after, same conditions)

Use the repo's own method (`docs/guides/visualizer-debug.md`: gdigrab
capture + frame diffing) plus RenderStats, on one dense track and one
sparse track, in the three busiest modes:

1. Rolling p95 frame time and count of >2-frame hitches per minute.
2. Motion-speed invariance: 60 Hz vs 120 Hz capture of the same passage.
3. Beat alignment: visual peak vs beat time on a click track.

Record the numbers in the task file per item, the way T-AUD-08's
acceptance numbers are recorded. "Feels smoother" is not an acceptance
criterion; the three measurements are.

## Sources (2026-11-03)

- Rory Driscoll, *Frame Rate Independent Damping using Lerp* —
  https://www.rorydriscoll.com/2016/03/07/frame-rate-independent-damping-using-lerp/
- Vibro Music, *How to Create Fluid Animation on the Web: WebGL vs Canvas
  vs DOM* (frame budget, consistency over peak, DPR leverage) —
  https://www.vibromusic.com/blog/fluid-web-animation.html
- veffects, *Turning Any Track Into Math-Only Visuals* (precomputed score,
  host-owned asymmetric envelopes, reactive cuts) —
  https://core-jmp.org/2026/08/veffects-music-visualizer-score-format-plugin-abi/
- Audio-Reactive Shader Playground, *Design & Build Guide* (two-analyser
  split, spectral flux onsets, onset-as-envelope uniforms) —
  https://github.com/syedjafri06193/audio-reactive-shader-playground-proj/blob/HEAD/docs/design.md
- React Three Fiber docs, *Scaling performance* (PerformanceMonitor,
  adaptive DPR, instancing, frameloop) —
  https://r3f.docs.pmnd.rs/advanced/scaling-performance
- Canvas performance guides on shadowBlur / pre-rendered sprites /
  batching (multiple, concordant) —
  https://copyprogramming.com/howto/efficient-html5-canvas-glow-effect-without-shape
