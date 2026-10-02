# AE Motion Craft → Canvas2D — Gemini Pass (2026-10-02)

FLIMLION's After Effects Trap Nation tutorial translated to real-time
Canvas2D technique — with restraint as the central constraint.
Directly addresses the Canvas2D "mess" diagnosis in
`docs/knowledge/canvas2d-visualizer-diagnosis-2026-10-02/`.

## Provenance

- Video: FLIMLION VisualFX — "After Effects Tutorial: Audio Spectrum
  Effect in After Effects - No Plugin" (10:31).
  https://www.youtube.com/watch?v=esP3HWXwKm4 — 30,998 likes /
  1.4M views (~2.2% ratio).
- Gemini chat: https://aistudio.google.com/prompts/13DSmHCIEnX7dtelk6VIGn5DojnpCLpx7
- Model: **gemini-3.8-flash** (3.0 not offered). URL Context: **ON**.
- Technique list from YouTube Ask AI triage (timestamps below).
- Date: 2026-10-02.

## USER DIRECTIVE — Trap Nation preset

The user wants the **Trap Nation look** (circular audio-spectrum
visualizer) as a preset. Implement it as a **tuned variant of the
existing `radial` mode**, NOT a 14th mode — the diagnosis doc forbids
new modes until the per-mode effect budget exists. Recipe: polar
circularization + 4-color gradient depth + restrained glow (below),
all inside the effect-budget rules (≤2 simultaneous full-screen
effects; this preset should use trails + glow only).

## The anti-clutter rule

Audio must **modulate existing geometry**, never spawn new layers.
The mess is event stacking (flash + shockwave + vignette + trails on
one beat). Crafted alternative: the beat modulates the primary
geometry (height + color shift) and its atmosphere (glow radius +
trail dissolve rate). Depth without clutter.

## AE techniques translated (with restraint)

Ask triage: Audio Spectrum on a solid (1:37–2:38); band/height/offset
styling (2:40–3:10); Polar Coordinates circularization (3:11–3:42);
4-Color Gradient depth (4:05–4:48); layer duplication + CC Light
Brush glow (4:49–6:17); Analog Dots + Magnify texture (6:22–8:43);
expression-driven amplitude→parameter links (8:48–9:09).

### 1. Band distribution — log grouping + asymmetric smoothing

Raw FFT bins waste ~70% of canvas width on inaudible highs and
flicker. Compress to 64–128 log bands; never render raw FFT:

```ts
for (let i = 0; i < bandCount; i++) {
  const rawValue = getLogFrequencyBand(fftData, i, bandCount);
  smoothedBands[i] = rawValue > smoothedBands[i]
    ? smoothedBands[i] * 0.2 + rawValue * 0.8   // fast attack
    : smoothedBands[i] * 0.88 + rawValue * 0.12; // smooth release
}
```

Damping high-frequency flicker is the #1 visual-fatigue fix.

### 2. Polar circularization — the Trap Nation core

Map band index to angle; mirror data so the 0/2π seam is continuous;
**kill external shockwaves in circular mode** — the expanding /
contracting baseline radius IS the shockwave:

```ts
const baseRadius = minDim * 0.22 + bassEnergy * 25; // bass modulates radius directly
ctx.beginPath();
for (let i = 0; i <= bandCount; i++) {
  const idx = i === bandCount ? 0 : i; // close the loop cleanly
  const angle = (i / bandCount) * Math.PI * 2 - Math.PI / 2;
  const r = baseRadius + smoothedBands[idx] * maxAmplitude;
  const x = cx + Math.cos(angle) * r, y = cy + Math.sin(angle) * r;
  i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
}
ctx.closePath();
```

### 3. 4-color gradient depth — offscreen, not per-frame

Never `createRadialGradient` per frame. Render the gradient once to a
256×256 offscreen canvas; apply via `createPattern` or composite
with `globalCompositeOperation = 'source-in'` over monochrome
geometry. Locks the color count to the theme; kills the urge for
rainbow spectrum spikes.

### 4. Glow — downscaled offscreen pass, not shadowBlur

`ctx.shadowBlur` on 100+ paths/frame kills framerates. Maintain a
¼-resolution canvas; draw geometry to both; composite back with
`'lighter'` + blur (¼ canvas = 1/16 the fill-rate cost). On snare
hits, raise glow opacity 0.2→0.8 **instead of** a full-screen flash:

```ts
ctx.save();
ctx.globalCompositeOperation = 'lighter';
ctx.filter = `blur(${8 + bassEnergy * 12}px)`;
ctx.drawImage(glowCanvas, 0, 0, mainWidth, mainHeight);
ctx.restore();
```

