# Audio Visualization Techniques & Best Practices (2026)

> Research compiled: 2026-08-29
> Sources: Three.js community, academic papers, open-source projects, industry guides

## Core Audio Analysis Pipeline

### Frequency Band Separation
The standard approach uses FFT → frequency bands → visual mapping:
- **Bass**: 20-250Hz → scale, expansion, heavy motion
- **Mid**: 250-4000Hz → deformation, color shifts, primary motion
- **Treble**: 4000-20000Hz → particles, sparkle, fine detail

**Critical**: Calculate bin indices from actual sample rate, not fixed percentages:
```
binSize = sampleRate / (binCount * 2)
bassBins = floor(250 / binSize)
midBins = floor(4000 / binSize)
```

### Beat Detection
Two approaches, often combined:
1. **Runtime**: Bass spike detection with cooldown (simple, works without pre-analysis)
2. **Pre-analyzed**: Beat times from librosa/CUDA analysis (frame-accurate, enables look-ahead)

### Smoothing
Always smooth audio values to prevent jitter:
- `smoothingTimeConstant = 0.8` on AnalyserNode
- Exponential moving average in animation loop
- Lerp between current and target values

## Visual Mapping Strategies

### The "Vortex" Pattern (from vortex-av-engine)
- Bass expands an inner core
- Midrange deforms a wireframe polyhedron
- High-frequency transients disperse a surrounding particle field

### The "Phase-Viz" Pattern (from phase-viz, MIT license)
- Multiple visual layers with adjustable order
- Particle systems driven by frequency data
- Mesh deformation based on amplitude
- Waveform and image FX modes

### Vertex Displacement Pattern (from Audio-visualizer-3d)
- Each vertex mapped to a frequency bin
- Displacement intensity = frequency amplitude
- Color shifts cool→warm based on displacement

## Genre-to-Visual Mapping

| Genre | Motion | Color | Pacing | Best Techniques |
|-------|--------|-------|--------|-----------------|
| EDM/Electronic | Aggressive, geometric | Luminous, saturated | Fast, frequent pulses | Particles, light trails, pulsing |
| Hip-Hop | Character-led, graphic | Bold, high-contrast | Beat-synced accents | Central performer, quick visuals |
| Rock | Texture, live-energy | Grain, distorted | Fast cuts, high contrast | Stage lighting, distorted textures |
| Indie | Cinematic, slow | Soft, film-inspired | Gradual changes | Camera movement, landscapes |
| Ambient | Slow, abstract | Muted, gradual | Long loops, low frequency | Floating particles, terrain |
| Lo-Fi | Gentle, illustrated | Warm, cozy | Recurring motifs | Animated illustration, soft loops |
| R&B | Minimal, polished | Elegant, reflective | Slow, smooth | Light movement, close-ups |
| Pop | Performance + color | Bold, glossy | Chorus-driven shifts | Color changes at sections |

## Mood-to-Color Mapping (from academic research)

Research shows mood and timbre can drive visual signatures:
- **Euphoric**: Expanding light, saturated colors, upward camera
- **Dark**: Restrained lighting, shadows, metallic/urban textures
- **Dreamy**: Floating motion, soft transitions, haze
- **Aggressive**: Sharp cuts, distorted textures, rapid camera
- **Intimate**: Close framing, subtle motion, warm environments

## Open Source Projects (MIT License — Code Recyclable)

### phase-viz (github.com/7g3n/phase-viz)
- React + TypeScript + Vite + Three.js
- Multiple 3D, particle, waveform, image FX modes
- Adjustable particle count, size, shape, camera distance
- Browser-based MP4 export
- Zustand for state management

### web-audio-threejs-starter (github.com/7g3n/web-audio-threejs-starter)
- Minimal R3F starter for audio-reactive visuals
- Loads local audio, analyzes volume/bass/mids/highs
- Maps signals to Three.js mesh
- Drives particle system in real-time
- Keeps high-frequency audio updates outside React rerenders

### vortex-av-engine (github.com/zazieproductions/vortex-av-engine)
- Frequency bands reshape procedural WebGL scene
- Bass → inner core expansion
- Midrange → wireframe polyhedron deformation
- High-frequency → particle field dispersion

### Audio-visualizer-3d (github.com/Shadowwyyy/Audio-visualizer-3d)
- 20 different 3D shapes
- Real-time vertex displacement based on frequency
- Color shifts cool→warm based on displacement intensity
- Smoothing applied to prevent jitter

