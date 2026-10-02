# Real-Time 3D Audio-Reactive Architecture — Gemini Pass (2026-10-02)

Two Blender tutorials translated to real-time browser architecture.
Pairs with `docs/knowledge/gemini-threejs-pipeline-2026-10-02/`
(Three.js scene pipeline) and
`docs/knowledge/gemini-raymarching-audio-reactive-2026-10-02/`
(shader techniques).

## Provenance

| | Video | Gemini chat |
|---|---|---|
| A | CGMatter — "Create An Audio Visualizer Fast" (1:56). https://www.youtube.com/watch?v=AOP0yARiW8U — 10,763 likes / 159K views (~6.8% ratio) | https://aistudio.google.com/prompts/1mwrGTY-8sbdyYkb5-dlaWNWyBOOqhXNU |
| B | Ducky 3D — "Blender - Make anything React to Music" (3:00). https://www.youtube.com/watch?v=l8RHRNZQEuE — 12,394 likes / 346K views (~3.6%) | https://aistudio.google.com/prompts/1wI6YmutTy1k6dUSqmxIw7CtqGmJMzgWd |

- Model: **gemini-3.8-flash** in both chats. gemini-3.0-flash was not
  offered in the AI Studio picker (and "Gemini 3 Flash Preview (legacy)"
  was paywalled), so the free-tier default was used.
- URL Context: **ON** in both. Google Search grounding also on.
- Technique lists came from YouTube Ask AI triage (timestamps below),
  not transcript dumps — cheaper on quota, no sponsor-segment noise.
- Date: 2026-10-02.

## Part A — CGMatter: pin-board visualizer → real-time

Ask triage: instancing cylinders on a subdivided plane (0:11–0:24);
Displace + Clouds texture driven by an Empty (0:29–1:00); bake audio to
F-Curves (1:01–1:12); Speaker-object audio playback (1:17–1:21);
Geometry Nodes Separate XYZ + Color Ramp keyed to Z-displacement
(1:23–1:37).

### 1. Instanced pin-board → THREE.InstancedMesh

Never spawn thousands of `THREE.Mesh` (draw-call explosion). One
`InstancedMesh` with low-poly cylinder geometry (8 radial segments),
static grid matrices set once at init:

```ts
const count = 100 * 100; // 10,000 pins, 1 draw call
const instancedMesh = new THREE.InstancedMesh(cylinderGeo, material, count);
const dummy = new THREE.Object3D();
for (let x = 0; x < 100; x++)
  for (let z = 0; z < 100; z++) {
    dummy.position.set((x - 50) * spacing, 0, (z - 50) * spacing);
    dummy.updateMatrix();
    instancedMesh.setMatrixAt(x * 100 + z, dummy.matrix);
  }
instancedMesh.instanceMatrix.needsUpdate = true;
```

Cost/payoff: low cost, massive payoff. Per-instance band mapping:
pre-bake a static `InstancedBufferAttribute aBandIndex` (center pins =
bass, outer edge = highs); in GLSL index `uniform float uBands[6]`.

### 2. Displace + Clouds → GPU-side noise

Do NOT update 10,000 instance matrices on the CPU per frame (GC +
bus-transfer overhead). Push displacement into the vertex shader with
simplex noise; `uTime` scrolls the noise field (the "Empty" equivalent),
`uAudioDisplacement` scales it:

```glsl
float noise = snoise(vec3(instanceMatrix[3].xz * 0.05, uTime * 0.4));
float height = clamp(noise * uAudioDisplacement, 0.05, 5.0);
transformed.y *= height;
transformed.y += height * 0.5; // keep base on the floor
```

To keep PBR lighting/shadows/fog, patch `MeshStandardMaterial` via
`onBeforeCompile` at `<begin_vertex>` (displacement + elevation
varying) and `<color_fragment>` (ramp lookup before lighting).

### 3. Bake sound to F-Curves → pre-baked FFT lookup table (THE BIG ONE)

