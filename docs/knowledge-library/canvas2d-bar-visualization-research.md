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
