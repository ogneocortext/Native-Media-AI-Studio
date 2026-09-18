---
tags:
  - 3d-visualization
  - react-three-fiber
  - three-js
  - webgpu
  - best-practices
  - performance
  - accessibility
aliases:
  - 3D Visualization Best Practices 2026
  - R3F Audio-Reactive Guide
date: 2026-09-16
---

# 🎛️ 3D Visualization Best Practices (September 2026)

> [!info] Purpose
> Audit of **every** 3D visualization in Native Media AI Studio + web-researched
> professional best practices (September 2026) + what was implemented.
> For the scene-builder side see [[three-js-studio]]; for shaders/particles/post
> see [[visualization-effects]]; for audio→visual mapping see [[audio-reactive-production]].

---

## 1. Inventory — what was audited

### 1a. `VisualizerScene` styles (`packages/frontend/src/features/visualizer/viz-styles/`)

| # | Component(s) | File | Technique |
|---|--------------|------|-----------|
| 1 | `GeometricViz`, `AudioReactiveCore` | `geometric.tsx` | Icosahedron core + wire + shockwave ring + 600-pt orbital `THREE.Points` + `InstancedParticles` |
| 2 | `OrbitalParticles`, `EnergyWaves` | `cosmic.tsx` | Streak-velocity point sprites (`makeStreakMaterial`), galaxy dust |
| 3 | `FrequencyRings` | `neural.tsx` | Concentric FFT rings ("neural") |
| 4 | `PulseRings`, `SpectrumBars` | `pulse.tsx` | Beat-pulse rings + FFT bar field |
| 5 | `VinylDisc` | `synthwave.tsx` | Spinning vinyl + label + tonearm meshes |
| 6 | `AuroraRibbon` | `aurora.tsx` | GPU simplex-noise terrain ribbon (`makeTerrainMaterial`) |
| 7 | `OceanWaves` | `ocean.tsx` | GPU noise-displaced ocean plane + fresnel rim |
| 8 | `FractalViz` | `fractal.tsx` | Iterative fractal mesh field |
| 9 | `StormViz` | `storm.tsx` | Turbulent particle storm |
| 10 | `InfernoViz` | `inferno.tsx` | Rising fire/ember streak particles |
| 11 | `ThreeParticlesDemo` | `three-particles.tsx` | `@newkrok/three-particles` integration demo |
| 12 | `InstancedParticles` | `instancedParticles.tsx` | Instanced billboard quads (the perf reference impl) |
| 13 | Shared infra | `../VisualizationFX.tsx` | EffectComposer (bloom + grade + OutputPass), terrain/streak materials in GLSL **and** TSL, `../VisualizerScene.tsx` lighting rig (IBL `Environment` + Lightformers, physical `decay={2}` lights) |

Plus: `ShaderVisualizer` (fullscreen GLSL modes), `Canvas2DVisualizer` (7 modes, DPR-capped),
`webgpu/WebGPUPostFX.tsx` (TSL post chain) + `WebGPURendererDetector.ts` (WebGPU→WebGL2 fallback).

### 1b. Three.js Studio templates (`three-js-studio/sceneTemplates.ts`)

| Template | Objects | Audio hook |
|----------|---------|-----------|
| Concert Stage | floor + hero crown + 3 orbital spotlights | beat punch |
| Cosmic Void | planet + torus ring, 400 dust pts | — |
| Equalizer Wall | **32 individual `bars` meshes** | `audioDriven: "bars"` (per-frame FFT scale) |
| Geometric City | **~24 individual pillar meshes** + hero cone (`Math.random()` heights) | `audioDriven: "pillars"` |
| Vinyl Spin | turntable + vinyl + label + tonearm | — |
| Pulse Orb | single sphere, strong beat punch | `beatPunch: 0.35` |
| Character Stage | stage + GLB `character` + 3-light rig + halo | beat-synced |

### 1c. Global pipeline (`Visualizer.tsx` + `VisualizerScene.tsx`)

- Single always-mounted `<Canvas>` (`camera [0,0,7] fov 55`, `dpr [1,1.5]`, `frameloop="always"`).
- `onCreated`: ACESFilmic + exposure 1.05 on WebGL; WebGPU via `createWebGPURenderer`.
- `LrcVizController` wraps every style (section color/intensity, phrase pulse).
- 13 genre presets in `visualPresets.ts` (`bloom ≤ 1.0`, `glitch ≤ 0.7` on dubstep/trapMetal/phonk). Each preset now carries a `description` string that is surfaced in the UI: the auto-apply toast reads `Applied "<name>" preset — <description>` and the active preset badge tooltip shows both name and description.

