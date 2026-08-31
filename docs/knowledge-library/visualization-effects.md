---
tags:
  - visualization
  - 3d-rendering
  - webgpu
  - tsl
  - particles
  - shaders
  - post-processing
  - audio-reactive
  - effects
aliases:
  - Visualization Effects Guide
  - Visual Effects Library
  - 3D Effects Compendium
cssclasses:
  - technical-guide
  - effects-library
date: 2026-08-29
research_date: 2026-08-29
sources: 15
---

# ✨ Visualization Effects & 3D Rendering Techniques (2026 Expanded)

> [!info] Scope
> Expanded knowledge base for real-time visualization effects — WebGPU/TSL, particle systems, shaders, post-processing, volumetric rendering, and audio-reactive mappings. Synthesizes 15+ sources from Three.js r185, Blender 5.2 LTS, and open-source VJ engines (Phosphor/Fosfora, Sythm, Dalia, LYRA, Bytewave).

> [!tip] Companion Docs
> - [[3d-rendering|🧊 3D Rendering]] — GPU/CUDA/Blender pipeline
> - [[three-js-studio|🌐 Three.js Studio]] — Browser studio implementation
> - [[../knowledge/audio-visualization-techniques-2026|Audio Visualization Techniques]]
> - [[../knowledge/threejs-webgpu-best-practices-2026|Three.js WebGPU Best Practices]]

---

## TL;DR — What's New in 2026

| Shift | Before (2024) | Now (2026) | Why It Matters |
|-------|---------------|------------|----------------|
| **Renderer** | `WebGLRenderer` default | **`WebGPURenderer`** recommended (r171+), `three/webgpu` import | ~95% browser coverage (Baseline Jan 2026), auto WebGL2 fallback |
| **Shaders** | Raw GLSL strings, `onBeforeCompile` | **TSL (Three Shading Language)** — JS nodes → WGSL/GLSL | Type-safe, IDE autocomplete, single codebase for both backends |
| **Particles** | CPU → buffer upload, ~50k ceiling | **Compute shaders + `StorageBufferAttribute`** — 100k in <2ms, 1M+ achievable | Zero-copy VRAM, GPU-only simulation |
| **Post-processing** | `EffectComposer` passes | **`RenderPipeline` node stack** — MRT, auto pass merging, SSGI/SSS/DoF | 2x faster, new effects exclusive to WebGPU |
| **Lighting** | Forward, limited dynamic lights | **Clustered (Forward+) lighting** | Hundreds of lights without draw-call cliff |
| **Blender** | EEVEE Legacy | **EEVEE Next (Blender 4.2+) → 5.2 LTS** — per-BSDF raytracing, Fast GI, 2x instancing perf | Real-time ray-traced reflections/GI |
| **3D Capture** | Meshes only | **Gaussian Splatting / 3DGS + NeRF** native in Blender/Three.js | Photoreal scans as renderable primitives |

---

## 1. WebGPU Era Rendering Pipeline

### 1.1 WebGPURenderer — The New Default

```ts
// ✅ 2026 — Canonical pattern (three r185, R3F v9.7)
import * as THREE from 'three/webgpu';
const renderer = new THREE.WebGPURenderer({ antialias: true });
await renderer.init(); // REQUIRED — async backend negotiation

// R3F Canvas
import { WebGPURenderer } from 'three/webgpu';
<Canvas gl={async (props) => {
  const r = new WebGPURenderer(props as any);
  await r.init();
  return r;
}}>
```

