# Tasks — Visualizer

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.4
Rules: `docs/plans/tasks/README.md` — **the §2 refactor protocol applies
to every item here: tag first, ledger report after.**
Module map: `docs/architecture/visualizer.md` (D14). Never touch
`unity-visualizer/`.

### T-VIZ-01 — Tag Visualizer.tsx and plan its slice decomposition
- **Status:** done
- **Goal:** `pre-refactor` tag placed; a written slice plan exists that
  splits Visualizer.tsx (≈104 KB) into ≤40-minute items in this file.
- **Files:** packages/frontend/src/features/visualizer/Visualizer.tsx
- **Acceptance:** Tag exists on the remote; slice items T-VIZ-02+ written
  with files + acceptance each.
- **Last session:** Cline, 2026-10-26 — tag `pre-refactor-2026-10-26` placed
  and pushed to remote. File read in full (2,475 lines). Slice plan written
  with 7 slices (T-VIZ-02–T-VIZ-08), each with files + acceptance.

### T-VIZ-02 — Extract the useVisualizerState hook from Visualizer.tsx
- **Status:** done
- **Goal:** All `useState`/`useRef` declarations extracted from Visualizer.tsx
  into a new `useVisualizerState.ts` hook. Returns state + setters + refs.
- **Files:** new `packages/frontend/src/features/visualizer/useVisualizerState.ts`,
  `packages/frontend/src/features/visualizer/Visualizer.tsx`
- **Acceptance:** Same state surface, zero behavior change; tsc + vitest pass.
- **Last session:** Kilo, 2026-10-26 — extracted useVisualizerState hook; moved
  csvContent, vizParams, trackMetadata, analysisData, stemsData, analyzing,
  rendererReady, rendererBackend, lyrics, modeFade from local state into the
  hook; fixed duplicate lastBeatAtRef/lastAudioDataAtRef local refs that
  shadowed hook refs; converted useState-based refs to proper useRef; removed
  dead proMixerStems state from hook; tsc + vitest + eslint all pass.

### T-VIZ-03 — Plan the Canvas2DVisualizer.tsx slice decomposition
- **Status:** done
- **Goal:** Write the slice plan for splitting Canvas2DVisualizer.tsx
  (≈83 KB, 1823 lines) into ≤40-minute items per the D14 module map.
  Slices: shockwaves, idle particles, particle system, per-mode render
  functions (bars group), per-mode render functions (remaining group),
  Plan 2.9 API extraction, final wire-up + cleanup.
- **Files:** docs/plans/tasks/visualizer.md (this plan),
  packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx
- **Acceptance:** Each slice has files + acceptance written; slices
  sequenced so each is individually verifiable with tsc + vitest.
- **Last session:** Kilo, 2026-10-26 — slice plan written with 7 slices
  (T-VIZ-04–T-VIZ-09), each with files + acceptance.

### T-VIZ-04 — Extract shockwave system into shockwaves.ts
- **Status:** done
- **Goal:** Move spawnShockwave, updateShockwaves, drawShockwaves,
  shockwaves array, MAX_SHOCKWAVES to a new module
  `shockwaves.ts` behind pure functions.
- **Files:** new `packages/frontend/src/features/visualizer/shockwaves.ts`,
  `packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx`
- **Acceptance:** tsc + vitest pass; shockwaves still spawn on beat,
  expand, fade, and cap at 8; no behavior change in any mode.
- **Last session:** Kilo, 2026-10-26 — created shockwaves.ts with pure
  functions (spawnShockwave, updateShockwaves, drawShockwaves +
  Shockwave interface, MAX_SHOCKWAVES). Canvas2DVisualizer.tsx now
  imports from it; call sites pass `shockwaves` array and `rand` fn.
  tsc + lint + 601 vitest all pass.

### T-VIZ-05 — Extract idle particle system into idleParticles.ts
- **Status:** done
- **Goal:** Move idleParticles array, spawnIdleParticle, updateIdleParticles,
  drawIdleParticles, MAX_IDLE_PARTICLES to `idleParticles.ts`.
