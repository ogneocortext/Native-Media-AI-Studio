---
tags:
  - creative
  - visualization
  - audio
  - Canvas2D Bar Visualization Research
aliases:
  - Canvas2D Bar Mode Findings
cssclasses:
  - creative-guide
date: 2026-09-29
type: source
---

# Canvas2D Bar Visualization — Research Findings

Date: 2026-09-18
Topic: Modern bar-mode improvements for Native Media AI Studio's Canvas2D visualizer

## Sources
- DEV Community: "Building a Real-Time Audio-Reactive Visualizer in Next.js 15" (2026-08)
- AG Grid blog: "Optimising HTML5 Canvas Rendering" (2024-11)
- harmonics-audio/fft-visualizer (WebGL bars + reflections + LED segments)
- audioMotion-analyzer (high-res spectrum, reflex/reflection, glow)
- angular-spotify waveform-bars-renderer (rise/fall speeds, glow, reflection)
- da-troll/visual-flux (7 canvas2D modes, palettes, beat detection)
- RSK World Audio Visualizer (smoothing, sensitivity, themes)
- Doist/Ramble waveform article (RMS, HiDPI, delta-time scrolling)

## Key Findings

### 1. Performance
- **Batch by style**: Group shapes by fill/stroke/alpha to reduce context switches. One `fill()`/`stroke()` per batch instead of per-bar.
- **Avoid `shadowBlur` in hot loops**: It is the single biggest Canvas2D performance drain. Use sparingly or fake glow with semi-transparent overlays.
- **Minimize `globalAlpha` switches**: Expensive; try to set once per batch.
- **Reuse typed arrays**: Already done (`freq`, `wave`, `smoothed` reused per frame). Keep it.
- **DPR-aware canvas**: Already done via `applySize` + `devicePixelRatio`.
- **Integer coordinates**: Use `Math.round`/bitwise floor to prevent sub-pixel anti-aliasing blur and speed up rasterization.

### 2. Visual Quality
- **Rounded bar tops**: `ctx.roundRect()` or manual arc path gives a modern, premium feel. Radius = `min(barWidth/2, 4)`.
- **Reflections**: Draw a flipped, faded copy below the baseline (`reflexAlpha` ≈ 0.15–0.3). Common in pro visualizers (audioMotion, fft-visualizer).
- **Peak indicators**: Falling peak caps with slow decay (`peakDecay` ≈ 0.985–0.997). Classic Winamp/FFT style.
- **Logarithmic frequency mapping**: Human pitch perception is logarithmic. Allocate more bars to bass/mids; fewer to highs.
- **Attack/Release smoothing**: Bars rise fast, fall slower. Already partially present via `smoothingTimeConstant`; can be augmented with per-bar lerp.
- **Beat pulse**: Slight global scale bump or brightness flash on transient kick.

### 3. Color & Lighting
- **Per-bar gradient vs. per-level color**: Gradient along bar height looks richer. Some tools also color by amplitude (`bar-level` mode).
- **Split gradients**: Warm colors on bass bars, cool on treble. Already partially present in codebase.
- **Glow**: Cheap glow = draw the bar twice: once full-size blurred, once crisp on top. Expensive glow = `shadowBlur` (use sparingly).

### 4. Recommended Changes for Existing Bars Mode
1. Add rounded top corners to bars.
2. Add subtle reflection below baseline.
3. Add falling peak indicators with slow decay.
4. Reduce per-bar `shadowBlur`; batch glow into one overlay pass or remove from per-bar loop.
5. Group bar fills by color bucket to reduce `fillStyle` changes.
6. Ensure all bar `x/y/w/h` values are integers for crisp edges.

## Decision Log
- WebGL full-shader rendering (fft-visualizer) is out of scope; we stay on Canvas2D.
- Keep existing palette lerp + LRC phrase flash + bass/treble tinting.
- Avoid adding heavy new deps; use native Canvas2D APIs.

## Implementation Status (audited 2026-11-06, T-VIZ-38)

All code lives in `packages/frontend/src/features/visualizer/canvas2dModes.ts`
with shared helpers in `canvas2dHelpers.ts`. Six bar-style modes exist:
`bars`, `mirrored-bars`, `segmented-led-bars`, `stereo-split-bars`,
`stacked-frequency-bands`, `dot-peak-matrix`.