`AnalyserNode.getByteFrequencyData()` is real-time only: it cannot
scrub backward on a timeline, and any frame stutter during export
permanently desyncs audio from video. For a video *generator*,
determinism beats liveness.

Solution: decode once with `AudioContext.decodeAudioData()`, run an
offline FFT pass in a Web Worker over the whole buffer, and store a
per-frame feature table (60 fps) for O(1) lookup during scrub/render:

```ts
interface FrameAudioData {
  bass: number;   // 20–150 Hz
  mid: number;    // 250–2500 Hz
  treble: number; // 4–16 kHz
  rms: number;
}
// audioDataLUT[currentFrameIndex] — O(1) sync lookup
```

Worker spec from the pass: 44.1 kHz, FFT N=2048 (Δf ≈ 21.53 Hz/bin),
hop = 735 samples (exactly 1 frame @ 60fps), Hann window. 6-band model
with bin ranges; asymmetric smoothing α = 1−e^(−Δt/τ), Δt=1/60
(sub/bass τ_att=8ms/τ_rel=100ms; mids 15/90ms; highs 2/45ms).
Normalization: P98 percentile per band across the full song; floor gate
at −48 dB → 0.0 so silent intros stay idle; soft-knee
`tanh(E/P98)` bounded [0,1].

Dual-mode architecture: **offline LUT for timeline/export**,
live AnalyserNode fallback for interactive preview.

### 4. Speaker-object sync → master clock discipline

Never drive the timeline from `requestAnimationFrame` intervals
(they fluctuate). Single source of truth: `audioContext.currentTime`
when playing; a synced frame index when scrubbing/paused:

```ts
const currentTime = isPlaying ? audioContext.currentTime - startTime : scrubbedTime;
const currentFrame = Math.floor(currentTime * 60);
const audioFeatures = audioLUT[currentFrame] ?? defaults;
material.uniforms.uAudioDisplacement.value = audioFeatures.bass;
```

Export determinism checklist: step-based frame loop (no
`performance.now()` / `audioContext.currentTime` / rAF during
export); feed the WebGL canvas directly to `new VideoFrame(canvas)`
— no `toBlob()`/`readPixels` round-trip (that drops 60fps → 10–15);
bound the shader time uniform (`uTime = (frameTime*speed) % 1000.0`)
to avoid GLSL float-precision drift on long renders.

### 5. Z-displacement → ColorRamp → 256×1 gradient texture

Vertex shader passes normalized elevation as a varying; fragment
shader samples a 1×256 canvas gradient — swap one tiny texture for a
whole new theme preset (Cyberpunk, Synthwave, Acid…) at zero render
cost:

```glsl
uniform sampler2D uColorRamp;
varying float vElevation;
void main() {
  vec3 color = texture2D(uColorRamp, vec2(vElevation, 0.5)).rgb;
  gl_FragColor = vec4(color, 1.0);
}
```

**Top 3 to implement first (ranked):** (1) pre-baked FFT LUT engine —
the platform backbone; (2) InstancedMesh pin-board — instant
high-budget look, one draw call; (3) ColorRamp theme textures —
dozens of presets, zero GPU cost.

## Part B — Ducky 3D: the universal binding system

Ask triage: Displace + Clouds base motion (0:43–0:58); right-click
keyframe any property (1:02, 1:12, 2:25, 2:29); bake sound to
F-Curves (1:16, 1:40, 2:32, 2:38); Video Sequencer audio sync
(1:46–2:07). Philosophy: "bake any sound into any animatable
property."

The real-time equivalent is a **zero-allocation modulation matrix**:

```
[Web Audio Graph] → AnalyserNode → [Feature Extractor] (flat feature
vector, once per tick) → [Binding Engine @ rAF] (gate → attack/decay →
curve → remap → blend) → [Three.js Object3D | GLSL uniform | Canvas2D state]
```

React stays on the configuration boundary only. No `useState` in the
per-frame path.

### Feature vector — expose 8, never raw bins