### Three-JS-Music-Visualiser (github.com/jhancock532/Three-JS-Music-Visualiser)
- Circle segments mapped to frequency bins
- HSL color mapping across spectrum
- dat.GUI for parameter tweaking

## Performance Best Practices

1. **Keep audio updates outside React state** — Use refs and `useFrame`, not `useState`
2. **BufferGeometry over Geometry** — BufferGeometry is the only geometry type since r171
3. **InstancedMesh** — For repeated elements (particles, bars)
4. **Smoothing at multiple levels** — AnalyserNode + animation loop lerp
5. **Avoid per-frame allocations** — Reuse Float32Arrays, don't create new objects in useFrame
6. **Draw call budget** — Target <100 draw calls for 60fps

## UX Best Practices

1. **Match visual pacing to musical pacing** — Dense tracks support frequent pulses; slow tracks need gradual changes
2. **Section-aware changes** — Save transformations for chorus, drop, instrumental break
3. **Genre-appropriate color system** — Electronic = luminous/saturated; Lo-fi = warm/soft
4. **Beat-synced effects** — Use pre-analyzed beat times for frame-accurate synchronization
5. **Demo mode** — Synthetic animation when no track is playing (so the scene isn't dead)
6. **Reduce motion option** — Disable flashing/rapid movement for accessibility

## Key Technical Details

### AnalyserNode Settings
```ts
analyser.fftSize = 2048;              // Good balance of resolution/performance
analyser.smoothingTimeConstant = 0.8; // Smooth, stable values
```

### Frequency Data Access
```ts
analyser.getByteFrequencyData(uint8Array); // 0-255 range
analyser.getByteTimeDomainData(uint8Array); // Waveform data
```

### Smoothing in Animation Loop
```ts
// Exponential moving average
smoothed += (raw - smoothed) * smoothFactor;
// Lerp toward target
current += (target - current) * lerpSpeed;
```

## References
- [phase-viz GitHub](https://github.com/7g3n/phase-viz)
- [web-audio-threejs-starter GitHub](https://github.com/7g3n/web-audio-threejs-starter)
- [vortex-av-engine GitHub](https://github.com/zazieproductions/vortex-av-engine)
- [Audio-visualizer-3d GitHub](https://github.com/Shadowwyyy/Audio-visualizer-3d)
- [Three-JS-Music-Visualiser GitHub](https://github.com/jhancock532/Three-JS-Music-Visualiser)
- [Visual signatures for music mood and timbre](https://link.springer.com/article/10.1007/s00371-024-03417-z)
- [Coding a 3D Audio Visualizer — Codrops](https://tympanus.net/codrops/2025/06/18/coding-a-3d-audio-visualizer-with-three-js-gsap-web-audio-api/)
- [8 Music Visualizer Ideas by Genre](https://freebeat.ai/articles/8-music-visualizer-ideas-for-different-music-genres)
- [The Ultimate Guide to 3D Music Visualizers](https://beatsee.app/blog/3d-music-visualizer-guide)
- [Three.js WebGPU Compute Audio](https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_compute_audio.html)
- [WebCodecs + mp4-muxer export pattern](https://github.com/Vanilagy/mp4-muxer)

---

## Appendix: TSL (Three Shading Language) — Comprehensive Reference (2026)

> **Status (Sep 2026):** TSL is the recommended shader-authoring path for new Three.js work. r182+ promotes `WebGPURenderer`; r184 improves TSL compilation performance 3× and adds `OnFrameUpdate` / `OnBeforeFrameUpdate`. Browser WebGPU coverage is ~95% evergreen.

### What TSL Is

TSL (Three Shading Language) is a JavaScript/TypeScript node graph for authoring shaders. You compose operations like `positionLocal`, `time`, `sin`, `mix`, `texture` as JS function calls; Three.js compiles the graph to WGSL for WebGPU or GLSL for WebGL2. One graph, both backends.

```ts
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { positionLocal, normalLocal, uniform, time, sin, length, vec3 } from 'three/tsl';

const uAmp  = uniform(0.25);
const uFreq = uniform(6.0);

const mat = new MeshStandardNodeMaterial({ color: '#38bdf8', roughness: 0.3 });

// Procedural vertex displacement
mat.positionNode = positionLocal.add(
  normalLocal.mul(
    sin(length(positionLocal.xy).mul(uFreq).sub(time.mul(3.0))).mul(uAmp).mul(0.1)
  )
);

// Procedural fragment color
mat.colorNode = vec3(
  0.5,
  sin(positionLocal.y.mul(8.0).add(time.mul(2.0))).mul(0.5).add(0.5),
  0.8
);
```

### Why TSL Over Raw GLSL/WGSL

| Concern | GLSL/WGSL | TSL |
|---------|-----------|-----|
| Dual-maintenance | Yes — two shader sources | No — one graph |
| IDE support | Limited | Full TS autocomplete + type checking |
| Reuse | String `#include` hacks | Ordinary TS functions / modules |
| Debugging | Generated GLSL stack traces | JS stack traces referencing TSL nodes |
| Optimization | Manual | Automatic dead-code elimination + tree-shaking |
| Renderer portability | Backend-specific | Single source for WebGL + WebGPU |

### When to Use TSL vs GLSL vs NodeMaterial

- **TSL**: new shaders, audio-reactive materials, compute-shader pipelines, anything that should run on both WebGL and WebGPU.
- **GLSL / `ShaderMaterial`**: only when you must target WebGL-only without the TSL layer, or need exact low-level control that TSL doesn't expose yet.
- **NodeMaterial built-ins** (`MeshStandardNodeMaterial`, etc.): when you want full PBR + selective node slots without a full custom material.

### NodeMaterial Slots for Audio-Reactive Visuals

Every `*NodeMaterial` exposes node slots that accept TSL graphs:

| Slot | Purpose | Typical Audio Mapping |
|------|---------|----------------------|
| `colorNode` | Base color / emissive | Bass → brightness; mids → hue shift |
| `positionNode` | Vertex position | Beat → radial burst; waveform → displacement |
| `normalNode` | Surface normals | Fresnel / rim glow driven by amplitude |
| `roughnessNode` | PBR roughness | Treble → micro-roughness / sparkle |
| `metalnessNode` | Metallic property | Mids → metallic flash |
| `opacityNode` | Alpha | Beat-synced flash / transparency pulse |
| `emissiveNode` | Self-illumination | Kick → emissive spike |
| `scaleNode` | Sprite/particle scale | Overall energy → particle size |
| `fragmentNode` | Full fragment override | Full-screen post-effect style material |
| `vertexNode` | Full vertex override | Custom vertex animation |
| `geometryNode` | Geometry-level hook | Procedural geometry mutation |

### Audio-Reactive TSL Patterns

#### 1. CPU-Driven Uniform Updates (Proven, Broadly Compatible)

```ts
import { uniform, time, sin, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

const bass = uniform(0);   // updated from AnalyserNode in rAF
const mids = uniform(0);
const treble = uniform(0);
const energy = uniform(0);

const mat = new MeshStandardNodeMaterial();
mat.colorNode = vec3(
  bass.mul(0.4).add(0.1),
  mids.mul(0.3).add(0.2),
  treble.mul(0.5).add(0.3)
);
mat.roughnessNode = bass.mul(0.5).add(0.1); // bass hit = shiny
mat.emissiveNode = vec3(energy.mul(2.0)); // energy spike = glow

// In rAF:
bass.value   = getSmoothedBand('bass');
mids.value   = getSmoothedBand('mids');
treble.value = getSmoothedBand('treble');
energy.value = getSmoothedBand('energy');
```

**Use this pattern when**: WebGL fallback is required, audio analysis already happens on CPU, or the material logic is simple.

#### 2. GPU Compute Shader Audio Pre-Processing (WebGPU Only)

Move heavy DSP off the CPU with `compute()`:

```ts
import { Fn, uniform, storage, instanceIndex, float, texture, screenUV, color } from 'three/tsl';

// 1024-band FFT result living on GPU
const fftBuffer = new Float32Array(1024);
const fftGPU = new THREE.StorageInstancedBufferAttribute(fftBuffer, 1);
const fftStorage = storage(fftGPU, 'float', 1024);

const bandEnergy = uniform(new Float32Array(4)); // bass, mids, treble, energy

const computeBands = Fn(() => {
  const idx = float(instanceIndex);
  const sample = fftStorage.element(idx);

  // Accumulate band energy on GPU
  // (exact bin ranges depend on sample rate / FFT size)
  bandEnergy.element(0).addAssign(sample); // bass accumulate
  // ... per-band dispatch logic
});

const computeNode = computeBands().compute(1024);

// In render loop:
await renderer.computeAsync(computeNode);
const bandResult = new Float32Array(await renderer.getArrayBufferAsync(bandEnergy.buffer));
```

**Use this pattern when**: FFT size is large (>4096), multiple passes are needed (e.g. onset detection, spectral flux), or the CPU thread must stay free for React/Remotion compositing.

#### 3. Material-Integrated Compute (r184+, Automatic Dispatch)

Three.js r184+ supports `.compute()` directly on material node graphs. The compute runs only when the material is rendered, and respects frustum culling automatically.

```ts
const positions = instancedArray(particleCount, 'vec3');

const material = new THREE.PointsNodeMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

material.positionNode = Fn(() => {
  const pos = positions.element(instanceIndex);
  pos.y.addAssign(sin(time.add(pos.x)).mul(0.1)); // audio-driven displacement
  return positions.toAttribute();
})().compute(particleCount);

const points = new THREE.Points(geometry, material);
points.count = particleCount;
scene.add(points);
```

This pattern pairs naturally with `AnalyserNode` frequency data uploaded as a `DataTexture` or uniforms — the compute runs on GPU, the CPU only pushes a small uniform/texture each frame.

#### 4. Audio Texture → Full-Screen Shader (Background / Post-FX)

```ts
import { texture, screenUV, color } from 'three/tsl';

const analyserTexture = new THREE.DataTexture(analyserBuffer, analyserBuffer.length, 1, THREE.RedFormat);
const spectrum = texture(analyserTexture, screenUV.x).x.mul(screenUV.y);
scene.backgroundNode = color(0x0000FF).mul(spectrum);
```

See the official `webgpu_compute_audio.html` example for a working pitch-shift + delay compute graph that reads an audio buffer, processes it on GPU, and writes back to an `AudioBuffer`.

### Compute Shader Recipes for Visualizers

#### Particle Systems (1M+ particles)

- Use `instancedArray(count, 'vec3')` for position / velocity buffers.
- Use `SpriteNodeMaterial` or `PointsNodeMaterial` with `positionNode = buffer.toAttribute()`.
- Dispatch with `renderer.compute(updateFn().compute(count))` in `useFrame` or `setAnimationLoop`.
- Reference: `webgpu_compute_points.html` — 300k points animated with one compute pass and one draw call.

#### GPU Fluid / Dither / Post-Processing

- Allocate a `StorageTexture` and write per-pixel magnitudes from a compute shader.
- Feed the storage texture into a full-screen `fragmentNode` or post-processing pass.
- Reference: ASTRODITHER (Robert Borghesi, 2025) — fluid sim + dither + bloom in a single compute pass + fragment shader.

#### FFT / Audio Analysis on GPU
- Use `FFT2D` (in-review Three.js PR #34382, r184+) for 2D FFT pipelines.
- For 1D spectral analysis, write a custom compute that reads audio samples from a storage buffer and writes per-band energy into a uniform/storage output.

### TSL + React Three Fiber Integration (2026)

- R3F v9 accepts an async `gl` prop, so WebGPU init is straightforward.
- R3F v10 alpha is expected to improve TSL out-of-the-box support.
- Use `useFrame` to push uniforms (`bass.value = ...`).
- Use `useThree((state) => state.renderer)` to call `renderer.compute(computeNode)`.
- For async compute readbacks, prefer `await renderer.computeAsync(computeNode)`.

### Browser Support & Fallbacks

| Browser | WebGPU | TSL Native | Fallback Path |
|---------|--------|-----------|---------------|
| Chrome 113+ | ✅ | ✅ | — |
| Edge 113+ | ✅ | ✅ | — |
| Safari 26+ | ✅ | ✅ | — |
| Firefox 121+ | ✅ | ✅ | — |
| Firefox Android | WIP | WIP | WebGL2 via `WebGLNodesHandler` |
| Older browsers | ❌ | ❌ | WebGL2 + `WebGLNodesHandler` |

```ts
// Universal fallback pattern
import { WebGLNodesHandler } from 'three/addons/tsl/WebGLNodesHandler.js';

glRenderer.setNodesHandler(new WebGLNodesHandler());
const gpuRenderer = new WebGPURenderer({ canvas });
await gpuRenderer.init();
```

### Recommended TSL Learning Path

1. Learn the Three.js node material slots (`colorNode`, `positionNode`, etc.).
2. Compose simple node graphs with `uniform`, `time`, `sin`, `mix`, `vec3`.
3. Migrate one existing `onBeforeCompile` or `ShaderMaterial` to TSL.
4. Add one compute shader for particles or FFT.
5. Explore `Fn()` for reusable shader helpers.
6. Read the TSL spec: `threejs.org/docs/TSL.html`.

### References

- [TSL Specification (three.js docs)](https://threejs.org/docs/TSL.html)
- [Three.js Shading Language Wiki](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [Field Guide to TSL and WebGPU — Maxime Heckel](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)
- [Introduction to WebGPU Compute Shaders — Three.js Roadmap](https://threejsroadmap.com/blog/introduction-to-webgpu-compute-shaders)
- [Custom Shaders: GLSL + TSL — MasterAllArts](https://masterallarts.com/learn/threejs-from-zero/08-custom-shaders-glsl-tsl/)
- [Three.js r184 Release Notes](https://github.com/mrdoob/three.js/releases/tag/r184)
- [Three.js Complete Guide 2026 — OFlight](https://www.oflight.co.jp/en/columns/threejs-webgpu-tsl-r3f-2026)
- [Three.js Guide 2026 — LearnWithHasan](https://learnwithhasan.com/threejs-guide/)
- [Three.js Demos — Audio Particles](https://threejsdemos.com/demos/audio/particles)
- [Birds Music — TSL compute boids + Tone.js](https://sonicviz.com/project/birds-music-a-procedural-audio-visual-experience/)
- [ASTRODITHER — audio-reactive TSL experiment](https://astrodither.robertborghesi.is/)
- [DITHER-CORE — fluid + dither + TSL](https://github.com/Sunil56224972/DITHER-CORE)
- [vibeviz — Audio-Reactive 3D Scene Editor (TSL)](https://github.com/vibe-stack/vibeviz)
- [nibi — GPU particle MV engine (TSL compute)](https://github.com/monoton-music/nibi)
- [Poseidon — GPU FFT ocean (TSL compute)](https://github.com/SimonTingle/poseidon)
- [FFT2D PR #34382](https://github.com/mrdoob/three.js/pull/34382)
- [NodeMaterial `compute()` integrated PR #30768](https://github.com/mrdoob/three.js/pull/30768)
- [WebGPU + WebGL 2026 Complete Guide — Chaos and Order](https://www.youngju.dev/blog/culture/2026-05-16-webgpu-webgl-2026-three-js-r3f-babylon-playcanvas-tres-needle-engine-native-webgpu-wgsl-deep-dive.en)
- [3D Development for the Web in 2026 — Chaos and Order](https://www.youngju.dev/blog/culture/2026-05-14-3d-development-for-web-three-js-react-three-fiber-webgpu-gaussian-splatting-deep-dive-2026.en)

---

## Appendix: WebGPU / TSL Export Path (2026)

> **Status (Sep 2026):** WebGPU default-on across ~95% of evergreen browsers; Three.js r182+ ships `WebGPURenderer` and TSL (`Three.add` / `NodeMaterial`) unifies GLSL/WGSL.

### TSL Audio Uniform Pattern
```ts
import { uniform, uv, time, sin } from 'three/tsl';

const bass = uniform(0);
// Update from AnalyserNode in rAF
material.fragmentNode = bass.mul(0.5).add(sin(time));
```

### Compute-Shader Audio Pre-Processing
- Move heavy FFT / band-energy calc off the CPU thread into a `compute()` node.
- `renderer.compute(computeNode)` runs entirely on GPU; reads back only final band buffer.
- Benefit: main thread stays free for React/Remotion compositing.

### Material-Integrated Compute (r184+)
- `.compute()` on `positionNode`, `fragmentNode`, etc. runs automatically when material renders.
- Frustum-culling aware; no manual `renderer.compute()` bookkeeping required.

### MP4 Export via WebCodecs + mp4-muxer
- `VideoEncoder` (WebCodecs) → raw chunks → `mp4-muxer` `Muxer` → downloadable `.mp4`.
- Matches what `phase-viz` and production Three.js examples use for in-browser recording.
- Fallback: MediaRecorder → WebM for browsers without WebCodecs.