- **Files:** new `packages/frontend/src/features/visualizer/idleParticles.ts`,
  `packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx`
- **Acceptance:** tsc + vitest pass; idle particles still spawn/fade in
  the idle branch; removed from Canvas2DVisualizer.tsx.
- **Last session:** Kilo, 2026-10-26 — created idleParticles.ts with pure
  functions (spawnIdleParticle, updateIdleParticles, drawIdleParticles +
  IdleParticle interface, MAX_IDLE_PARTICLES). Canvas2DVisualizer.tsx now
  imports from it; call sites pass `idleParticles` array and `rand` fn.
  tsc + lint + 601 vitest all pass.

### T-VIZ-06 — Extract particle render system into particles.ts
- **Status:** done
- **Goal:** Move particles array, spawnParticle, and the particles-mode
  render block to `particles.ts`. Canvas2DVisualizer.tsx delegates to it.
- **Files:** new `packages/frontend/src/features/visualizer/particles.ts`,
  `packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx`
- **Acceptance:** tsc + vitest pass; particles mode still renders
  audio-reactive particles; removed from Canvas2DVisualizer.tsx.
- **Last session:** Kilo, 2026-10-26 — created particles.ts with
  spawnParticle + updateAndDrawParticles (includes center glow).
  Canvas2DVisualizer.tsx imports from it; particles mode render block
  replaced with a single call. tsc + lint + 601 vitest all pass.

### T-VIZ-07 — Extract bar-style mode renderers into canvas2dModes.ts
- **Status:** done
- **Goal:** Extract bars, mirrored-bars, segmented-led-bars,
  stereo-split-bars, stacked-frequency-bands, dot-peak-matrix render
  blocks to `canvas2dModes.ts` as pure render functions dispatched by mode.
- **Files:** new `packages/frontend/src/features/visualizer/canvas2dModes.ts`,
  `packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx`
- **Acceptance:** tsc + vitest pass; all six modes still render identically;
  Canvas2DVisualizer.tsx no longer contains their draw code.
- **Last session:** Kilo, 2026-10-26 — created canvas2dModes.ts with
  BarModeContext/BarModeState interfaces, boostedValue/computeBarTarget/drawBar/
  drawPeakIndicator/drawBeatFlash/drawDownbeatDot helpers, and render functions
  for all 6 bar-style modes + renderBarMode dispatcher. Canvas2DVisualizer.tsx
  now calls renderBarMode once instead of the 6-mode if/else chain (~490 lines
  removed). tsc + lint + 601 vitest all pass.

### T-VIZ-08 — Extract remaining mode renderers into canvas2dModes.ts
- **Status:** done
- **Goal:** Extract waveform, radial, spectrogram, lissajous, constellation,
  aurora render blocks to `canvas2dModes.ts`.
- **Files:** `packages/frontend/src/features/visualizer/canvas2dModes.ts`,
  `packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx`
- **Acceptance:** tsc + vitest pass; all six modes still render identically.
- **Last session:** Kilo, 2026-10-27 — added renderWaveform, renderRadial,
  renderSpectrogram, renderLissajous, renderConstellation, renderAurora,
  renderParticles to canvas2dModes.ts; expanded BarModeContext/BarModeState
  interfaces; renamed renderBarMode → renderMode with all 12 modes;
  replaced all inline mode blocks in Canvas2DVisualizer.tsx with a single
  renderMode call (~430 lines removed). tsc + lint + 601 vitest all pass.

### T-VIZ-09 — Extract Plan 2.9 deterministic render API into its own module
- **Status:** done
- **Goal:** Extract readiness/beginDeterministicRun/renderAtVirtualTime/
  endDeterministicRun to a focused module; remove inline mode blocks from
  the draw loop; Canvas2DVisualizer.tsx is orchestrator + JSX only.
- **Files:** new `packages/frontend/src/features/visualizer/services/frameAccurateCanvas2d.ts`,
  `packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx`
- **Acceptance:** tsc + vitest pass; frame-accurate export still works
  (readiness + renderAtVirtualTime).