| Recommendation | Status | Notes |
|---|---|---|
| Rounded bar tops | Done | `roundRect` radius `min(bw/2, 3·dpr)`, top corners only |
| Reflections | Done (was broken) | Was drawn at `y = h + 2·dpr` — fully below the canvas, clipped invisible every frame. Fixed to hang below the bar baseline; alpha 0.18, height 30% of bar |
| Falling peak caps | Done (was broken) | `PEAK_DECAY = 0.985`. `renderBars` clobbered `barPeaks[i]` before the decay check so peaks pinned to bar top; `renderMirroredBars`/`renderStereoSplitBars` had no decay path at all. All four modes now use the high-water-mark + decay pattern that `renderStackedFrequencyBands` already had |
| Log frequency mapping | Done | `makeFreqMapper` → `logFreqMap` default; `linear`/`bark`/`mel` selectable via `perceptualScale` |
| Integer coordinates | Done | `Math.round` on x/y; `bw = round(barW) - 2` |
| No `shadowBlur` in hot loop | Done | Glow via cached `drawGlowSprite` sprites instead |
| Beat pulse | Done | `drawBeatFlash` (white cap + glow sprite) gated on `d.beat` + per-band energy; `drawDownbeatDot` on `isDownbeat` |
| Attack/release smoothing | Done (centralized) | T-VIZ-15 moved smoothing into one shared envelope stage upstream of all modes — per-mode springs removed |
| Batched fills by style | Partial | Per-bar `fillStyle` still switches (gradient + warm/cool overlays + reflection = up to 4 fills/bar). True batching would need sorting by style; deferred — 64 bars × ~4 fills is within budget at 60 fps |

### Defects found and fixed (commit `4dafd9c`, `15b0be4`)

1. **Peak indicators non-functional** in `bars`, `mirrored-bars`,
   `stereo-split-bars` — see table above.
2. **Reflection invisible** — offscreen origin, see table above.
3. **Harmonic overlay wrong index space** — `renderBars` passed a raw
   FFT-bin index into `freqMap()` as a bar index; `t ≈ 8` clamped every
   sample to the top bin → flat shimmer. Now samples `freqMap(i) * 2`
   (one octave above each bar's mapped bin).
4. **Dead per-frame allocations** — `barVelocities` arrays allocated in
   `renderBars`/`renderStackedFrequencyBands` but never used; removed.
   Only `renderSegmentedLedBars` uses the field (as `targetSegs`).

### Mode-specific notes

- `bars` (64 bars, baseline at 88% height): the reference mode —
  gradient + warm/cool band tints + reflection + peaks + beat flash +
  downbeat dots + harmonic overlay.
- `mirrored-bars`: upper bar + 60%-height lower mirror; peaks tracked
  on the upper bar, lower peak drawn at `peak * 0.6` to match.
- `segmented-led-bars`: 10 discrete segments/bar, beat glow on the top
  active segment only.
- `stereo-split-bars` (48 bars): despite the name it renders low/mid/
  high *frequency bands* in three palette colors, not stereo channels —
  naming is historical.
- `stacked-frequency-bands` (48 bars): low/mid/high layers stacked
  vertically per bar; was the only mode with correct peak decay before
  T-VIZ-38.
- `dot-peak-matrix`: 64×12 dot grid; peak column per bar.

### Remaining opportunities (not yet done)

- **Bar-count adaptivity**: fixed 64/48 counts regardless of canvas
  width — narrow windows get cramped bars. Could scale count with `w`.
- **True fill batching**: group bars by gradient bucket to cut
  `fillStyle` switches (research item §1, still partial).
- **Peak hold/step styling**: current peaks are 1.5·dpr white dashes;
  some pro visualizers add a short horizontal cap or color-code peaks.
- **Stereo channels**: `stereo-split-bars` name implies L/R split but
  renders frequency bands — either rename or implement actual channel
  splitting if the analyser exposes `getByteTimeDomainData` per channel
  (it doesn't today; would need a second analyser or mid/side decode).
