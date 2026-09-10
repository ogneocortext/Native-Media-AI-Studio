---
tags:
  - visualization
  - vision-analysis
  - gemma4
  - visualizer
  - feedback
  - music-video
aliases:
  - Visualizer State Analysis
  - FX Visualizer Feedback
  - Visualization Improvement Report
cssclasses:
  - analysis
  - vision-feedback
date: 2026-09-10
---

# 🎬 Visualizer State Analysis — FX Visualizer Feedback

> [!info] Purpose
> Vision analysis results from capturing all FX visualizer states on `http://localhost:5173/visualizer`
> and analyzing them with Gemma4 (`gemma4:e2b-it-qat`) using existing knowledge library prompts.
>
> **Methodology:**
> 1. Disabled `characterVisible` by default in `Visualizer.tsx`
> 2. Captured screenshots of all 9 visualizer states (2D × 7 modes + 3D + FX/Shader)
> 3. Analyzed each frame with section-specific prompts from `visualization-vision-prompts.md`
> 4. Documented findings below before researching/adding any new libraries

---

## Captured States

| # | Mode | Screenshot | Vision Rating | Key Finding |
|---|------|-----------|---------------|-------------|
| 1 | **2D Bars** | `viz-2d-bars.png` | N/A (clean baseline) | Bars visible, properly sized, excellent contrast, readable text |
| 2 | **2D Waveform** | `viz-2d-waveform.png` | N/A (clean baseline) | Smooth waveform, good color transitions |
| 3 | **2D Radial** | `viz-2d-radial.png` | **8/10** composition | Balanced, centered, but center anchor is simple/boring |
| 4 | **2D Spectrogram** | `viz-2d-spectrogram.png` | **B+/A-** technical | Good frequency mapping, effective gradient, **needs axis labels** |
| 5 | **2D Lissajous** | `viz-2d-lissajous.png` | N/A (captured) | Complex orbital patterns |
| 6 | **2D Constellation** | `viz-2d-constellation.png` | N/A (captured) | Star-field connections |
| 7 | **2D Particles** | `viz-2d-particles.png` | **6/10** dynamism | Static feel, needs motion blur, varied sizes, more variation |
| 8 | **3D** | `viz-3d.png` | Strong depth | Excellent layering, immersive, strong perspective |
| 9 | **FX/Shader** | `viz-fx-shader.png` | **9/10** impact | High energy, strong color saturation, fully engaged shader system |

---

## Detailed Findings by Mode

### 2D Bars
- **Strengths:** Clean layout, properly sized bars, excellent contrast, readable text
- **Weaknesses:** None significant — this is a solid baseline
- **Top Improvement:** N/A — this mode is already production-ready

### 2D Waveform
- **Strengths:** Smooth flowing lines, good color transitions from purple to cyan
- **Weaknesses:** None significant
- **Top Improvement:** N/A — solid implementation

### 2D Radial
- **Strengths:** Perfectly balanced and centered, strong symmetry, cohesive circular display
- **Weaknesses:** Center anchor is functional but visually simple (single bright core)
- **Top Improvement:** Enhance the center anchor with a glow effect, pulsing core, or secondary orbital element to make it more compelling

### 2D Spectrogram
- **Strengths:** Correct frequency/time mapping, effective low-to-high intensity gradient (purples → yellows), strong contrast
- **Weaknesses:** **No axis labels** (Hz for frequency, seconds for time) — limits absolute readability
- **Top Improvement:** Add axis labels and a frequency scale to make it technically useful, not just aesthetic

### 2D Lissajous
- **Strengths:** Complex orbital patterns, visually interesting
- **Weaknesses:** N/A (captured for reference)
- **Top Improvement:** TBD — needs more detailed analysis

### 2D Constellation
- **Strengths:** Star-field connections, atmospheric
- **Weaknesses:** N/A (captured for reference)
- **Top Improvement:** TBD — needs more detailed analysis

### 2D Particles
- **Strengths:** High contrast, glowing particles on dark background, cohesive monochromatic palette
- **Weaknesses:** Low perceived dynamism (6/10), lacks motion blur/trails, uniform particle sizes, feels "static"
- **Top Improvement:** Introduce subtle particle variation (size, opacity, speed), add motion blur trails, implement audio-reactive velocity changes

### 3D
- **Strengths:** Very strong depth perception, distinct foreground/midground/background layers, immersive abstract network structure, glowing particles with deep perspective
- **Weaknesses:** Top improvement cut off in analysis
- **Top Improvement:** TBD — needs follow-up analysis

### FX/Shader
- **Strengths:** High kinetic energy (9/10), fully engaged shader system, vibrant high-contrast cool tones with magenta accents, layered color gradients
- **Weaknesses:** None significant — this is the flagship mode
- **Top Improvement:** N/A — this mode is already premium quality

---

## Cross-Mode Insights