- **Last session:** Kilo, 2026-10-27 — created
  services/frameAccurateCanvas2d.ts with FrameAccurateCanvas2D class
  implementing FrameAccurateRenderApi (readiness, beginDeterministicRun,
  renderAtVirtualTime, endDeterministicRun, canvas). Canvas2DVisualizer.tsx
  now creates the instance, passes resetState/clearPools callbacks, and
  publishes `api` via frameAccurateApiRef. Removed ~90 lines of inline API
  code. tsc + lint + 601 vitest all pass.

### T-VIZ-10 — Extract track selection into useTrackSelection.ts
- **Status:** done
- **Goal:** Move parseLyricsForTrack, handleFile, handleSelectLibraryTrack,
  deriveTrackMeta, resetAudioDerivedState, trackRequestRef and the
  pendingTrack handoff effect out of Visualizer.tsx into a new hook
  `useTrackSelection.ts`. The component passes state, setters and refs in;
  the hook owns "pick a track → parse → decode → reset derived state".
- **Files:** new `packages/frontend/src/features/visualizer/useTrackSelection.ts`,
  `packages/frontend/src/features/visualizer/Visualizer.tsx`
- **Acceptance:** tsc + eslint clean on the visualizer folder; no
  vitest regressions (601 tests); track switching still works in the
  browser (file picker, library dropdown, pending-track handoff).
- **Last session:** Kilo, 2026-10-30 — created useTrackSelection.ts with
  handleFile, handleSelectLibraryTrack, parseLyricsForTrack, deriveTrackMeta
  and resetAudioDerivedState plus the pending-track handoff effects;
  Visualizer.tsx now wires JSX to the hook. tsc, eslint and all 891 vitest
  tests pass.


### T-VIZ-11 — Extract playback clock into useVisualizerPlayback.ts
- **Status:** done
- **Goal:** Move the playback rAF loop (elapsed/beat clock), pause-sync
  effect, prevAudioUrl revoke, unmount cleanup, togglePlayPause,
  cycleVizMode, handlePlayheadClick into `useVisualizerPlayback.ts`.
- **Files:** new `packages/frontend/src/features/visualizer/useVisualizerPlayback.ts`,
  `packages/frontend/src/features/visualizer/Visualizer.tsx`
- **Acceptance:** tsc + eslint clean; play/pause/seek still drive the
  render clock.
- **Last session:** Kilo, 2026-10-31 — created useVisualizerPlayback.ts
  with the rAF elapsed clock (throttled ~20fps React state + full-rate
  LRC sync ref), pause-sync, blob-URL revocation + unmount cleanup, and
  togglePlayPause/cycleVizMode/handlePlayheadClick callbacks; Visualizer.tsx
  wires JSX to the same-named callbacks. tsc, eslint and all 891 vitest
  tests pass. Dropped now-unused `VIZ_MODE_ORDER` import.

### T-VIZ-12 — Extract preset application into useVisualPresets.ts
- **Status:** done
- **Goal:** Move applyPreset, handleVisualPresetSelect, handlePresetLoaded,
  handleClearPreset, handleEnhanceWithAI and genre-preset state into
  `useVisualPresets.ts`.
- **Files:** new `packages/frontend/src/features/visualizer/useVisualPresets.ts`,
  `packages/frontend/src/features/visualizer/Visualizer.tsx`
- **Acceptance:** tsc + eslint clean; preset dropdown and genre presets
  still apply in the browser.
- **Last session:** Kilo, 2026-10-31 — created useVisualPresets.ts with
  handleGenrePresetSelect, applyPreset (track-aware multipliers, postfx
  clamping, kinetic mapping, never mutates shared catalog),
  handleVisualPresetSelect (monotonic lock preserves manual picks),
  handlePresetLoaded, handleClearPreset, handleEnhanceWithAI (Ollama
  generation via dynamic import); Visualizer.tsx wires JSX to same-named
  callbacks. Removed now-unused imports (AudioAnalysisData,
  DEFAULT_VIZ_PARAMS, VisualPreset, clampNum, toVisualPreset,
  getVisualizationForTrack, VisualizationStyle, ReactivityGenrePreset
  type). Moved vizParamsRef declaration before hook calls. tsc, eslint
  and all 891 vitest tests pass.

