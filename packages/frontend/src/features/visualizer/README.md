# Visualizer Feature

Audio-reactive visualization for the Native Media AI Studio: Canvas2D bars/waveform/radial, shader visuals, Three.js scenes, and section-driven visual changes synced to audio beats.

## Entry Points

| File | Purpose |
|------|---------|
| `Visualizer.tsx` | Main visualizer component: orchestrates Canvas2D + shader rendering, playback, recording |
| `Canvas2DVisualizer.tsx` | Canvas2D renderer: bars, waveform, radial modes |
| `ShaderVisualizer.tsx` | Shader-based visualizer: WebGL shaders, key-derived palettes |
| `VisualizerScene.tsx` | Scene wrapper: Three.js integration for 3D visuals |
| `selectVizMode.ts` | Viz mode selection: picks 2D/3D/shader based on energy, BPM, genre |
| `sectionStateMachine.ts` | Section-driven visual changes: maps audio sections to visual presets |
| `audioReactivityProcessor.ts` | Audio reactivity triad: attack/release/sensitivity per band |
| `audioTiming.ts` | Audio clock: latency-corrected playback position, beat phase |
| `keyPalette.ts` | Key-derived color palette: pitch class → hue, mode → saturation |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `components/` | Visualizer UI components (Viz* chrome, panels, overlays) |
| `services/` | Visualizer services: audio analysis worker, spectral timeline, MCP context sync |
| `stems/` | Stem mixing presets: `stemMixPresets.ts`, fader mapping, dB/gain conversion |
| `viz-styles/` | Visualization style definitions: motion curves, gamma drives |
| `motion/` | Motion effects: camera transitions, beat phrasing, shockwaves |
| `webgpu/` | WebGPU rendering support |

## Key Files

| File | Purpose |
|------|---------|
| `canvas2dModes.ts` | Canvas2D mode definitions and rendering |
| `canvas2dModeBudget.ts` | Canvas2D mode budget tracking (performance) |
| `liveSpectralFrame.ts` | Live spectral frame synthesis: sub/mid/high bands, RMS, centroid |
| `lyricsParser.ts` / `lyricsSync.ts` | LRC lyrics parsing and sync to playback |
| `sectionHelpers.ts` | Section color/intensity/preset helpers |
| `reactivityGenrePresets.ts` | Genre-based reactivity presets (EDM, ambient, vocal-led, etc.) |
| `aiPresetCatalog.ts` / `visualPresets.ts` | Visual preset definitions and import/export |
| `shaderPresets.ts` | Shader preset definitions |
| `visualizerModeRegistry.ts` | Visualizer mode registration |
| `visualizerHelpers.ts` | Shared visualizer helpers: `cleanTrackName()` for names outside selectors |
| `trackFeatures.ts` | Track feature extraction |
| `trackVisualProfiles.ts` | Track-to-visual profile mapping |
| `mp4Recording.ts` | MP4 recording of visualizer output |
| `idleParticles.ts` / `particles.ts` | Particle systems |
| `htmlCanvasDetector.ts` | HTML canvas detection |
| `drumClassifier.ts` | Drum onset classification |
| `audioEQ.ts` | Audio EQ processing |
| `audioHooks.ts` | Audio hook helpers |
| `audioAnalysis.worker.ts` | Audio analysis web worker |
| `audioAnalysisHelpers.ts` | Audio analysis helpers |
| `useAudioAnalysisWorker.ts` | Hook for audio analysis worker |
| `useAudioGraph.ts` | Hook for audio graph |
| `useKeyPalette.ts` | Hook for key palette |
| `useLrcSync.ts` | Hook for LRC sync |
| `usePanelCollapsed.ts` | Hook for panel collapse state |
| `useSpectralTimeline.ts` | Hook for spectral timeline |
| `useTrackSelection.ts` | Hook for track selection |
| `useVisualizerLifecycle.ts` | Hook for visualizer lifecycle |
| `useVisualizerPlayback.ts` | Hook for visualizer playback |
| `useVisualizerRecording.ts` | Hook for visualizer recording |
| `useVisualizerState.ts` | Hook for visualizer state |
| `useVisualPresets.ts` | Hook for visual presets |
| `useMCPContextSync.ts` | Hook for MCP context sync |

## Related Docs

- `docs/architecture/visualizer.md` — visualizer module map and refactor rules (D14)
- `docs/architecture/browser-support.md` — single-engine target: modern Chromium (D44)

## Tests

Test files are colocated next to the modules they cover (`.test.ts`). Key test files:
- `canvas2dModeBudget.test.ts`, `selectVizMode.test.ts`, `keyPalette.test.ts`
- `audioReactivityProcessor.test.ts`, `audioTiming.test.ts`
- `liveSpectralFrame.test.ts`, `lyricsParser.test.ts`, `lyricsSync.test.ts`
- `sectionStateMachine.test.ts`, `sectionHelpers.test.ts`
- `shaderMotionWiring.test.ts`, `visualPreset.test.ts`
- `panelCollapse.test.ts`, `canvas2dHelpers.test.ts`, `perceptualScales.test.ts`