Continuous bands: sub-bass 20–60 Hz, bass 60–250 Hz, mids
250 Hz–2.5 kHz, treble 2.5–8 kHz, air 8–20 kHz. Dynamics: RMS
(master loudness), spectral flux (onset/rate-of-change), section
energy (3-second rolling RMS → verse/chorus/breakdown without
authored automation). Discrete: transient impulses (1.0→0.0 decay)
for cuts/flashes/glitches.

### Per-binding signal chain (mandatory order)

`raw → [gate] → [attack/decay] → [transfer curve] → [remap/blend] → target`

```ts
export type AudioFeatureType =
  'subBass' | 'bass' | 'mids' | 'treble' | 'air' | 'rms' | 'spectralFlux';
export type BlendMode = 'add' | 'multiply' | 'replace';

export interface AudioBinding {
  id: string; name: string; enabled: boolean;
  sourceFeature: AudioFeatureType;
  threshold: number;  // noise gate 0..1
  gain: number;       // pre-amp, e.g. 1.0–4.0
  attack: number;     // seconds, e.g. 0.01
  decay: number;      // seconds, e.g. 0.20
  exponent: number;   // 1.0 linear, >1 exponential, <1 log
  outMin: number; outMax: number;
  blendMode: BlendMode;
  targetRef?: any; targetProp?: string;   // runtime only, never serialized
  baseValue: number; currentValue: number;
}
```

Frame-rate-independent envelope:
`factor = 1 − exp(−Δt/τ)` with τ = attack when target > current else
decay.

### Guardrails against visual soup

- **Modulation hierarchy:** macro (RMS/section) → global properties
  (fog, ambient, base FOV); rhythm (sub/bass) → 1–2 dominant
  transforms; accents (mids/flux) → secondary attributes; transients
  → momentary triggers. Never bind treble to camera position or mesh
  scale (minimum 0.08 s decay clamp on positional params).
- **Kick-monoculture:** bass, sub-bass, and RMS all spike together —
  if camera zoom + mesh scale + color + displacement all bind to
  bass, the whole frame expands at once and depth dies. Enforce the
  hierarchy above.
- **Default blend = add** (offset from artist-authored baseline), not
  replace (which strips art direction).

### Auto-calibration (adaptive normalization)

Asymmetric rolling min/max tracker per band (O(1), ~7 ops, 0 bytes
allocated) placed BEFORE the gate, so presets authored for [0,1]
behave identically on quiet demos and brickwalled masters. Bounds
expand instantly on new peaks, decay slowly toward the signal mean.

### GLSL path — pack, don't scatter

`uniform vec4 uAudio[2]` (8 features) — one `gl.uniform4fv` per
frame. Individual floats each occupy a full 16-byte register under
STD140-style packing, so `float uAudio[8]` costs the same as 8
vec4s; packing into 2 vec4s is the minimal driver upload.

### Transient detector

Band-limited half-wave-rectified spectral flux + adaptive threshold
(rolling mean × 1.4) + per-band cooldown: kick 0.15 s, snare 0.18 s,
hats 0.06 s (permits 1/32 trap rolls). Snare detection on the mono
sum to reject stereo-panned guitar bleed.

### Serializable presets

Never store live pointers. `targetPath` strings
(`"objects/HeroMesh/scale/x"`, `"materials/WaterMat/uniforms/uDistort"`)
resolved once at preset load via a `BindingResolver`; strip
`targetRef/targetProp/baseValue/currentValue` on `JSON.stringify`.

## Cross-pass convergence

All six passes in this batch independently converged on the same
architecture: **feature extraction → asymmetric attack/decay
envelopes → declarative bindings → render targets** (shaders /
instanced geometry / Canvas2D params). Build it once as shared
infrastructure; the Canvas2D modulation hub, the Three.js uniform
registry, and the shader envelope chain are three faces of the same
system. Do not build three separate audio-reactive implementations.

## Caveats

- Gemini's claims about the Blender videos' internals are
  interpretations drawn with URL Context + Search grounding — treat
  as leads, verify against the videos before citing specifics.
- The pre-baked LUT is the correct backbone for a *generator*;
  keep the live path for interactive preview. Both feed the same
  binding schema.