### T-VIZ-13 — Extract loop/capture/shortcuts into useVisualizerLifecycle.ts
- **Status:** done
- **Goal:** Move handleLoopToggle, captureFrame, mode crossfade, reduced
  motion, global keyboard map, outside-click dismisser, dev keyboard
  shortcuts and the __VIZ_TEST__ harness into `useVisualizerLifecycle.ts`.
- **Files:** new `packages/frontend/src/features/visualizer/useVisualizerLifecycle.ts`,
  `packages/frontend/src/features/visualizer/Visualizer.tsx`
- **Acceptance:** tsc + eslint clean; loop/capture/keyboard still work.
- **Last session:** Kilo, 2026-10-31 — created useVisualizerLifecycle.ts
  with dev shortcuts (Ctrl+Shift+T/A), handleLoopToggle (A-B loop),
  captureFrame (topmost canvas PNG), stage keyboard map, outside-click
  dismisser, mode crossfade, reduced-motion, the __VIZ_TEST__ harness and
  the testStateRef sync; moved `handleAnalyzeTrack` definition before the
  hook call so it can be passed via api. Removed the extracted blocks from
  Visualizer.tsx. tsc, eslint and all 891 vitest tests pass.

### Interaction-State Vision Analysis (completed 2026-10-26)
... (unchanged)
- **Goal:** Extract readiness/beginDeterministicRun/renderAtVirtualTime/
  endDeterministicRun to a focused module; remove inline mode blocks from
  the draw loop; Canvas2DVisualizer.tsx is orchestrator + JSX only.
- **Files:** new `packages/frontend/src/features/visualizer/services/frameAccurateCanvas2d.ts`,
  `packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx`
- **Acceptance:** tsc + vitest pass; frame-accurate export still works
  (readiness + renderAtVirtualTime).
- **Last session:** Kilo, 2026-10-27 — created
  services/frameAccurateCanvas2d.ts with FrameAccurateCanvas2D class
  implementing FrameAccurateRenderApi (readiness, beginDeterministicRun,
  renderAtVirtualTime, endDeterministicRun, canvas). Canvas2DVisualizer.tsx
  now creates the instance, passes resetState/clearPools callbacks, and
  publishes `api` via frameAccurateApiRef. Removed ~90 lines of inline API
  code. tsc + lint + 601 vitest all pass.

### Interaction-State Vision Analysis (completed 2026-10-26)
- **Status:** done
- **Goal:** Capture interaction-state screenshots of /visualizer (modal closed,
  track dropdown open, focus tabs Bass/Vocals/Highs, genre presets EDM/Phonk+Bass,
  mode toggles 3D/2D) and analyze each with a vision model to reveal issues a
  static screenshot misses.
- **Files:** 9 screenshots in `.playwright-mcp/` (interaction-*.png); findings
  documented in `docs/knowledge-library/visualizer-ux-audit-2026-10.md` §5.
- **Acceptance:** Cross-state patterns identified (no hover/focus states,
  dense control panel, long sidebar, missing state feedback, contrast concerns);
  prioritized recommendations written; resource-budgeting rules added
  (check VRAM before analysis, skip if >70%, one at a time).
- **Last session:** Kilo, 2026-10-26 — 7 of 9 states analyzed (2 blocked by
  Ollama 500 under VRAM pressure); Gemma4 via Ollama used; Atomic Chat Qwen
  integration fixed (fuzzy model matching + backend-aware routing) but not used
  for analysis due to VRAM constraints.


### T-VIZ-14 — Frame-rate-independent damping for all visualizer motion
- **Status:** todo
- **Goal:** Replace fixed per-frame smoothing constants (springK 0.28/0.26 in canvas2dModes.ts and equivalents) with dt-based exponential damping so motion speed is a property of the music, not the display refresh rate.
- **Files:** `packages/frontend/src/features/visualizer/canvas2dHelpers.ts`, `canvas2dModes.ts`, `particles.ts`, `viz-styles/*`
- **Plan:** `docs/knowledge/visualizer-smoothness-plan-2026-11-03/README.md` §T-VIZ-14 (damp helper, lambda conversion table).
- **Acceptance:** unit test: 1 s of damping in 60 steps vs 120 steps lands within 1%; motion speed visually identical at 60 Hz vs 120 Hz.