### What Works Well Across All Modes
1. **Color coherence:** All modes maintain cohesive palettes appropriate for their energy level
2. **Dark backgrounds:** Consistent use of dark backgrounds (`#0a0a0a` range) provides strong contrast
3. **Audio-reactive sizing:** Bars and waveforms properly map frequency data to visual size

### Common Improvement Opportunities
1. **Motion blur/trails:** 2D modes would benefit from frame blending for smoother motion
2. **Center focal points:** Radial and particle modes need stronger center anchors
3. **Axis/labels:** Spectrogram needs technical labels for usability
4. **Particle variation:** Current particle systems use uniform sizes — adding variation creates more organic feel

---

## Recommended Library Research

> [!warning] Next Step
> Research open-source libraries to address the gaps above **before** integrating:
> - **Particle variation:** Look into GPU compute particle libraries (e.g., `three-bvh-csg`, `particle-engine`)
> - **Motion blur/trails:** Research frame-blending libraries or custom TSL post-processing nodes
> - **Spectrogram labels:** Canvas2D overlay libraries for axis rendering
> - **Center glow effects:** TSL-based glow/bloom libraries for 2D canvas modes

---

## Integrated Library: @newkrok/three-particles

> [!info] Integration Complete
> Added `@newkrok/three-particles` v3.0.0 to the frontend workspace.

### Why This Library
- **Trail/Ribbon renderer** — directly addresses the motion-blur/trail feedback for particle modes
- **WebGPU compute support** — future-proofs the 3D visualizer for 50K–350K particle counts
- **React Three Fiber compatible** — works seamlessly with the existing R3F v9.7.0 scene
- **Three.js r182+ compatible** — project uses r185.1 ✅

### What Was Added
| File | Change |
|------|--------|
| `packages/frontend/package.json` | Added `@newkrok/three-particles: ^3.0.0` |
| `packages/frontend/src/features/visualizer/viz-styles/three-particles.tsx` | New `ThreeParticlesDemo` component using the library's trail renderer |
| `packages/frontend/src/features/visualizer/viz-styles/index.ts` | Exported `ThreeParticlesDemo` |
| `packages/frontend/src/features/visualizer/VisualizerScene.tsx` | Wired `three-particles` case into the visualization style switch |
| `packages/frontend/src/features/visualizer/trackConceptAnalyzer.ts` | Added `"three-particles"` to `VisualizationStyle` union + `VISUALIZATION_OPTIONS` |

### How to Use
1. Open the visualizer at `http://localhost:5173/visualizer`
2. Switch to **3D mode** (click the mode button until it shows "3D")
3. Open the **Settings** panel or use the style picker
4. Select **"Three Particles"** from the visualization style dropdown
5. The demo renders 200 audio-reactive particles with ribbon trails, rotating in response to bass/mid energy

### Technical Notes
- The library's `Shape` and `RendererType` are `const enum` values, which conflict with TypeScript `isolatedModules`. Workaround: use string literals (`"SPHERE"`, `"TRAIL"`) and `as any` casts for the renderer config.
- Trail renderer runs on CPU (per library docs), while other renderer types can use GPU compute.
- The demo is intentionally minimal — it creates one particle system in a `useMemo` and updates it per-frame via `useFrame`.

### Alternative Libraries Considered
| Library | Why Considered | Why Not Chosen |
|---------|---------------|----------------|
| `three.quarks` | General-purpose VFX engine, Unity-compatible | Heavier API surface, more setup required |
| `r3f-vfx` | R3F-native wrapper for Three-VFX | Less mature than `@newkrok/three-particles` |
| `particles-js` (joseba-mirena) | Canvas2D trails, vanilla JS | Designed for backgrounds, not audio visualization |

---

## Implementation Roadmap: WebGPU + TSL + Social-Media Export

> [!info] Current State
> Visualizer is fully functional on WebGL (Three.js r185 + R3F v9.7 + Drei v10.7).
> PostFX pipeline: EffectComposer → UnrealBloomPass → custom grade shader → OutputPass.
> Canvas2D modes: bars, waveform, radial, spectrogram, lissajous, constellation, particles.
> 3D modes: 12 visualization styles including integrated `@newkrok/three-particles` v3.0.0.

### Phase 1: WebGPU Renderer + TSL Post-FX (IN PROGRESS)

**Goal:** Swap the WebGL renderer for `WebGPURenderer` with automatic WebGL fallback.
Replace GLSL post-FX with Three Shading Language (TSL) nodes.

**Target file:** `packages/frontend/src/features/visualizer/VisualizerScene.tsx`

**Key changes:**
- Import `WebGPURenderer` from `three/webgpu`
- Detect GPU capability at runtime; fall back to existing WebGL path
- Replace `EffectComposer` + `UnrealBloomPass` with TSL `bloom()`, `grain()`, `chromaticAberration()`
- Use TSL `pass()` for scene render, `vignette()` for final grade
- Keep all existing visualization styles intact (no breaking changes to viz components)

**Why now:**
- Chrome 144+, Edge 144+, Firefox 141+, Safari 26+ support WebGPU
- TSL enables compute-shader particles, selective bloom, and GPU audio compute
- Three.js r185 has stable `WebGPURenderer` and TSL node ecosystem

