---
tags:
  - visualization
  - shaders
  - glsl
  - color-science
  - oklch
  - tonemapping
  - dithering
  - audio-reactive
aliases:
  - Shader Color Science
  - Perceptual Color for Visualizers
  - Tonemapping and Dithering Notes
cssclasses:
  - analysis
  - research
date: 2026-09-23
---

# 🎨 Shader Color Science — Perceptual Palettes, Tonemapping, Dithering

Research notes behind the `abstractWaves` v3 → v4 shader upgrades
(`packages/frontend/src/features/visualizer/shaders.ts`). Written after
frame-reviewing a real recording of the shader on *Human in the Loop V2*
and finding loud sections washing the full frame to flat pink.

## 1. The wash-out problem and what fixed it

**Symptom (from recorded frames):** at loud chorus moments the entire frame
bloomed into a featureless pink haze — wave, background, and glow all
clipped together. Contrast collapsed.

**Mechanism:** three gains stacking at once —
`palette * bands * (0.45 + u_energy * 1.35)` (up to 1.8×),
glow-band width floor of 1.5 (bands widen to near full-frame),
plus a beat flash of up to 0.55 near-white. Sum ≈ 2.35 at the crest,
≈ 1.5 just off it → hard clip.

**Fixes applied (v3):**
- Glow-band width floor `1.5 → 2.5` so max bass + beat can't flood the frame.
- Exponential highlight rolloff `color = 1 − exp(−color × 1.4)` on the final
  pixel. Measured: crest still hits 0.96, off-wave haze 1.50 → 0.82,
  far-field background 0.39 → 0.23 (dark background survives), mids
  untouched (0.5 → 0.503), blacks stay black (0.02 → 0.028).

### Tonemapping operators compared (for future reference)

| Operator | Formula | Character |
|---|---|---|
| Identity (none) | `c` | Blows out — two-thirds of a bright wash pins at the ceiling |
| Reinhard | `c / (1 + c)` | Smooth rolloff, but compresses midtones too (flattens everything) |
| ACES filmic (Narkowicz fit) | `(v(2.51v+0.03))/(v(2.43v+0.59)+0.14)` | Cinematic; **lifts** midtones (aces(0.5) = 0.62) while rolling highlights off. Known hue skews in saturated reds/blues |
| AgX-style | — | 2026 default for productions; desaturates cleanly in highlights, preserves hue |
| Exponential (shipped in v3) | `1 − exp(−c × 1.4)` | Preserves mids exactly, gentle shoulder. Simplest correct choice for a visualizer; revisit ACES if a more "cinematic" lift is wanted |

Rule of thumb: never let stacked audio-reactive gains hard-clip. Pick one
rolloff, apply it once, at the very end of the shader.

## 2. Perceptual color: do palette motion in Oklch, not RGB

**Problem:** the v2 palette swept blue → pink with `mix(color1, color2,
sin(...))` in raw RGB. Measured against Oklch, the RGB mix of these two
endpoints sags: chroma dips to 0.115 at t=0.25 (14% below the blue endpoint,
34% below the pink — a visible desaturation hole mid-sweep), and hue
velocity is uneven (262°→289°→316°→337°→352°: steps of 27, 27, 21, 15 —
decelerating through violet).

**Fix (v4):** convert the two endpoint colors to Oklch once, offline, and
interpolate there:

- blue `(0.2, 0.4, 1.0)` → `oklch(0.7397, 0.1340, 262.03°)`
- pink `(1.0, 0.2, 0.5)` → `oklch(0.7544, 0.1735, 351.60°)`

Chroma now rises monotonically 0.134 → 0.174 (no dip) and hue advances in
even 22.4° steps. The 262° → 352° path passes through violet, matching the
blue → purple → pink look the recording already had, with the muddy middle
removed. (Lightness was already nearly flat for this particular pair —
0.7397 → 0.7544 — so the win here is chroma and hue velocity, not lightness.
The general rule still stands: any *programmatic* color motion belongs in a
perceptual space, because you can't know which axis RGB is distorting until
you measure.)

**Honesty note:** an earlier draft of this doc claimed the RGB sweep "pulsed
in brightness." Measuring it showed that was wrong for this palette — the
defect was the chroma dip and uneven hue velocity. Corrected 2026-09-23;
the claim above is the measured one.