### T-VIZ-15 — Single attack/release envelope stage, wired into all modes
- **Status:** todo
- **Goal:** Wire the long-dormant asymmetricSmoothBands into a single time-constant envelope stage between band data and every mode; delete per-mode springs it replaces.
- **Files:** `packages/frontend/src/features/visualizer/canvas2dHelpers.ts`, `Canvas2DVisualizer.tsx`, `canvas2dModes.ts`
- **Plan:** `docs/knowledge/visualizer-smoothness-plan-2026-11-03/README.md` §T-VIZ-15 (per-band time constants from the veffects reference).
- **Acceptance:** no mode reads raw band arrays (grep); kick hit peaks within one frame, decays over ~0.5 s.

### T-VIZ-16 — Float frequency data + split transient/onset path
- **Status:** todo
- **Goal:** Main visual path reads getFloatFrequencyData (dB floats) instead of 256-level byte data; onset detection runs on an unsmoothed path via spectral flux and is exposed as a decaying envelope.
- **Files:** `packages/frontend/src/features/visualizer/audioHooks.ts`, `useAudioGraph.ts`, `audioReactivityProcessor.ts`
- **Plan:** `docs/knowledge/visualizer-smoothness-plan-2026-11-03/README.md` §T-VIZ-16 (two-path analysis; lower smoothingTimeConstant once T-VIZ-15 owns smoothing).
- **Acceptance:** onset envelope fires on isolated hits in a fixture; beat-to-visual latency vs the precomputed timeline measurably reduced on a click track.

### T-VIZ-17 — Remove shadowBlur; pre-rendered glow sprites + cached gradients
- **Status:** todo
- **Goal:** Eliminate all 22 shadowBlur call sites in the 2D path; replace with pre-rendered glow sprites (drawImage, 'lighter') and per-mode cached gradients; batch draw state changes.
- **Files:** `packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx`, `canvas2dModes.ts`, `particles.ts`
- **Plan:** `docs/knowledge/visualizer-smoothness-plan-2026-11-03/README.md` §T-VIZ-17.
- **Acceptance:** grep shadowBlur in the visualizer tree returns zero; busy-section p95 frame time inside budget per the plan's measurement protocol.

### T-VIZ-18 — Adaptive quality governor (Canvas2D + R3F)
- **Status:** todo
- **Goal:** Extend RenderStats' FPS measurement into a stepped quality governor (DPR ladder, particle counts, post toggles) with hysteresis, on both the Canvas2D and R3F surfaces (drei PerformanceMonitor).
- **Files:** `packages/frontend/src/features/visualizer/components/RenderStats.tsx`, `Canvas2DVisualizer.tsx`, `components/ShaderCanvas.tsx`, `VisualizationFX.tsx`
- **Plan:** `docs/knowledge/visualizer-smoothness-plan-2026-11-03/README.md` §T-VIZ-18.
- **Acceptance:** under 4x CPU throttle the governor steps down and frame time returns inside budget without oscillation; renderer.info draw calls surfaced, budget ~150.

### T-VIZ-19 — Anticipation: phase-driven beats + interpolated spectral timeline
- **Status:** todo
- **Goal:** Drive visual beats from the precomputed beat phase (peaks land on beats) with live flux as fallback only; interpolate useSpectralTimeline lookups between analysis frames; scale motion intensity by section via sectionStateMachine.
- **Files:** `packages/frontend/src/features/visualizer/useSpectralTimeline.ts`, `motion/useMotionDriver.ts`, `sectionStateMachine.ts`
- **Plan:** `docs/knowledge/visualizer-smoothness-plan-2026-11-03/README.md` §T-VIZ-19.
- **Acceptance:** click-track fixture: visual beat peaks within one frame of audio beat times at 60 fps; section changes alter motion intensity without a mode switch.