**iOS fallback** (ctx.filter blur silently fails / tanks to sub-15fps
on iOS Safari at dpr ≥ 2): pyramidal downscale bloom — blit main →
¼ → 1/16 with `imageSmoothingQuality='medium'`, composite both back
additively. Hardware bilinear does the "blur" for ~zero CPU cost;
graceful degradation, no black screens.

### 5. Texture — multiply, NOT destination-out

Pre-render a dot-grid/scanline tile; stamp at 0.08–0.12 alpha.
Gemini initially suggested `destination-out`, then self-corrected:
it punches alpha holes revealing the React DOM behind the canvas.
`'multiply'` gives the ink-on-film grit without corrupting alpha.
Static micro-texture grounds the eye and removes the urge to fill
space with ambient particles.

## The Parameter Modulation Hub

Replace per-mode effect spaghetti with declarative bindings. Modes
expose numeric knobs; the engine binds audio metrics via transfer
functions — evaluated before each mode's `render()`:

```ts
export interface ParameterBinding {
  param: string;
  source: 'subBass' | 'snareCrack' | 'air' | 'rawEnergy' | 'beatPulse';
  min: number; max: number;               // rest value → peak value
  curve: 'linear' | 'easeOut' | 'exponential';
  decayFactor?: number;
  // --- staging controls (the important part) ---
  priority: 1 | 2 | 3;        // 3 = dominant, 1 = ambient
  suppressionGroup?: string;  // competing bindings share a group
  duckStrength?: number;      // 0 = immune, 1 = fully suppressed
}
```

**Sidechain ducking** (from the follow-up): evaluate all bindings,
find max priority-3 activation per suppression group, then scale
priority-1/2 activations by `(1 − dominance × duckStrength)`.
Kick fires → trail breathing and micro-jitter collapse, radius
expansion takes 100% visual dominance. This is the *mechanical*
enforcement of "one thing at a time" — staging as code, not taste.

Worked example — radial/Trap Nation preset config:

```ts
export const RadialModeConfig = {
  id: 'radial_core', baseParams: { radius: 120, barHeight: 80, trailFade: 0.15, glowIntensity: 0.2 },
  bindings: [
    { param: 'radius', source: 'subBass', min: 120, max: 180, curve: 'exponential', decayFactor: 0.2, priority: 3, suppressionGroup: 'primary_rhythm', duckStrength: 0 },
    { param: 'barHeight', source: 'snareCrack', min: 80, max: 240, curve: 'easeOut', decayFactor: 0.1, priority: 3, suppressionGroup: 'primary_rhythm', duckStrength: 0 },
    { param: 'trailFade', source: 'rawEnergy', min: 0.08, max: 0.45, curve: 'linear', priority: 1, suppressionGroup: 'primary_rhythm', duckStrength: 0.9 },
    { param: 'glowIntensity', source: 'air', min: 0.15, max: 0.7, curve: 'exponential', priority: 2, suppressionGroup: 'primary_rhythm', duckStrength: 0.5 },
  ],
};
```

Note: loud drops auto-clear trails (keeps them crisp), quiet parts
stay dreamy — energy-adaptive trail decay.

## Compositing order (all three must coexist)

Wrong order causes permanent black holes (destination-out on the
accumulation buffer) or runaway white blowouts (additive glow into
trailing canvas). Correct pipeline:

1. Fade accumulation canvas (`source-over` fillRect, trail alpha)
2. Draw crisp current-frame geometry into it
3. Generate glow on the ¼-res canvas
4. Composite glow back with `'lighter'` (no persistent accumulation)
5. Apply texture with `'multiply'` at low alpha — on the OUTPUT only

## Implementation priorities

| P | Action | Replaces | Impact |
|---|---|---|---|
| P0 | Asymmetric attack/decay on audio bins | Raw FFT jitter | Kills visual noise & strobing |
| P1 | Energy-adaptive trail decay | Hardcoded trail overlays | Crisp drops, dreamy ambient |
| P2 | Parameter Modulation Hub + ducking | Flash/shockwave event spawners | One dominant element at a time |
| P3 | Downscaled glow pass | shadowBlur / full-screen flashes | Studio bloom at 60fps |
| P4 | Dot/dither texture stamp | Ambient particle systems | Filmic richness, zero entities |

## Caveats

- Gemini's AE-effect descriptions are interpretations via URL
  Context + Search grounding — verify against the video before
  treating effect names/parameters as exact.
- The `multiply`-not-`destination-out` correction in the follow-up
  supersedes the main response's Technique E.
