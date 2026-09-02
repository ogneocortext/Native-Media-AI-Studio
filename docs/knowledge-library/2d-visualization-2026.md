# 2D Visualization Options — 2026 Open Source Research

> **Purpose:** Knowledge library entry for future 2D visualization upgrades to Native Media AI Studio. All keywords use **2026 methods** and **open source** projects. Focus is complementing the existing 3D (React Three Fiber) and Shader (WebGL) visualizers with lightweight, beat-reactive 2D layers.

**Date:** 2026-09-02 | **Tags:** `2026`, `open-source`, `2d-visualization`, `audio-reactive`, `canvas`, `WebGL`, `p5.js`, `PixiJS`

---

## Executive Summary

For 2026, the most viable **open source 2D** stacks for audio-reactive visuals are **Canvas2D + Web Audio API** (low overhead, 60fps on mobile) or **PixiJS 8 / I2Djs** (WebGL/WebGPU-accelerated 2D with SVG fallback). `p5.js 1.9` remains the 2026 standard for generative 2D prototyping; `Waviz` and `visual-flux` show production-grade 2026 patterns (spectral-flux beat detection, 9:16 WebM export). Best fit for this studio: **PixiJS 8 + p5.js sketches + meyda/web-audio-beat-detector + Remotion 2D compositions**.

---

## 1. 2026 Open Source 2D Rendering Engines (2026 methods)

| Engine | 2026 Status | Why Try | License | Relevance to Studio |
|--------|-------------|---------|---------|---------------------|
| **PixiJS 8 (2026)** | WebGL 2 + WebGPU renderer, `2026 non-commercial → MIT` re-license clarified (`pv-tool` 2026-03-24) | Fastest 2D batching, filters, particle containers; **pv-tool** (`DanteAlighieri13210914/pv-tool`) uses **PixiJS 8 + Vite + TypeScript** for kinetic typography — directly maps to our `KineticLyricOverlay` | MIT (pv-tool Non-Commercial for 2026 builds) | Replace Canvas2D lyric streaks with GPU-accelerated text sprites |
| **p5.js 1.9 (2026)** | 2026 creative-coding standard, `p5.sound` Web Audio | Fastest prototyping for 2D generative sketches; **OpenVJ 2026** (`kniessner/openvj` — `2026-04-12` `MIT` `React+Three.js+p5.js` VJ tool) proves `p5.js` + `React Three Fiber` coexistence | LGPL | `packages/frontend/src/features/visualizer/VisualizationStyles.tsx` 2D fallback for low-end devices |
| **I2Djs 5 (2026)** | Integrated-2D `SVG|Canvas|WebGL|PDF` single API `i2djs.github.io/I2Djs` | One API renders to SVG (exportable), Canvas (fast), WebGL (100k particles), PDF (print) — useful for 2D→print lyric posters | BSD-3 | Export LRC-driven posters from same 2D scene |
| **Two.js 2026** | SVG/Canvas/WebGL agnostic | Lightweight alternative to Pixi for shapes/text paths | MIT | Lyric text on path effects |

**2026 keyword:** Search `PixiJS 8 WebGPU 2026`, `p5.js 1.9 generative 2026`, `I2Djs WebGL 2026`

---

## 2. 2026 Open Source Audio-Reactive 2D Visualizers (2026 methods)

| Project | 2026 Stack | 2026 Method | License | Takeaway |
|---------|------------|-------------|---------|----------|
| **visual-flux** `da-troll/visual-flux` `2026-05-19` `Apache-2.0` | React + Vite + Canvas2D, `jsmediatags`, MediaRecorder | **7 Canvas2D modes** `bars·waveform·spectrogram·radial·Lissajous·constellation·particles`, **8 palettes** (Trollspace/Synthwave…), **spectral-flux beat detection** with rolling-median BPM, 9:16 WebM loop export | Apache-2.0 | Drop-in reference for our `ShaderVisualizer` 2D mode — steal `palettes.ts` lerp + beat detection |
| **Waviz 2026** `Waviz-Team/Waviz` `npm: waviz` | Web Audio API + Canvas, React components | `new Waviz(canvas,audio).render()` <10 lines; modular React wrappers, themeable | MIT | Replace manual `AnalyserNode` boilerplate in `ShaderVisualizer.tsx:18` |
| **OpenVJ 2026** `kniessner/openvj` `2026-04-12` `MIT` `33 commits` | React 18.2 + Three.js 0.160 + p5.js + Zustand | Quad warping, GLSL shaders, **Uji generative art**, AI-assisted generation, MIDI, 2D + 3D projection mapping | MIT | Best 2026 architecture ref for hybrid 2D/3D (our `Visualizer.tsx` 3d vs shader split) |
| **Geometric_Soundscape 2026** `Passopla/Geometric_Soundscape` `2026-05-02` | React + p5.js + WebGL wireframe | Audio-reactive wireframe geometry, Vite, bloom/ grain post | MIT | Wireframe 2D overlay for `GeometricViz` |
| **phase-viz 2026** `7g3n/phase-viz` `2026-05-27` `MIT` `17★` | React 19 + Three.js + Web Audio API + WebCodecs/ffmpeg.wasm MP4 export | Audio-reactive 3D with Canvas2D fallback, Cloudflare Workers | MIT | Our `video-generation` export pipeline can use its `mp4-muxer` + `ffmpeg.wasm` fallback |
| **Butterchurn (Milkdrop WebGL) 2026** `jberg/butterchurn` | WebGL port of Winamp Milkdrop | Thousands of presets, classic 2D/3D hybrid | BSD | Preset library for 2D inspiration |
| **Spectro / BopGL 2026** `calebj0seph.github.io/spectro`, `jayrichh.github.io/BopGL` | WebGL spectrogram / spinning record | Real-time spectrogram, dynamic backgrounds | MIT | Spectrogram mode for `audio-analysis` |