**GLSL pattern** (Björn Ottosson matrices; working space is the shader's
native RGB, so uniformity is approximate but far better than RGB mixing):

```glsl
vec3 oklch_to_linear_srgb(vec3 lch) {
  float L = lch.x; float C = lch.y; float H = radians(lch.z);
  float a = C * cos(H); float b = C * sin(H);
  float l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  float m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  float s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  float l = l_*l_*l_; float m = m_*m_*m_; float s = s_*s_*s_;
  return vec3(
     4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
    -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
    -0.0041960863*l - 0.7034186147*m + 1.7076147010*s);
}
// per pixel:
vec3 palette = oklch_to_linear_srgb(mix(okBlue, okPink, sweep));
palette = max(palette, vec3(0.0)); // out-of-gamut guard before tonemap
```

**Gamut note (corrected 2026-09-23):** high-chroma Oklch can fall outside
sRGB. The original writeup claimed the shipped sweep was fully in-gamut
(worst excursion 0.0000) — that was wrong. Float32 validation found
`worst_neg = 0.00000` but `worst_over = 0.03672`: values up to ~1.037 exist
before the exponential highlight rolloff. The `max(palette, 0.0)` line only
guards the negative side; the positive overshoot rides into the rolloff,
which compresses it in practice, but the palette is NOT strictly in-gamut.
When authoring new palettes, verify the sweep offline the same way and
report both excursions.

**General rule:** any *programmatic* color motion (hue cycles, beat-driven
palette shifts, energy-driven saturation) belongs in Oklch/Oklab. Hand-tuned
RGB endpoints are fine as *inputs* — convert once, animate perceptually.

## 3. Dithering: one LSB of hash noise, after the tonemap

**Problem class:** smooth dark gradients (vignettes, glow falloffs, near-black
backgrounds) band into visible steps on 8-bit displays — exactly the gradients
this shader is built from.

**Fix (v4):** add `±0.5/255` hash dither as the last operation before
`gl_FragColor`:

```glsl
float dith = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
color += (dith - 0.5) / 255.0;
```

**Placement rule (measured by others, adopted here): dither once, after
exposure/tonemap — the only point in the pipeline where "1/255" is actually
one display level.** Dithering earlier (e.g. before the tonemap) gets
amplified by every gain downstream; gamma's encoding slope is steepest in
the near-black range where these gradients live, so early dither shows up
as visible grain. One dither point at the write covers every upstream pass.

No blue-noise texture needed at this scale — a per-pixel hash is
indistinguishable for ±0.5 LSB. If dithering ever becomes visible as static
grain, animate the hash with a frame counter.

## 4. Small corrections from the same review

- **Depth grid was numerically invisible** (max contribution ~0.04 after all
  the fade factors). Either make an effect visible or delete it — dead code
  still costs ALU per pixel. Bumped to actually read as "faint 3D grid".
- **Peak particles too faint to register** (0.025 base) → 0.045.
- **Beat flash color** mixes warm-white → purple by treble; kept — it reads
  well on beats without the wash now that the rolloff exists.

## 5. Open / not yet done

- Palette motion is still time-driven, not music-driven. The principled next
  step is driving the Oklch hue from section/phrase state (a new uniform),
  so color shifts land on musical boundaries instead of a 36 s clock.
- ACES vs exponential: exponential shipped for midtone fidelity; try the
  Narkowicz ACES fit behind a preset flag if a more cinematic lift is wanted.
- The same three treatments (rolloff, Oklch palette motion, final dither)
  apply to the other `SHADER_PRESETS` entries — v4 only touched
  `abstractWaves`, the default fallback and the recorded one.

## Sources

- Oklch perceptual uniformity: OKLCH primer (wiki.fabula.vision), shift-css
  oklch-colors docs, jangtrinh/design-os color-science notes
- Tonemap comparison data (ACES lifts mids, Reinhard flattens): glyphengine
  `docs/agents/hdr-tonemap.md`; Narkowicz ACES fit via shader-advent-2024;
  ACES vs AgX 2026 default: alexanderpino/skills rendering notes
- Dither-after-tonemap placement rule and measurement: insomniac-coder/ragev
  `docs/RENDERING-REVAMP.md` (WR-2); blue-noise technique: maximeheckel
  volumetric lighting/dithering articles; three.js `dithering_fragment`
  (±0.25/255 precedent)
