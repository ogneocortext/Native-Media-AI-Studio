# Audio-Reactive Raymarching Shaders — Gemini Pass (2026-10-02)

Two raymarching tutorials translated to audio-reactive GLSL for music
videos, with explicit GPU budgeting for the GTX 1070 Ti.
Pairs with `docs/knowledge/gemini-blender-3d-audio-reactive-2026-10-02/`
(binding system + LUT backbone).

## Provenance

| | Video | Gemini chat |
|---|---|---|
| A | SimonDev — "Ray Marching, and making 3D Worlds with Math" (6:27). https://www.youtube.com/watch?v=BNZtUB7yhX4 — 14,477 likes / 312K views (~4.6%) | https://aistudio.google.com/prompts/1U8eKEx3MjVyxuqKFxniSlt8Dg3w7PBuE |
| B | kishimisu — "An introduction to Raymarching" (34:02). https://www.youtube.com/watch?v=khblXafu7iA — 11,050 likes / 242K views (~4.6%). Shadertoy base: https://www.shadertoy.com/view/MfX3WH | https://aistudio.google.com/app/prompts?state=%7B%22ids%22:%5B%221FtJF21PF_KUDAg48bWlTC-7ZPflSfNJc%22%5D,%22action%22:%22open%22,%22userId%22:%22107963110793887326201%22,%22resourceKeys%22:%7B%7D%7D&usp=sharing |

- Model: **gemini-3.8-flash** in both (3.0 not offered; legacy 3 Flash
  Preview paywalled). URL Context: **ON** in both.
- Technique lists from YouTube Ask AI triage, not transcript dumps.
- Date: 2026-10-02.

## Standard audio uniform block

Compute smoothed values on CPU at 60 Hz (saves GPU ALU); feed every
raymarch shader the same block:

```js
uTime, uBeatPhase /* [0,1) continuous, tempo-safe */, uBeatSnap /* 1.0 on beat, 120ms decay */,
uBass /* 20–150 Hz, atk 10ms / dec 80ms */, uMids /* 250–2500 Hz, 20/140ms */,
uHighs /* 4–16 kHz, 5/60ms */, uSectionRamp /* [0,1] verse→chorus transition */,
uTransient /* spectral flux onset */, uCentroid /* brightness */, uEnergy /* multi-second RMS */
```

Never feed raw FFT bins to shaders. Set
`analyser.smoothingTimeConstant = 0.0` — Web Audio's native smoothing
is an unconfigurable symmetric exponential that blurs transients;
do all shaping in the app's own envelope chain.

## Ranked techniques (payoff per GPU-ms, 1070 Ti @ 1080p)

### 1. Infinite repetition + folded space — near-zero cost, massive payoff

```glsl
vec3 opRep(vec3 p, vec3 c){ return mod(p + 0.5*c, c) - 0.5*c; }
```

One primitive becomes an infinite brutalist corridor / sci-fi
tunnel / kaleidoscope in O(1). Drive repetition density with
`uEnergy` (grid tightens into a claustrophobic corridor during
builds); fold/twist angles burst on `uTransient`. Navigate with an
accumulated beat-time (`p.z += uBeatTime*4.0`) — never advance with
raw audio or motion reverses when volume drops. Keep bounding
margins inside `mod()` so the near plane doesn't clip; don't let
spacing drop below ~1.0 or step counts explode on grazing angles.

### 2. Smooth-minimum metaballs — negligible ALU, maximum payoff

```glsl
float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0);
  return mix(b, a, h) - k*h*(1.0 - h);
}
```

`uBass` drives blend factor k: quiet → rigid separated shapes;
kick → k spikes (~0.6–0.8), melting everything into a fluid/mercury
organism. Attack 15 ms, decay ~220 ms to mimic surface tension.

**Section transitions ("melting" verse→chorus):** raw smin fails
across disparate scenes (wide voids → giant featureless blob).
Fix: canonical local-space morphing — design each scene around the
origin at ~unit bounds, interpolate coordinate frames so geometries
coincide in normalized space during the melt, multiply the distance
back by interpolated scale to preserve the metric. Drive with
`uSectionRamp` (0→1 over ~2.5 s cosine ramp from the section
tracker); spike k with `uBass` so transients make the liquid bridge
pulsate before resolving.

### 3. Step-glow volumetrics — free haze, no lighting pass