---

## 2. Findings → professional best practices (Sept 2026, web-verified)

### P1. Never do per-frame work outside `useFrame` mutation — and never `console.log` in it
- **Source:** R3F docs — [Performance pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls) ("don't setState in loops, mutate inside useFrame"), [Scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance).
- **Finding:** `geometric.tsx` logged to console on its first `useFrame` — dev-only code shipping per-frame overhead and console spam.
- **Rule:** no `console.*`, no `setState`, no allocations inside `useFrame`. Mutate refs; use `delta` for frame-rate independence.

### P2. Always use `delta` — frame-rate-independent motion
- **Source:** R3F pitfalls ("you need frame deltas… your project will run at different speeds").
- **Finding:** rotation advanced by a fixed `0.003` per frame → 120 Hz screens animate 2× faster than 60 Hz.
- **Rule:** `useFrame((state, delta) => { rot += speed * delta })`. Normalize with `delta * 60` when converting legacy per-frame constants.

### P3. Cap DPR, adapt to real fps (`PerformanceMonitor`, not fixed DPR)
- **Source:** drei [PerformanceMonitor](https://drei.docs.pmnd.rs/performances/performance-monitor) + [AdaptiveDpr](https://drei.docs.pmnd.rs/performances/adaptive-dpr); R3F scaling-performance.
- **Finding:** fixed `dpr={[1, 1.5]}` never degrades on weak GPUs; no fps feedback loop.
- **Rule:** base `dpr [1, 1.5]` (already correct — full 2× DPR on bloom-heavy scenes is a known perf cliff) + `PerformanceMonitor` stepping down to `[1, 1]` on decline, restoring on incline. `Canvas2DVisualizer`/`ShaderCanvas` already cap at 2 — keep.

### P4. Photosensitivity is a hard constraint (WCAG 2.3.1), not a nice-to-have
- **Source:** [WCAG 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html), [MDN seizure disorders](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Seizure_disorders): no >3 flashes/sec over a large bright area; saturated-red flashing is the most provocative (our phonk/trapMetal palettes are red-dominant with glitch ≤ 0.7).
- **Finding:** `prefersReducedMotion` dimmed motion but the post chain (`PostFX`) never received it — bloom still punched `+0.35` on every beat and `+0.25` on every lyric phrase at full rate.
- **Rule:** pipe the safe-mode flag into the post chain; in safe mode halve beat/phrase gain, cap bloom, force glitch/chromatic-aberration to ~0. Already-wired `prefersReducedMotion` prop is the carrier — extend it, don't invent a second flag.

### P5. Dispose what you allocate; share what you repeat
- **Source:** R3F pitfalls ("creating objects can be expensive… share materials/geometries; don't mount indiscriminately"), three.js discourse (watch draw calls/geometries, instance repeats).
- **Finding:** `orbitGeom` in `geometric.tsx` allocated a `BufferGeometry` with no cleanup on unmount; style switches mount/unmount whole scenes.
- **Rule:** every `useMemo`'d geometry/material gets a `useEffect` dispose cleanup; share textures via `getParticleTex()` (already done — keep).

### P6. Repeat meshes → `InstancedMesh` (draw-call budget)
- **Source:** R3F scaling-performance ("no more than ~1000 draw calls, optimally a few hundred; win it back with instancing"), drei `Instances`/`Merged`/`Detailed`.
- **Finding:** Equalizer Wall (32 meshes) and Geometric City (~25 pillars) are one draw call *each*. Fine today, but the pattern doesn't scale to 128-bar FFT walls.
- **Rule:** new multi-repeat work uses `instancedMesh` (see `instancedParticles.tsx`, the in-repo reference). Existing templates documented as instancing candidates — not refactored yet (deliberate: larger change, see §4).

### P7. Deterministic templates — no `Math.random()` in scene definitions
- **Source:** professional reproducibility norm (same input → same render; required for MP4 export determinism and visual regression tests).
- **Finding:** `Geometric City` rolled pillar heights with `Math.random()` at template-application time — every load differs, unreproducible exports.
- **Rule:** hash-based deterministic pseudo-random (`fract(sin(i)·43758)`) for authored randomness; live randomness stays in the animation loop only.

### P8. Color pipeline: ACES + sRGB output via `OutputPass`, exposure ~1.0
- **Source:** [three.js color management](https://threejs.org/manual/en/color-management.html) (Linear-sRGB working space, `OutputPass` required with post-processing), ACES tone-mapping docs.
- **Finding:** already correct (`ACESFilmic`, exposure 1.05, `OutputPass` terminal). Keep; don't "fix" what matches the platform guidance.

### P9. TSL is the forward path for WebGPU, GLSL stays for WebGL2
- **Source:** [TSL Guide](https://threejs.org/tsl/) (TSL transpiles to WGSL *and* GLSL; `WebGPURenderer` falls back to WebGL2), [WebGPU+three migration guide 2026](https://www.utsubo.com/blog/webgpu-threejs-migration-guide).
- **Finding:** codebase already mirrors materials (GLSL ↔ TSL) with runtime `isWebGPURenderer` branching. Correct — keep both, don't consolidate prematurely.

### P10. Keep audio analysis out of React renders
- **Source:** community-proven architecture (phase-viz / web-audio-threejs-starter, June 2026): FFT in refs/worker, throttled state mirrors (~10 Hz) for UI only.
- **Finding:** already correct (`audioData` refs + `AudioAnalysisWorker` + 100 ms UI throttle + 80 ms beat latch). Keep.

---

## 3. Implemented (2026-09-16)

| # | Change | File |
|---|--------|------|
| 1 | Removed per-frame `console.log` from `useFrame` | `viz-styles/geometric.tsx` |
| 2 | Frame-rate-independent rotation (`delta * 60` normalized) | `viz-styles/geometric.tsx` |
| 3 | `BufferGeometry` dispose cleanup on unmount | `viz-styles/geometric.tsx` |
| 4 | Adaptive DPR via drei `PerformanceMonitor` (decline → `[1,1]`, recover → `[1,1.5]`, fallback → `[1,1]`) | `Visualizer.tsx` |
| 5 | `prefersReducedMotion` piped into post chain; safe mode halves beat/phrase bloom gain, caps bloom at 0.55, damps vignette pulse | `VisualizerScene.tsx`, `VisualizationFX.tsx` |
| 6 | Deterministic pillar heights (hash of index, no `Math.random()`) | `three-js-studio/sceneTemplates.ts` |

---

## 4. Deliberately deferred (documented, not forgotten)

1. **Instancing the Equalizer/City templates** — needs `instancedMesh` + per-instance FFT attribute plumbing; bigger than a safe single-pass change. Pattern reference: `viz-styles/instancedParticles.tsx`.
2. **Selective bloom / MRT masking** — emissive-only bloom would fix UI-text washout; depends on TSL `mrtNode` chains (see three.js WebGPU post-processing discourse). Evaluate after WebGPU path is default.
3. **Per-preset photosensitivity audit** — glitch-heavy presets (dubstep/trapMetal/phonk) need PEAT-tool verification + a user-facing "flash intensity" slider. Safe-mode plumbing in this pass is the precondition.
4. **Shadow strategy** — shadows stay off on the main Canvas (correct for perf); `BakeShadows` if static shadow-casting scenes ever land.

---

## Sources

- R3F Performance pitfalls — https://r3f.docs.pmnd.rs/advanced/pitfalls
- R3F Scaling performance — https://r3f.docs.pmnd.rs/advanced/scaling-performance
- drei PerformanceMonitor — https://drei.docs.pmnd.rs/performances/performance-monitor
- drei AdaptiveDpr — https://drei.docs.pmnd.rs/performances/adaptive-dpr
- TSL Guide (r186) — https://threejs.org/tsl/
- three.js Color Management — https://threejs.org/manual/en/color-management.html
- three.js WebGPU post-processing discourse — https://discourse.threejs.org/t/three-js-webgpu-post-processing-effects/87390
- phase-viz audio-reactive architecture (June 2026) — https://discourse.threejs.org/t/audio-reactive-3d-visualizer-three-js-web-audio-api-with-in-browser-mp4-export/92234
- WCAG 2.3.1 Three Flashes — https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- MDN seizure accessibility — https://developer.mozilla.org/en-US/docs/Web/Accessibility/Seizure_disorders