**Critical migration notes** (from [threejs.org/manual/en/webgpurenderer](https://threejs.org/manual/en/webgpurenderer.html), [BitSoul 2026](https://bitsoulhosting.com/marketplace/blog/threejs-webgpurenderer-production-ready-what-breaks)):

- **No GLSL shim**: `ShaderMaterial` / `RawShaderMaterial` / `onBeforeCompile` do NOT run under WebGPURenderer. Port to TSL `Fn()` nodes.
- **`EffectComposer` is dead**: replaced by `RenderPipeline` node composition. Bloom, SSAO, DoF all have faster TSL node equivalents + new **SSGI, SSS, better DoF** exclusive to WebGPU.
- **KTX2 black-texture bug**: Call `KTX2Loader.detectSupport(renderer)` *after* `await renderer.init()` — before = silent black/magenta meshes (most common 2026 forum report).
- **VideoTexture wiring**: Must go through `THREE.TextureNode` explicitly.
- **Fallback is automatic**: `forceWebGL: true` only for debugging; otherwise `three/webgpu` import bundles fallback.

### 1.2 TSL (Three Shading Language)

Node-based, JS-functional language — compiles to **WGSL** (WebGPU) and **GLSL** (WebGL2 fallback).

```ts
import { uniform, positionLocal, texture, Fn, vec3, float } from 'three/tsl';

// Uniform — CPU → GPU live control
const uTime = uniform(0);

// Reusable node function — type-safe, modular
const dissolve = Fn(([pos, threshold]) => {
  const noise = texture(noiseMap, pos.xz).r;
  return noise.sub(threshold).step(0); // GLSL-correct: step(edge, x)
});

// Per-instance variation via instanceIndex (compute-driven)
positionLocal.add(instancePosition.mul(uTime));
```

**Why TSL wins** (Field Guide to TSL — Maxime Heckel):
- Single codebase runs on both backends
- JS stack traces instead of vendor-specific shader compile errors
- `uniform()` hot-reloadable from React/JS without recompile
- Composable — no copy-pasted GLSL strings

> [!warning] Mixed imports cost MB
> Never `import * as THREE from 'three'` alongside `from 'three/webgpu'` — bundles *entire* WebGL codebase twice.

### 1.3 Compute Shaders — The 100k→1M Particle Breakthrough

**The bottleneck WebGPU solves**: WebGL updates particles on CPU every frame → buffer upload. WebGPU runs the simulation *entirely in VRAM*.

| Pattern | WebGL | WebGPU Compute |
|---------|-------|----------------|
| Position update | CPU for-loop, `needsUpdate=true` | `StorageBufferAttribute` + `renderer.compute()` |
| 100k particles | ~30ms/frame (stutters) | **<2ms** (mid-range GPU) |
| 1M particles | impossible | achievable with workgroup tuning |
| CPU involvement | per-frame copy | one dispatch command |

**Minimal GPGPU particle loop** (from [devcheolu benchmark](https://devcheolu.com/en/posts/nB4Goj6nteClAWsInhtX)):

```ts
// 1. Allocate VRAM-resident buffer (zero-copy)
const positions = new THREE.StorageBufferAttribute(count * 3, 3);

// 2. Compute shader — each thread handles one particle
const computeParticles = Fn(() => {
  const idx = instanceIndex;
  const pos = positions.element(idx);
  // curl-noise + Lorenz-driven ABC flow (see Sythm pattern)
  pos.add(velocity.mul(deltaTime));
})().compute(count); // dispatches ceil(count/256) workgroups

// 3. In useFrame — GPU updates, then renders, no CPU copy
renderer.compute(computeParticles);
mesh.geometry.setAttribute('position', positions);
```

**Rules**:
- Workgroup size **256–512** (check `device.limits.maxComputeInvocationsPerWorkgroup`)
- Never call `geometry.attributes.position.needsUpdate = true` in compute path — kills zero-copy
- `instancedArray` for instanced meshes (grid/particle spawn on GPU)
- Shared memory + subgroup ops for reductions; avoid atomics when possible

---

## 2. Shader Effects Library

### 2.1 Procedural Noise & Fields

| Technique | Use | Cost | TSL Snippet |
|-----------|-----|------|-------------|
| **Simplex / Perlin 3D** | Terrain, cloud drift | ~50 instr (1 octave) → ~500 (8 octaves) | `noise(positionLocal.mul(2))` |
| **FBM (Fractal Brownian)** | Fluid, drift smoke | detail slider = octaves; halve for mobile | `fbm(pos, octaves: 4)` |
| **Curl Noise** | Vortex, particle turbulence | divergence-free → space-filling | `curlNoise(pos).mul(audioLow)` |
| **SDF + Raymarching** | Bubbles, coral reef, molten cracks | per-pixel, use for focal objects | `sdSphere(p, r)` → `raymarch(ro, rd)` |
| **Domain Warp** | Aurora curtains, drift FBM fluid | triple-warped FBM | `fbm(pos.add(fbm(pos)))` |

> [!tip] Slider-live constraint (from [Geometry Painter](https://tympanus.net/codrops/2026/08/11/exploring-procedural-geometry-with-three-js-and-webgpu/))
> Dragging a density slider must **never allocate**. Pre-zero instanced buffers, hide unused instances with zero-scale matrix — keeps draw call constant at 2000 instances even when slider says 20.

### 2.2 Material Effects (TSL Node Materials)

**Garden Anomaly recipe** (Codrops WebGPU+TSL, Aug 2026) — transmissive glass shell:

```ts
// MeshPhysicalNodeMaterial — all TSL nodes
transmission: 0.95, thickness: uniform(1.2), ior: 1.55,
iridescence: 0.9, clearcoat: 1.0,
attenuationColor: vec3(0.2, 0.4, 1.0)

// Custom vertex bulge — 8 uniformArray impact vectors
positionNode = Fn(() => {
  let disp = vec3(0);
  Loop(8, ({i}) => {
    const dir = impactDirs.element(i);
    const amp = impactAmps.element(i);
    disp.add(dir.mul(amp).mul(sphereFalloff(positionLocal)));
  });
  return positionLocal.add(disp);
})();

// Analytic normal perturbation (no texture) + chunky ice roughness map
normalNode = perturbedNormal; // tangent-frame derived
roughnessNode = texture(iceRoughness, uv()).r.mul(perPixelMod);
emissiveNode = texture(scanlineCanvas, uv.add(vec2(0, time.mul(0.5))));
```

**Dissolve / scatter** (portfolio staple 2026):

```ts
// MSDF text → particles via TSL noise — crisply scalable
const alpha = msdfTexture.r.sub(threshold).step(0);
const dispersed = positionLocal.add(noise(positionLocal).mul(uDisperse));
```

### 2.3 Geometry Painter Modes — Shader Gallery

Four production shaders from Chiro Visuals' Geometry Painter (WebGPU + BVH picking):

| Mode | Material | Key Params | Post Chain |
|------|----------|------------|------------|
| **Crystal veins** | Transmissive quartz (`transmission`, `ior 1.45`) | density, length, jitter | Studio 6-rectangle light + bloom |
| **Molten cracks** | Blackbody ribbon (`temperature → color`) | crack width, emissive intensity | Bloom threshold 0.9 |
| **Aurora silk** | Fold-locked silk, world-space wave | fold count, wave speed | Soft volumetric fog |
| **Bioluminescent reef** | World-space wave, emissive pulse | growth easing (`easeOutBack`), wave phase | Bloom + vignette |

All use **BVH-accelerated picking** (`three-mesh-bvh`) to convert drag → world-space path, fixed random per-instance seeds for stable variation.

---

## 3. Post-Processing Stack (RenderPipeline)

**Old**: `EffectComposer → [RenderPass, UnrealBloomPass, SSAOPass, ...]` — sequential, no MRT.

**New**: Node composition — passes merge automatically, MRT native.

```ts
// WebGPURenderer pipeline — TSL nodes
import { bloom, ssao, dof, ssgi, sss } from 'three/webgpu';

const pipeline = new THREE.RenderPipeline(renderer);
pipeline.add(bloom({ strength: 0.6, radius: 0.4, threshold: 0.85 }));
pipeline.add(ssao({ intensity: 1.2 })); // or ssgi for GI-grade AO
pipeline.add(dof({ focus: 2.5, aperture: 0.02 })); // new WebGPU DoF
// sss = subsurface scattering (skin/wax), ssgi = screen-space GI
```

| Effect | What It Does | Audio-Reactive Hook |
|--------|--------------|---------------------|
| **Bloom** (`strength/radius/threshold`) | Emissive bleed, dreamy atmosphere | `strength = lerp(0.4, 1.2, bass)` |
| **SSGI / Fast GI** | Screen-space indirect lighting | bake on chorus, disable on verse for perf |
| **SSAO / GTAO** | Contact shadows, depth grounding | static; enable always |
| **DoF** | Focus pull on beat | `focus = beat ? subjectDist : bgDist` |
| **Chromatic Aberration** | RGB split on transient | `amount = treble * 0.02` |
| **Vignette + Film Grain** | Cinematic framing | `grain = energy * 0.1`, vignette constant |
| **Feedback / Trails** | Previous-frame blend (drift, iris) | `feedbackOpacity = 0.92 + energy*0.06` |

> [!warning] Gotchas
> - Points = 1px under WebGPU backend — embers/plankton must be **instanced quads** with radial sprite, not `PointsMaterial`
> - Line width ignored — bead-chain `InstancedMesh` of spheres for trails
> - `MotionBlur` needs per-eye history separation for stereo (see Sythm)

---

## 4. Particle Systems — From 50k to 1M+

### 4.1 Architecture Comparison

```
WebGL path:  CPU positions[] → BufferGeometry.setAttribute() → needsUpdate → GPU (copy every frame)
WebGPU path: StorageBufferAttribute (VRAM) ← compute shader (GPU) ← render (zero-copy)
             └─ never leaves VRAM ─┘
```

### 4.2 Production Tiers (tested 2026)

| Tier | Count | Technique | GPU Target | Example |
|------|-------|-----------|------------|---------|
| **Light** | 1–10k | `Points` + TSL vertex displacement | Mobile / iGPU | Three-JS-Music-Visualiser circles |
| **Mid** | 8–50k | Instanced quads + curl noise | Laptop (GTX 1060) | Bytewave Galaxy 12k, Particles 8k |
| **Heavy** | 100k | Compute GPGPU, StorageBuffer | Mid-range desktop | devcheolu benchmark <2ms |
| **Extreme** | 250k–1M | Compute + indirect draw, zero-copy interop | RTX 3070+ | LYRA 1M tier, Sythm tens of millions |
| **Insane** | 10M+ | CUDA + OpenGL zero-copy interop, ring buffer trails | RTX 4090 | Sythm ballistic trail emission |

### 4.3 Advanced Forces (from Sythm — Lorenz + ABC Flow)

Sythm's hidden-engine pattern — **two chaoses stacked**:

1. **ABC flow** (Beltrami, divergence-free) → particles fill space, never clump; streamlines already chaotic
2. Coefficients A/B/C driven by **hidden Lorenz attractor** integrated with **RK4** (energy-stable vs Euler)
3. Extra **curl-noise** layer for fine turbulence — still divergence-free
4. **Per-drum shockwaves**: kick = slow thick shell + outward shove; snare = fast thin + tangential shear; hat = tenuous flash; epicenter = Lorenz state position
5. **Build → Drop**: build = flow speeds up, darkens, draws inward; drop = radial bloom + central shockwave + flash

_Trail emission_: GPU ring buffer of `GL_POINTS` into HDR `RGBA16F` framebuffer, additive Gaussian sprites, MSAA resolve. Spectrum stays in VRAM — only ~12 scalars return to CPU.

### 4.4 Reusable Particle Recipe (Bytewave + WebGPU)

```ts
// Bytewave stack: Next 14 + R3F + drei + postprocessing
// Visualizer modes as R3F components — swap via VisualizerScene.tsx
const modes = {
  galaxy: { count: 12000, shader: 'spiral GLSL vertex+fragment' },
  particles: { count: 8000, shader: 'orbital cloud GLSL' },
  neonTunnel: { shader: 'infinite corridor rings' },
  blackHole: { particles: 'accretion drain', core: 'raymarched disk' },
  waveTerrain: { geom: 'frequency-mapped mesh', sample: 'DataTexture' },
  spaceWarp: { field: 'hyperspace stars', warp: 'bass-reactive speed' },
  liquidWaves: { surface: 'fluid + GLSL fresnel' },
};

// Audio hook — values 0–1 every frame, outside React rerenders
const { bass, mid, treble, energy, beat, bpm, frequencyData } = useAudioAnalyzer();
// Additive blending for glow layering
<pointsMaterial blending={THREE.AdditiveBlending} depthWrite={false} />
```

---

## 5. Audio-Reactive Mapping — Beyond Bass→Scale

### 5.1 Frequency Bands (correct bin math)

```
binSize  = sampleRate / (fftSize)          // e.g. 48000/2048 = 23.44 Hz
bassBins = floor(250  / binSize)           // ~10 bins
midBins  = floor(4000 / binSize)           // ~170 bins
treble   = rest                            // high sparkle
```

Use `AnalyserNode(fftSize=2048, smoothing 0.8)` + exponential moving average in `useFrame` — never per-frame allocations (reuse `Float32Array`).

### 5.2 Feature Spectrum (2026 State of Art)

| Feature | Engine | What It Drives |
|---------|--------|----------------|
| **7-band + 13 MFCC + 12 chroma** | Phosphor/Fosfora (Rust audio) | Timbre → palette, pitch → hue |
| **Per-drum onsets** (kick/snare/hat separate) | Sythm (spectral flux) | Distinct gestures per voice |
| **Predictive tempo & phase** (adaptive oscillator) | Sythm | Visuals *anticipate* downbeat, not just react |
| **Phrase cues** (build/drop), **key & mode** | Sythm | Major/minor color, build→drop bloom |
| **512-bin log-spaced spectrum in VRAM** | Sythm | Zero-copy, GPU-side viz |
| **BPM + beat phase + lookahead energy** | Dalia (Rust/WASM) | Beat-locked preset switching, drop prediction |
| **Chromagram → harmonic hue** | Dalia | Key-derived HSL palettes |
| **Bass sustain + drop prediction** | Dalia mashup | Smoothstep-blended preset morph |

### 5.3 Mapping Patterns

**Vortex (zazieproductions/vortex-av-engine)**:
- Bass → inner core expansion
- Mid → wireframe polyhedron deformation
- Treble transients → surrounding particle dispersion

**Phase-Viz** (MIT, React+TSL):
- Multiple visual layers, adjustable order
- Mesh deformation = amplitude, particles = frequency

**Vertex Displacement** (Audio-visualizer-3d, 20 shapes):
- Each vertex ↔ frequency bin, displacement = amplitude, color cool→warm by displacement

### 5.4 Genre → Visual System (expanded from audio-visualization research)

| Genre | Motion | Palette | Light | Particle | Camera |
|-------|--------|---------|-------|----------|--------|
| **EDM** | Aggressive geometric, light trails | Luminous saturated, neon | Harsh + bloom | Dense, fast | Orbit/handheld fast |
| **Hip-Hop** | Character-led, graphic accents | Bold high-contrast | Hard spot + fill | Beat bursts | Static → quick cut |
| **Rock** | Texture, stage energy | Grain, distorted | Warm spot, haze | Debris, sparks | Fast cuts, handheld |
| **Indie** | Cinematic slow, landscapes | Soft film, AgX | Soft diffused | Sparse dust | Slow dolly |
| **Ambient** | Slow abstract, terrain drift | Muted gradual | Low ambient | Floating, long-loop | Locked |
| **Lo-Fi** | Gentle illustrated loops | Warm cozy | Warm high ambient | Soft motes | Recurring motif |
| **R&B** | Minimal polished | Elegant reflective | Reflective floor | Subtle motes | Smooth dolly-in |
| **Pop** | Performance + glossy color | Bold, chorus hue-shift | Chorus light change | Chorus burst | Chorus orbit |
| **Trap/Metal** | Shockwave + shear | Dark → flash on drop | Flash on transient | Spherical shockwave | Shake on kick |

---

## 6. Blender 5.2 LTS — EEVEE Next Deep Dive

### 6.1 What Changed (from [developer.blender.org 5.2](https://developer.blender.org/docs/release_notes/5.2/eevee/))

- **Screen-space raytracing cleanup** — energy-conserving, better precision at minimum thickness; fix for 1-frame lag in reflections
- **Backface option** in Screen Tracing — reduces light leaking for GI (affects SS GI + Fast GI)
- **Fast GI fixes** — removed `Far Thickness` (caused halos), optimized for `precision <1` (faster + less noise), fixed AO light leakage & pixelation
- **Reflection denoiser** — preserves contact sharpness
- **Raycast Node** — better intersection, no false positives toward camera
- **Instancing perf** — **2x faster** for CPU-bottlenecked instancing-heavy scenes (Workbench/Overlay optimizations → EEVEE, Vulkan + OpenGL)
- **VRAM**: 1.5/2 GB shadow options, ~slightly less VRAM overall

### 6.2 Hybrid Workflow (2026 consensus)

```
Lookdev/Blocking → EEVEE Next (per-BSDF raytracing ON) → real-time feedback
Final frames     → Cycles (path-traced, OptiX denoise) → ground truth
Comp             → AOVs + bloom/DoF in compositor (often faster than in-render)
```

| Criterion | EEVEE Next | Cycles |
|-----------|------------|--------|
| Speed | Seconds/frame | Minutes/frame |
| Light | Approximate, per-BSDF raytrace | Physically correct GI |
| Caustics | Screen-space only | True focused light (glass/water) |
| Volumetrics | Fast, some trade-offs | Accurate scattering |
| Shadows | Ray-traced soft, excellent | Most accurate, fine contact |
| Reflections | Ray-traced + screen fallback | True all angles |
| VRAM | Moderate, mid-range friendly | High, scales with GPU |

> [!tip] EEVEE sweet spot: no glass/caustics/off-screen mirrors/extreme DoF → EEVEE *is* the final engine, not just previz.

### 6.3 Shader Performance in EEVEE

From Blender Artists 2026 profiling:

- **Heaviest nodes**: `Shader to RGB` (renders whole shading again) → avoid in NPR; skip while tweaking
- **Texture sampling** — not ALU-heavy but stalls waiting for VRAM cache (hundreds of cycles); reduce texture res for imported assets
- **Procedural noise**: `Detail` 0=~50 instr → 8+=~500 instr; 4K + 64 samples = ~1.28ms extra per frame. Use 2D noise when possible, lower octaves
- **Mix closures**: one Principled BSDF beats multiple mixed Principleds — compiler can't optimize separate closures
- **Switch nodes**: constant index = zero cost (preprocessed away); varying index = math+mix replacement

---

## 7. Volumetrics, Fog & Depth

- **Gaussian Splatting (3DGS)**: point-cloud + splat rendering native in Three.js (`@mkkellogg/gaussian-splats-3d`) and Blender — use for photoreal scans, not manual modeling
- **EEVEE volumetrics**: light probes + volumetrics improved in 5.2; still approximate vs Cycles null-scattering (Blender 5.0) for smoke/fog
- **WebGPU volumetric mode** (Fosfora): any particle effect → ray-marched fog toggle — same simulation, smoke vs points
- **Depth tricks**: reversed depth buffer (0–1 in WebGPU, native) for >100k:1 scale; camera-relative rendering + floating origin for space sims

---

## 8. Performance Targets & Budgeting

| Metric | Target | How |
|--------|--------|-----|
| **Draw calls** | <100/frame | `InstancedMesh` early, group hierarchy, merge by distance |
| **FPS** | 60 locked | <16ms frame budget; profile with `renderer.info`, `stats-gl`, Spector.js |
| **Particles** | budget by tier (see §4.2) | compute shaders for >50k |
| **Textures** | Draco + KTX2 via `gltf-transform` | negotiated transcode after `renderer.init()` |
| **Memory** | traversal dispose on removal | `geometry.dispose()` + `material.dispose()` per mesh |
| **Resize** | observer + DPR cap (1.5–2.0) | render-on-demand for static scenes |

```ts
// Dispose pattern (WebGPURenderer)
object.traverse((child) => {
  if (child instanceof THREE.Mesh) {
    child.geometry.dispose();
    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
    else child.material.dispose();
  }
});
```

---

## 9. Open-Source Effect Engines (Recyclable — MIT)

| Engine | Stack | Hook | Why Look |
|--------|-------|------|----------|
| **[phase-viz](https://github.com/7g3n/phase-viz)** | React+TS+Three.js, Zustand, WebCodecs MP4 export | 3D/particle/waveform/image FX, layer order | Full editor → deterministic export; educational starter at [web-audio-threejs-starter](https://github.com/7g3n/web-audio-threejs-starter) |
| **[Bytewave-coder/music-visualizer](https://github.com/Bytewave-coder/music-visualizer)** | Next 14 + R3F + Zustand + postprocessing | 10 modes (galaxy/blackHole/neonTunnel…) | Clean mode architecture, Zustand viz store |
| **[LYRA](https://github.com/ShrezesUverse/LYRA-Music-Visualizer)** | Electron + three r184 WebGPU+TSL, AudioWorklet spectral flux | 1M GPU particles, system-audio loopback, album-color recolor | Tiered quality (250/500/1000k), OBS transparent source |
| **[Fosfora/Phosphor](https://github.com/kevinraymond/fosfora)** | Rust+wgpu (Vulkan/Metal), WGSL, NDI | 42 effects, 8-layer blend, 74 audio features | Most complete VJ engine; edit WGSL live, hot-reload |
| **[Sythm](https://github.com/5ymph0en1x/Sythm)** | Python+CUDA+moderngl, CuPy zero-copy | ABC+Lorenz field, shockwaves, stereoscopic 3D | Research-grade audio features, VRAM-capped particles |
| **[Dalia](https://github.com/TheAdkk/dalia)** | Rust/WASM + Three.js | 20 procedural presets, chromagram harmony, mashup | WASM audio → Three.js, beat-locked morph |
| **[Prism](https://github.com/Tensor-Doc/prism)** | WebGL2 + butterchurn/Milkdrop + particle atlas | Stream-graph JSON, curl-noise flow | Prompt → graph via Gemini, 65k instanced sprites |

---

## 10. Three-JS Studio Implementation Checklist

For `packages/frontend` / `three-js-studio` in this repo:

- [ ] Migrate `three` imports → `three/webgpu`, add async `gl` factory to `<Canvas>`
- [ ] Port any `ShaderMaterial` → TSL `Fn()` nodes
- [ ] Replace `EffectComposer` → `RenderPipeline` (`bloom`, `ssao`, `dof`)
- [ ] Convert particle system to `StorageBufferAttribute` + compute shader (keep fallback for WebGL2)
- [ ] Use instanced quads (not `Points`) for embers/plankton — radial sprite
- [ ] Wire `KTX2Loader.detectSupport` after `renderer.init()`
- [ ] Keep audio updates outside React state (`useFrame` + refs, reuse `Float32Array`)
- [ ] Add predictive beat hook (adaptive oscillator) alongside bass-spike detector
- [ ] Implement per-drum shockwave mode (kick/slow thick, snare/fast shear, hat/flash)
- [ ] Add genre-aware presets (EDM neon, Lo-Fi warm, R&B reflective)
- [ ] Profile: `renderer.info` draw calls <100, 60fps, dispose traversal

---

## References

- [Three.js WebGPURenderer manual](https://threejs.org/manual/en/webgpurenderer.html)
- [Field Guide to TSL and WebGPU — Maxime Heckel](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)
- [Makio64 — Advanced TSL & WebGPU Optimization](https://github.com/Makio64/advanced-threejs-tsl-webgpu-rendering)
- [100k Particles in 2ms — WebGPU + TSL benchmark](https://devcheolu.com/en/posts/nB4Goj6nteClAWsInhtX)
- [Three.js Roadmap — WebGL vs WebGPU Explained](https://threejsroadmap.com/blog/webgl-vs-webgpu-explained)
- [100 Three.js Tips (2026) — Utsubo](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- [Garden Anomaly — Tiny WebGPU+TSL Experiment (Codrops)](https://tympanus.net/codrops/2026/08/06/garden-anomaly-a-tiny-webgpu-and-tsl-experiment/)
- [Exploring Procedural Geometry with Three.js + WebGPU (Codrops)](https://tympanus.net/codrops/2026/08/11/exploring-procedural-geometry-with-three-js-and-webgpu/)
- [Blender 5.2 EEVEE & Viewport Release Notes](https://developer.blender.org/docs/release_notes/5.2/eevee/)
- [Blender 5.1/5.0 EEVEE Notes](https://developer.blender.org/docs/release_notes/5.1/eevee/)
- [Cycles vs EEVEE in Blender 5.2 (Blender Deluxe)](https://blenderdeluxe.com/en/3d-design/cycles-vs-eevee-in-blender-52-when-to-use-each-render-engine-1059)
- [Blender Render Settings Guide 2026 (SuperRendersFarm)](https://superrendersfarm.com/article/blender-render-settings-optimization-guide)
- [Eevee vs Cycles on Cloud Farm 2026](https://superrendersfarm.com/article/eevee-vs-cycles-cloud-render-farm-comparison-2026)
- [Optimizing nodes for EEVEE — Blender Artists](https://blenderartists.org/t/optimizing-nodes-for-eevee-performance/1649795)
- [Blender EEVEE 2x Perf — Phoronix](https://www.phoronix.com/news/Blender-EEVEE-2x-Perf)
- [phase-viz / web-audio-threejs-starter](https://github.com/7g3n/phase-viz)
- [Fosfora / Phosphor — 42-effect VJ engine](https://github.com/kevinraymond/fosfora)
- [Sythm — Lorenz+ABC flow visualizer](https://github.com/5ymph0en1x/Sythm)
- [Dalia — Rust/WASM visualizer](https://github.com/TheAdkk/dalia)
- [Bytewave music-visualizer](https://github.com/Bytewave-coder/music-visualizer)
- [LYRA Music Visualizer (1M particles)](https://github.com/ShrezesUverse/LYRA-Music-Visualizer)
- [Prism particle backend](https://github.com/Tensor-Doc/prism)
- [Audio-Reactive 3D Visualizer — three.js forum](https://discourse.threejs.org/t/audio-reactive-3d-visualizer-three-js-web-audio-api-with-in-browser-mp4-export/92234)

---

*Last updated: 2026-08-29 — WebGPU Baseline, TSL compute, Blender 5.2 LTS, 8 open-source engines*