Accumulate `glow += exp(-d*4.0)` inside the march loop; add
`glow*0.015` to the output color. `uTransient` scales the flash
(5 ms attack / 90 ms decay) for neon silhouettes on snare hits.
Bypasses shadow/lighting passes entirely.

### 4. Beat-phase-synced wave distortion — extreme payoff, low cost

Standard `sin(p.x*f + uTime)` drifts off tempo. Drive the temporal
phase from beat phase φ ∈ [0,1) so crests repeat every beat:

```glsl
float temporalPhase = uBeatPhase * 6.2831853;
float amplitude = 0.08 + uBass*0.25 + uBeatSnap*0.15;
return sin(p.x*2.0 + temporalPhase) * cos(p.z*2.0 + temporalPhase*0.5) * amplitude;
```

Wave crests snap to peak amplitude on downbeats, relax on offbeats.
Guard: sinusoidal distortion breaks the SDF unit-gradient metric —
use conservative step relaxation near surfaces (adaptive
`omega = 1.0 + 0.25*smoothstep(0.02, 0.4, dS)`, tightened during
transients).

### 5. Tetrahedral normals + cheap AO — do this, skip soft shadows

Use Inigo Quilez's 4-tap tetrahedral normals (33% fewer lookups
than central differences). Modulate micro-structure inside `map()`
with `uCentroid` for chiseled/metallic surfaces on high-frequency
content (10 ms / 60 ms).

**Explicit skip: soft shadows.** At ~2M pixels with 60% surface
hits, 24–32 extra light-march steps cost **+4.5–8.0 ms/frame** —
35–45% of a 16.6 ms budget on the 1070 Ti, for fidelity wasted in
fast music videos. Replace with 4-tap directional ambient occlusion
(+0.4 ms). If shadows are ever wanted: 16 steps max, half-res
offscreen target, background geometry exempt.

### 6. CSG carve on transients — trivial cost, high impact

```glsl
float core = sdSphere(p, 1.2 + uTransient*0.8);
float scene = opSubtraction(core, sdBox(p, vec3(1.5))); // expanding core carved from a monolith
```

Instant attack, ~100 ms linear decay. High impact for drops and
rhythmic stutter.

## JS-side infrastructure

**AudioEnvelopeChain** (zero-allocation): persistent `Float32Array`
FFT buffers, no `.map()`/`.reduce()` in `update()`; per-feature
attack/decay followers; `beatTime += dt * bpm/60 * (1 + uBass*0.5)`.
**BeatPhaseTracker**: PLL-style accumulator — phase never resets on
BPM jumps (waves stretch fluidly, no popping); proportional drift
correction closes phase error in ~250 ms; tab-switch guard on `dt`.
**FrameGovernor** (adaptive quality, zero recompile): EMA frame time,
asymmetric hysteresis — downscale fast (4 frames), recover slow
(90 stable frames). Tiers adjust `u_maxSteps` (48–80) + render scale
via uniforms and `renderer.setPixelRatio` — never `#define` (full
recompile = 50–200 ms stutter). Dynamic step bound pattern:
`#define HARD_CAP_STEPS 96` + `if (i >= u_maxSteps) break;`.
**DynamicResolutionPipeline**: raymarch to 0.75× offscreen target
(1440×810, saves ~44% fragment invocations, imperceptible in
motion), upscale through FXAA; EMA ±0.05 scale steps with 300 ms
debounce.

**Section detection** (`uSectionRamp` source): 0.7 spectral flux +
0.3 low-band RMS novelty vs Welford adaptive threshold
(mean + 2.5σ), 12 s cooldown, cosine ramp over 2.5 s.

## 1070 Ti budget (1080p60)

- Raymarch step budget: ~80–110M steps/sec before dropping frames.
- `MAX_STEPS` 64–80; never 128+.
- Step-glow at half-res: +0.6 ms — always keep.
- Soft shadows: +4.5–8.0 ms — kill first, entirely.
- Bounding-volume early-outs around interior detail: cheap, do it.

## Caveats

- All GLSL/JS is Gemini's synthesis from the tutorials via URL
  Context + Search grounding — compile-test every snippet before
  trusting it; the canonical copies live in the linked chats.
- The kishimisu pass's code blocks were partially reconstructed
  from rendered page text; treat long lines as approximate until
  checked against the chat.