### Phase 2: GPU Compute Particles + Beat-Locked Interaction

**Goal:** Move particle physics from CPU to WebGPU compute shaders.
Add rhythm-game interactivity (mouse/touch/spacebar triggers, combo tiers, camera choreography).

**Target files:**
- `packages/frontend/src/features/visualizer/viz-styles/three-particles.tsx`
- New: `packages/frontend/src/features/visualizer/BeatInteractionLayer.tsx`

**Key changes:**
- Replace `@newkrok/three-particles` CPU trail updates with TSL compute nodes
- Add `InteractionManager` component handling pointer/spacebar input
- Implement combo counter with visual escalation (color shift → intensity boost → camera shake)
- Beat-locked camera choreography: dolly, orbit, shake synced to `audioData.beat`

### Phase 3: Social-Media Export (WebCodecs + OffscreenCanvas)

**Goal:** Record 1080p/60fps MP4 directly in the browser using WebCodecs + OffscreenCanvas Web Worker.
No server required — export happens client-side.

**Target files:**
- New: `packages/frontend/src/features/visualizer/export/WebCodecsRecorder.ts`
- New: `packages/frontend/src/features/visualizer/export/render-worker.ts`

**Key changes:**
- Capture R3F canvas via `captureStream()` or OffscreenCanvas
- Encode H.264 with `VideoEncoder` (WebCodecs)
- Mux into MP4 with `mp4-muxer` or raw `ISO BMFF` writer
- Run in Web Worker to keep UI responsive during export
- Target: 1080p @ 60fps, ~15-25 Mbps bitrate for social platforms

---

## Rejected Approaches

| Approach | Reason | Decision |
|----------|--------|----------|
| **C#/.NET Blazor WASM** | Adds 10-30 MB runtime; thinner graphics ecosystem; breaks MCP/Playwright/vision-script tooling | ❌ Rejected |
| **Unity WebGL** | Heavy runtime download; breaks existing agent accessibility tooling; overkill for visualization | ❌ Rejected |
| **Unreal Pixel Streaming** | Requires server-side Unreal; breaks single-user local tooling model | ❌ Rejected |
| **Pure WebGL (no WebGPU)** | Doable but misses compute shaders, selective bloom, and GPU audio compute | ⚠️ Fallback only |

---

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| **Three.js r185 + R3F v9.7** | Stable WebGPU path; TSL nodes production-ready |
| **WebGL fallback** | Safari 26 WebGPU still rolling out; must not break existing users |
| **Keep @react-three/drei** | Lightformers, OrbitControls, Environment still work on WebGL fallback |
| **PostFX: TSL over EffectComposer** | Single unified graph; easier to add compute-based effects later |
| **Export: WebCodecs over MediaRecorder** | MediaRecorder limited to VP8/WebM; WebCodecs gives H.264/MP4 |

---

## Browser Support Matrix

| Browser | WebGPU | WebCodecs | OffscreenCanvas | Status |
|---------|--------|-----------|-----------------|--------|
| Chrome 144+ | ✅ | ✅ | ✅ | **Primary target** |
| Edge 144+ | ✅ | ✅ | ✅ | **Primary target** |
| Firefox 141+ | ✅ | ✅ | ✅ | Supported |
| Safari 26+ | ✅ | ✅ | ✅ | Supported (late 2025/early 2026) |
| Chrome <120 | ❌ | ❌ | ✅ | Falls back to WebGL + MediaRecorder |

---

## Rhythm-Game Visual Language (Research Summary)

### Beat-Locked Interaction Points
- **Input:** Spacebar / mouse click / touch tap on beat → score accuracy (perfect/good/miss)
- **Feedback:** Visual flash + particle burst on perfect, subtle pulse on good
- **Combo counter:** Persistent display; escalating visual effects at 10x, 25x, 50x, 100x

### Escalation Tiers
| Tier | Threshold | Visual Effect |
|------|-----------|---------------|
| 1 | 0-9 | Base visualization |
| 2 | 10-24 | Color shift, bloom +20% |
| 3 | 25-49 | Intensity boost, camera shake on miss |
| 4 | 50-99 | Full particle burst, chromatic aberration pulse |
| 5 | 100+ | Screen flash, slow-motion effect, special camera move |

### Camera Choreography
- **Auto-rotate:** Gentle orbit during low-energy sections
- **Beat dolly:** Subtle forward push on strong beats
- **Miss shake:** Quick shake on missed input
- **Section transitions:** Smooth dolly to new framing on LRC phrase start

---

## Related Documentation

- [[visualization-effects|Visualization Effects & 3D Rendering]] — Existing post-FX pipeline
- [[visualization-vision-prompts|Visualization Vision Prompts]] — Analysis prompts used
- [[three-js-studio|Three.js Studio]] — Browser studio implementation
- [[visualizer-state-analysis-2026|Visualizer State Analysis]] — This document

---

*Last updated: 2026-09-10*