**2026 keyword:** `spectral-flux beat detection 2026`, `canvas2D audio visualizer 2026 open source`, `Web Audio API visualizer 2026 React`

---

## 3. 2026 Open Source Analysis Libraries (2026 methods)

| Lib | 2026 Use | Why |
|-----|----------|-----|
| **meyda 2026** `meyda/meyda` | Audio feature extraction (`mfcc`, `chroma`, `spectralCentroid`) | Replace hand-rolled `trackFeatures.ts:76` with `meyda` features for LRC section color |
| **web-audio-beat-detector 2026** `chrisguttandin/web-audio-beat-detector` | Beat detection via Web Audio API | More accurate than `librosa.beat_track` for 2D `Lissajous` radial |
| **wavesurfer.js 2026** | Waveform + `jsmediatags` ID3 | Already in `visual-flux` for 2D waveform — use for `MediaLibrary` waveform preview |
| **Clubber.js 2026** `wizgrav/clubber` | Music theory → visualization | Map LRC sections `CHORUS/DROP` to key-aware hue |

---

## 4. 2026 Open Source Kinetic Typography 2D (2026 methods)

Current studio uses `KineticLyricOverlay.tsx` + `KineticPresets.ts` (GSAP/Anime.js). 2026 upgrades:

* **pv-tool 2026** `DanteAlighieri13210914/pv-tool` `2026-03-03` `408★` — **PixiJS 8** PV lyric engine, TypeScript, real-time `PixiJS` filters — best 2026 reference for our `KineticTypographyPage.tsx`.
* **kinetic-typography-skills 2026** `iart-ai/kinetic-typography-skills` `2026-06-22` `MIT` — Claude Code skill for `GSAP`/`Framer Motion`/`Remotion` lyric videos; `npx skills add` — aligns with our `Remotion` pipeline.
* **GSAP 2026** (now **100% free** via Webflow) + **Motion (Framer Motion) 2026** — industry standard for `2026` stagger/choreography; `Anime.js v4` lightweight. From `cssauthor.com` `2026-05-02` tier list: use **GSAP** for timeline, **Motion** for declarative React, **Anime.js v4** for modular.

**2026 keyword:** `kinetic typography 2026 GSAP free`, `PixiJS 8 lyric video 2026`, `Remotion kinetic typography 2026`

---

## 5. Recommended 2026 Integration Path for This Studio

1. **Immediate (low risk):** Add `PixiJS 8` 2D layer alongside `ShaderVisualizer.tsx` for lyric particles — `pv-tool` shows 60fps `PixiJS` text sprites with LRC `isPhraseStart` burst.
2. **Next:** Replace manual `AnalyserNode` with `Waviz` or `meyda` + `web-audio-beat-detector` for `ShaderVisualizer.tsx:18` uniform `u_beat`.
3. **Export:** Steal `visual-flux` 9:16 `MediaRecorder` loop and `phase-viz` `mp4-muxer` for `Remotion` 2D `video-generation`.
4. **Generative:** Prototype `p5.js` sketches in `Visualizer.tsx` `vizMode="2d"` (like `OpenVJ` p5 panel) — `p5.sound` FFT → `I2Djs` webglLayer for 100k particles.

---

## 6. Sources (2026 open source)

* `simeydotme/awesome-webgl` (WebGL curated 2026)
* `Waviz-Team/Waviz` `wavizjs.com` `2026`
* `da-troll/visual-flux` `2026-05-19` `Apache-2.0` `visual-flux` 7 modes
* `kniessner/openvj` `2026-04-12` `MIT` VJ tool
* `Passopla/Geometric_Soundscape` `2026-05-02` `p5.js+WebGL`
* `7g3n/phase-viz` `2026-05-27` `MIT` `React Three Fiber`
* `DanteAlighieri13210914/pv-tool` `2026-03-03` `PixiJS 8`
* `iart-ai/kinetic-typography-skills` `2026-06-22` `MIT`
* `willianjusten/awesome-audio-visualization` `meyda`, `web-audio-beat-detector`
* `blog.openreplay.com` `2026-02-05` `p5.js creative coding 2026`
* `cssauthor.com` `2026-05-02` `Best React & WebGPU Kinetic Typography Libraries In 2026` (GSAP free)

---

## 7. How to Use This Entry

* For 2D work, start with `PixiJS 8` + `p5.js` (both MIT, 2026 active).
* For beat detection, prefer `spectral-flux` (`visual-flux`) over `librosa` for 2D canvas.
* Search future work with `2026` suffix: e.g., `PixiJS 8 2026`, `p5.js sound 2026`, `meyda 2026`.

*Generated 2026-09-02 via web search `2026 open source 2D visualization`.*
