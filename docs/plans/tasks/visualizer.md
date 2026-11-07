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
- **Status:** done
- **Goal:** Replace fixed per-frame smoothing constants (springK 0.28/0.26 in canvas2dModes.ts and equivalents) with dt-based exponential damping so motion speed is a property of the music, not the display refresh rate.
- **Files:** `packages/frontend/src/features/visualizer/canvas2dHelpers.ts`, `canvas2dModes.ts`, `particles.ts`, `viz-styles/*`
- **Plan:** `docs/knowledge/visualizer-smoothness-plan-2026-11-03/README.md` §T-VIZ-14 (damp helper, lambda conversion table).
- **Acceptance:** unit test: 1 s of damping in 60 steps vs 120 steps lands within 1%; motion speed visually identical at 60 Hz vs 120 Hz.
- **Last session:** Kilo, 2026-11-03 — landed in `0ce7f5e`: damp()/dampLambda() in canvas2dHelpers.ts (lambda = -60*ln(1-k)), all Canvas2D mode renderers + particles drag migrated, 7 new tests incl. 60-vs-120 and 60-vs-30 step invariance and 60 Hz lerp equivalence. Kilo reports 608 visualizer tests pass, tsc/eslint clean. Orion static review 2026-11-03: math and tests verified against the Plan; BuilderFigure's springK is a separate component already using the equivalent dt form — not a miss. Ledger entry written by Orion at the owner's request (Kilo's commit did not update the task file).

### T-VIZ-15 — Single attack/release envelope stage, wired into all modes
- **Status:** done
- **Goal:** Wire the long-dormant asymmetricSmoothBands into a single time-constant envelope stage between band data and every mode; delete per-mode springs it replaces.
- **Files:** `packages/frontend/src/features/visualizer/canvas2dHelpers.ts`, `Canvas2DVisualizer.tsx`, `canvas2dModes.ts`
- **Plan:** `docs/knowledge/visualizer-smoothness-plan-2026-11-03/README.md` §T-VIZ-15 (per-band time constants from the veffects reference).
- **Acceptance:** no mode reads raw band arrays (grep); kick hit peaks within one frame, decays over ~0.5 s.
- **What changed:**
  - `canvas2dHelpers.ts`: new `createEnvelopeStage(freqLength,
    sampleRate)` — per-bin attack/release lambdas by Hz group (bass
    <250 Hz k=0.5/0.06, mid <4 kHz k=0.5/0.07, treble k=0.5/0.10, all
    converted via `dampLambda`+`damp` with real `dt`), plus an enveloped
    spectral centroid (k=0.05). Outputs `bands` in the same 0–255 byte
    scale/length as analyser data, so every mode consumer is unchanged.
    The dormant `asymmetricSmoothStep`/`asymmetricSmoothBands`/
    `ASYMMETRIC_SMOOTHING_MODES`/`usesAsymmetricSmoothing` machinery is
    deleted — the stage supersedes it.
  - `Canvas2DVisualizer.tsx`: the stage is created lazily per freq-buffer
    length, stepped once per frame on the raw `getByteFrequencyData`
    output (virtual/export frames included — `nowMs()` keeps it
    deterministic), and `ctxInfo.freq` now carries `envelope.bands`.
    The silence guard resets `envelope` + legacy peak state on track
    switch; `resetState` (deterministic export) resets it too.
  - `canvas2dModes.ts`: all nine freq-driven `dampLambda` springs
    deleted — computeBarTarget (bars), mirrored-bars, segmented-led,
    stereo-split, stacked-frequency-bands (incl. the redundant
    asymmetricSmoothStep branch and `smoothedStack`), dot-peak-matrix,
    radial, constellation node radii. Modes now use the enveloped target
    directly; `barPeaks`/`barVelocities` remain only as peak-hold/display
    state. Waveform's wave-domain smoothing and particles' motion
    integration are untouched (not band data).
  - `visualizerModeRegistry.ts` + `BarModeContext`: the `asymmetric`
    flag removed from both render-context contracts.
- **Last session:** Devin (SWE-2 Flash), 2026-11-05 — implemented per
  plan. Verified: `tsc -b` clean project-wide, eslint 0 errors on touched
  files, 560 visualizer vitest pass incl. 7 new envelope-stage tests
  (one-frame attack, ~0.5 s release tail, bass-vs-treble release
  ordering, byte scale, reset, centroid, short-buffer safety). Live
  kick-transient check pending a headed playback session.

### T-VIZ-16 — Float frequency data + split transient/onset path
- **Status:** done
- **Goal:** Main visual path reads getFloatFrequencyData (dB floats) instead of 256-level byte data; onset detection runs on an unsmoothed path via spectral flux and is exposed as a decaying envelope.
- **Files:** `packages/frontend/src/features/visualizer/audioHooks.ts`, `useAudioGraph.ts`, `audioReactivityProcessor.ts`
- **Plan:** `docs/knowledge/visualizer-smoothness-plan-2026-11-03/README.md` §T-VIZ-16 (two-path analysis; lower smoothingTimeConstant once T-VIZ-15 owns smoothing).
- **Acceptance:** onset envelope fires on isolated hits in a fixture; beat-to-visual latency vs the precomputed timeline measurably reduced on a click track.
- **Last session:** Devin, 2026-11-06 — landed: `useAudioGraph` gains `transientRef`, an unsmoothed (`smoothingTimeConstant = 0`) AnalyserNode twin tapped off `eq.output`; new `spectralFlux.ts` detector (positive-only spectral flux, adaptive mean+1.5σ threshold over ~1 s window, ~0.5 s release envelope); `EnvelopeStage.stepNorm` accepts normalized 0–1 floats so the live path reads `getFloatFrequencyData` → dB-normalized through analyser min/maxDecibels (byte quantization removed; `bands` output stays 0–255 so mode math is unchanged); `Canvas2DVisualizer` feeds `stepNorm` live and normalized virtual buffers on export, exposes `ctxInfo.onset`; `useRealAudio` exposes `AudioData.onset` on both worker and non-worker paths. `ANALYSER_SMOOTHING` left at 0.25 — already below the plan's ~0.5 target and the transient path covers onset latency. Verified: tsc clean, ESLint 0 errors, 569 visualizer vitest pass incl. 9 new spectralFlux + 2 stepNorm tests. Caveat: click-track latency measurement vs precomputed timeline not run (needs headed playback session).

### T-VIZ-17 — Remove shadowBlur; pre-rendered glow sprites + cached gradients
- **Status:** done
- **Goal:** Eliminate all 22 shadowBlur call sites in the 2D path; replace with pre-rendered glow sprites (drawImage, 'lighter') and per-mode cached gradients; batch draw state changes.
- **Files:** `packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx`, `canvas2dModes.ts`, `particles.ts`
- **Plan:** `docs/knowledge/visualizer-smoothness-plan-2026-11-03/README.md` §T-VIZ-17.
- **Acceptance:** grep shadowBlur in the visualizer tree returns zero; busy-section p95 frame time inside budget per the plan's measurement protocol.
- **Last session:** Devin, 2026-11-06 — landed: all 22 shadowBlur/shadowColor call sites removed (canvas2dModes ×14, Canvas2DVisualizer idle text, particles ×2 sites). New `drawGlowSprite`/`getGlowSprite` in canvas2dHelpers — one cached 128px radial-gradient sprite per colour drawn with 'lighter' + per-instance alpha/scale, used for bar/LED/stereo/stacked/dot-matrix/constellation/waveform-peak/idle-text glows. Waveform + lissajous strokes use a two-pass technique (wide low-alpha additive stroke under the crisp core) since sprites don't fit strokes; particles use two-pass arcs (dynamic hues would explode the sprite cache). `grep shadowBlur|shadowColor` in the visualizer tree returns zero. Verified: tsc clean, ESLint 0 errors, 569 vitest pass. Caveat: busy-section p95 frame-time measurement not run (needs headed session); per-frame createLinearGradient/createRadialGradient calls (waveform fill, particles center glow) remain — sprite-izing those is a follow-up, not part of this item's acceptance.

### T-VIZ-18 — Adaptive quality governor (Canvas2D + R3F)
- **Status:** done
- **Last session:** landed with this commit — `qualityGovernor.ts` (pure p95-window governor: 20 ms budget, 120-frame window, 2 s breach / 10 s recover hysteresis, DPR ladder 2→1.5→1.25→1) + 6 unit tests covering spike rejection, full-ladder walk, recovery delay, and anti-oscillation. Canvas2D: live frames feed frame-dt to the governor; a level change re-caps `dpr` and resizes the backing store (virtual/export frames bypass sampling — renders stay deterministic). R3F: new `QualityGovernorProbe` inside the Canvas replaces the binary `PerformanceMonitor` decline/incline toggle; ladder 1.5→1.25→1 drives `adaptiveDpr`, and the bottom rung (DPR 1) unmounts `PostFXSelector` (both GLSL `PostFX` and `WebGPUPostFX`), handing rendering back to R3F's default path since PostFX owns the frame via `useFrame(…, 1)`. Draw calls already surfaced by `RenderStatsBadge` (`renderer.info.render.calls`).
- **Acceptance status:** governor step-down/step-up and anti-oscillation proven by unit tests; live 4x-throttle frame-time verification pending a headed session (same caveat pattern as T-VIZ-15/16).
- **Goal:** Extend RenderStats' FPS measurement into a stepped quality governor (DPR ladder, particle counts, post toggles) with hysteresis, on both the Canvas2D and R3F surfaces (drei PerformanceMonitor).
- **Files:** `packages/frontend/src/features/visualizer/components/RenderStats.tsx`, `Canvas2DVisualizer.tsx`, `components/ShaderCanvas.tsx`, `VisualizationFX.tsx`
- **Plan:** `docs/knowledge/visualizer-smoothness-plan-2026-11-03/README.md` §T-VIZ-18.
- **Acceptance:** under 4x CPU throttle the governor steps down and frame time returns inside budget without oscillation; renderer.info draw calls surfaced, budget ~150.

### T-VIZ-19 — Anticipation: phase-driven beats + interpolated spectral timeline
- **Status:** done
- **Last session:** landed with this commit — three pieces. (1) `beatPhaseEnvelope()` in `canvas2dHelpers.ts`: `pow(1−phase, 3)` peaks exactly on each analysed-grid beat (0 = just after beat → 1 as next nears); `Canvas2DVisualizer` exposes it as `ctxInfo.beatEnv`, grid-locks `ctxInfo.d.beat` to the phase wrap (`beatPhase < 0.1`) so every mode accent lands on the beat, and falls back to the T-VIZ-16 flux onset for unanalysed audio (`beatPhase === undefined`) and to the frame's own beat flag for virtual/export frames. (2) `sampleSpectralFrame()` in `useSpectralTimeline.ts`: `sampleAtTime` now lerps all band fields between adjacent analysis frames instead of snapping to `floor(t*fps)`. (3) `getSectionMotionIntensity()` in `sectionStateMachine.ts`: per-section amplitude scale (drop 1.2 → outro 0.5) multiplied into Canvas2D `energyMod` — structure-first dynamics without a mode switch. 9 new tests (envelope peak/decay/floor, interpolation midpoints/clamps, intensity ranking/case/fallback).
- **Goal:** Drive visual beats from the precomputed beat phase (peaks land on beats) with live flux as fallback only; interpolate useSpectralTimeline lookups between analysis frames; scale motion intensity by section via sectionStateMachine.
- **Files:** `packages/frontend/src/features/visualizer/useSpectralTimeline.ts`, `motion/useMotionDriver.ts`, `sectionStateMachine.ts`
- **Plan:** `docs/knowledge/visualizer-smoothness-plan-2026-11-03/README.md` §T-VIZ-19.
- **Acceptance:** click-track fixture: visual beat peaks within one frame of audio beat times at 60 fps; section changes alter motion intensity without a mode switch.

### T-VIZ-20 — Feedback/Warp preset mode (Milkdrop idiom, native)
- **Status:** done
- **Goal:** Promote ShaderVisualizer's existing ping-pong feedback (ShaderCanvas `feedback` props: zoom/rotation/decay) from a lab feature into an audience-facing preset mode: one warp engine, many looks, presets as data.
- **Files:** `packages/frontend/src/features/visualizer/ShaderVisualizer.tsx`, `components/ShaderCanvas.tsx`, new `packages/frontend/src/features/visualizer/warpPresets.ts`
- **Plan:** Research: `docs/knowledge/visualizer-mode-research-2026-11-03/README.md` §1 (native path A chosen by owner, 2026-11-03). Steps: (1) generalize the feedback resample beyond zoom/rotate/decay scalars — add swirl and radial-flow terms driven by uniforms; (2) define the preset format in `warpPresets.ts` (warp params, palette, draw-element selection, audio-response gains) as typed data; (3) author 6 starter presets spanning calm→aggressive; (4) cycle presets on section boundaries via sectionStateMachine, crossfading through the feedback buffer (the buffer makes transitions free — never hard-cut); (5) consume enveloped bands/onset envelope per T-VIZ-15/16 contracts, not raw FFT.
- **Acceptance:** 6 presets selectable and visibly distinct on the same track; preset change at a section boundary produces no hard cut (frame-diff check per `docs/guides/visualizer-debug.md`); GLSL passes the repo compile check; frame time inside the T-VIZ-18 budget at DPR cap.
- **Last session:** Kilo, 2026-11-03 — landed in `ac37347` (single commit for the item): swirl + radial-flow uniforms in ShaderCanvas's composite shader, typed `warpPresets.ts` with 6 presets (deepCalm, glassWater, neonPulse, copperSpiral, plasmaStorm, singularity; per-preset audioGains), section-boundary cycling in ShaderVisualizer. Orion static review 2026-11-03: no-hard-cut acceptance holds by construction (transitions change uniforms only; the feedback buffer carries the image) — a manual frame-diff run was not performed and is not required given the mechanism. Two open threads: (a) presets auto-cycle only — manual pin/select registered as T-VIZ-25; (b) warp drive uses existing bass/energy values — retrofit to the T-VIZ-15/16 envelopes when those land. Ledger entry written by Orion at the owner's request.

### T-VIZ-21 — Kinetic Typography mode (lyrics as the visual)
- **Status:** done
- **Last session:** landed with this commit — `kinetic-type` registered in `CANVAS_2D_MODES`/labels/short-labels, `MODE_BUDGETS` (`phraseFlash`+`beatVignette`, no trails — text stays crisp), and `renderKineticType` in `canvas2dModes.ts`. `Canvas2DVisualizer`'s `lrcSync` prop widened to full `LrcSyncData` and lyric line/progress/section now flow through `ctxInfo` (`lyric`, `lyricProgress`, `sectionName`) on live, prop, and deterministic `lrcSyncAt` virtual paths. The mode: deadpan restrained palette, thin mirrored-spectrum ground, current line enters on its LRC start (cubic ease scale+fade over first 12% of line), exits by decay over last 10%, CHORUS/DROP/PRE-CHORUS cut slightly larger with `beatEnv` pulse, word-level LRC dims sung words / lifts the current word, instrumental passages render a section card (never empty), `motionScale` collapses choreography to fades for reduced-motion.
- **Goal:** A mode where the song's words are the scene: line/word animation (snap, stack, scale, scatter) driven by vocal-stem energy and beat phase over a minimal reactive ground — not an overlay on another visual.
- **Files:** `packages/frontend/src/features/visualizer/canvas2dModes.ts`, `visualizerHelpers.ts` (CANVAS_2D_MODES), `lyricsSync.ts`, `components/LyricOverlay.tsx`, `motion/motionMoves.ts`
- **Plan:** Research: mode-research doc §2. Steps: (1) register mode id `kinetic-type` in CANVAS_2D_MODES + budget table (text is the focal point; global effects minimal per the budget rules); (2) reuse the lyricsSync line lookup (currentLine/nextLine/progress) — extend to word-level only if line timing proves too coarse in testing; (3) choreography vocabulary from existing motion moves: line entry on the vocal onset, hook lines get the squash/impact move on beat phase, exit by decay — deadpan register: restrained palette, no bouncy easing (owner's songs are dry/skeptical; match the brand); (4) instrumental tracks fall back to title/section cards so the mode never sits empty.
- **Acceptance:** on a lyric-timed track, line entries land within one frame of the line start at 60 fps; hook repetition is visibly emphasised over verse lines; mode is readable with audio muted (screenshot check); reduced-motion setting freezes choreography to fades.
- **Depends on:** T-VIZ-15/16 data contracts (enveloped vocal energy, onset envelope) — spec against them, build after they land.

### T-VIZ-22 — Stem Scene (one visual agent per stem)
- **Status:** done
- **Last session:** landed with this commit — new `viz-styles/stemScene.tsx` registered as `stem-scene` in `VisualizationStyle`, `VISUALIZATION_OPTIONS`, `viz-styles/index.ts`, and the `VisualizerScene` switch. Four agents: drums = 24-instance `instancedMesh` arc striking on `getStemEnergy(drums)` + the T-VIZ-16 onset envelope (beat-grid staggered via `beatSnap`); bass = ground icosahedron heaving on bass energy; vocals = central torus-knot breathing on vocal energy with wire shell; other = drifting atmosphere ring/torus. ~8 draw calls, all updates via refs in one `useFrame`, materials disposed via `useDisposeOnUnmount`. No-stem fallback: agents degrade to the mixed-signal split (drums←treble+energy, bass←bass, vocals←mid, other←energy) so the scene never renders empty. `sceneFrozen` halts clock-driven rotation while energy responses continue; `prefersReducedMotion` scales speed 0.35×. Caveat: stem energies come from precomputed analysis curves (`getStemEnergy`), so live StemMixer mute/solo does not yet isolate agents — per-stem analysers live inside `useStemMixer` and are not exposed to the scene; that plumbing is a follow-up. Isolation is correct per-curve by construction (each agent reads only its own stem), but the live mute acceptance check awaits that wiring + a headed session.
- **Goal:** A 3D style where each stem is a visual agent in one scene: drums = percussive geometry striking on hits, bass = ground mass heaving, vocals = central form, other = atmosphere field; layout from stemSpatial.
- **Files:** new `packages/frontend/src/features/visualizer/viz-styles/stemScene.tsx`, `viz-styles/helpers.ts` (getStemEnergy), `stemSpatial.ts`, `viz-styles/index.ts`
- **Plan:** Research: mode-research doc §3. Steps: (1) per-stem agents as instanced/merged geometry — draw calls inside the T-VIZ-18 budget (~150) from the start; (2) drive agents from getStemEnergy per-stem bands/onsets (the API instancedParticles and aurora already use); (3) solo/mute a stem in the StemMixer and the matching agent must respond alone — that isolation check is the mode's correctness test; (4) when stems are absent, degrade to the mixed-signal agents (bass/mid/treble split) rather than an empty scene.
- **Acceptance:** stem isolation check passes for drums/bass/vocals; draw calls ≤ budget on the reference track; no per-frame React state (refs only, per architecture rules).
- **Depends on:** T-VIZ-16 (per-stem onset envelopes improve strike timing; mode can ship on energy alone if scheduled first).

### T-VIZ-23 — Spectral Terrain Flyover style
- **Status:** done
- **Last session:** landed with this commit — new `viz-styles/terrain.tsx` registered as `terrain` in `VisualizationStyle`, `VISUALIZATION_OPTIONS` ("Spectral Terrain"), `viz-styles/index.ts`, and the `VisualizerScene` switch. One `ShaderMaterial` on a 150×240-segment plane (1 draw call): ridgeline across the width driven by 24 resampled `perceptualBands` (Mel, low→high = left→right), falling back to a positional bass/mid/treble synthesis when band data is absent; hash-based 4-octave value noise breaks up ridge strips and supplies detail — continuous world-space noise, never tiled, so no 60 s repetition. Scroll phase is **integrated from `audioElapsedRef` deltas** (clamped 0–0.1 s, pause freezes flight, seeks can't teleport, export frames deterministic); speed = `1.9 + bass·3.4 + energy·1.7 + onset·1.2` so a bass drop raises speed within a frame, and `uHeave` rides bass+onset. Treble drives crest sparkle (`pow(vHeight,7)` glints); manual exp distance fog; `sceneFrozen` halts phase accumulation while uniforms still track audio; `prefersReducedMotion` scales speed 0.35× and halves heave. Caveat: "no visible tile repetition over 60 s" and "speed/heave within one beat" are verified by construction (non-repeating noise + per-frame uniform updates) — a headed playback capture is still owed for the visual acceptance.
- **Goal:** An endless ridged-terrain flyover as a WebGL style: spectrum shapes the ridgeline, enveloped bass drives speed, sub drives heave, treble adds rim sparkle.
- **Files:** new `packages/frontend/src/features/visualizer/viz-styles/terrain.tsx`, `viz-styles/index.ts`
- **Plan:** Research: mode-research doc §4 (ranked #1 wow-per-cost in the Synesthesia spec). Pure GLSL displaced grid on the ShaderCanvas pattern (fullscreen approach, no scene graph); scroll phase from the audio clock (architecture rule 2 — never performance.now for motion); DPR governed by T-VIZ-18 when it lands.
- **Acceptance:** forward motion is continuous with no visible tile repetition over 60 s; a bass drop measurably increases speed/heave within one beat; frame time inside budget at DPR cap.

### T-VIZ-24 — Kaleidoscope post pass (VisualizationFX)
- **Status:** done
- **Last session:** landed with this commit — `KaleidoscopeShader` ShaderPass inserted between `UnrealBloomPass` and the grade pass in the GLSL `PostFX` composer. Polar fold (`mod`-based angle folding, `uFold` 6/8/12 selectable via `postfx.kaleido.fold`, default 8) with radius scaled ×0.7 so folded samples stay inside [0,1]² — no edge-clamp streaks at fold boundaries. `uIntensity` defaults to 0 and the fragment shader early-outs at ≤0.001, so the pass is a no-op until a preset raises `postfx.kaleido.intensity`; per-frame it is driven by `intensity × (0.5 + 0.5·sectionGain) × (0.6 + 0.4·onset)` and damped at 0.08/frame. Synthwave preset carries `{fold:8, intensity:0.45}` as the reference enable. `postfx.kaleido` typed through `types.ts`, `PostFXSelector`, and `WebGPUPostFX` props (WebGPU/TSL pipeline ignores it — GLSL path only, noted below).
- **Goal:** 6/8/12-fold mirror symmetry as a toggleable ShaderPass in the VisualizationFX composer chain, intensity driven by section state and the onset envelope — a multiplier over every existing mode, not a new mode.
- **Files:** `packages/frontend/src/features/visualizer/VisualizationFX.tsx`
- **Plan:** Research: mode-research doc §5. Insert the pass after UnrealBloomPass and before the grade pass; fold count selectable; intensity defaults to 0 (off) and presets/sections may raise it.
- **Acceptance:** enabling the pass on any 3D style produces stable symmetry with no seam artifacts at fold boundaries; pass cost ≤ 1 ms at 1080p on the reference GPU (RenderStats frame-time delta).

### T-VIZ-25 — Warp preset pin/select control
- **Status:** done
- **Goal:** Let the user pin a single T-VIZ-20 warp preset (or re-enable auto-cycling) from the ShaderVisualizer controls — required for video production, where a render must hold one look per section rather than accept the cycle.
- **Files:** `packages/frontend/src/features/visualizer/ShaderVisualizer.tsx`, `warpPresets.ts`
- **Plan:** Add a preset picker (the six ids from warpPresets.ts) plus an "Auto (cycle on sections)" option, defaulting to Auto so current behaviour is unchanged. Pinning sets warpPresetIdRef and suspends the section-boundary cycling while pinned. Follow the existing feedback-control state pattern in the same file (feedbackEnabled/Zoom/Rotation/Decay).
- **Acceptance:** with a preset pinned, section boundaries no longer change the active preset (verify across two boundaries); switching back to Auto resumes cycling at the next boundary; control state survives a shader-preset change in the same session.
- **What changed:**
  - `ShaderHud.tsx` gained a "Warp: …" button + dropdown beside the
    preset/FX buttons: "Auto — cycle on section changes" plus the six
    `WARP_PRESETS` entries (name + description, same panel styling as
    the shader-preset selector).
  - `ShaderVisualizer.tsx` holds `warpPin` state + `warpPinRef` mirror;
    the section-boundary effect only advances `warpPresetIdRef` when the
    pin is `null`. Pinning writes the id into `warpPresetIdRef`
    immediately (picked up next frame); switching back to Auto resumes
    cycling at the next boundary.
  - `warpPresets.ts`: dropped the `WarpPreset[]` annotation so the
    existing `as const` produces a real `WarpPresetId` literal union
    (previously it widened to `string`, making `"auto"` unions
    redundant); `palette`/`drawElements` are `readonly` and the array
    carries `satisfies readonly WarpPreset[]`.
- **Last session:** Devin (SWE-2 Flash), 2026-11-05 — implemented per
  plan; pin suspends cycling via the `warpPinRef` guard at the section
  boundary, Auto restores it. Verified: `tsc -b` clean project-wide,
  eslint 0 errors on touched files (4 pre-existing warnings remain),
  566 visualizer vitest pass. Manual two-boundary pin check pending a
  live playback session.

### T-VIZ-26 — Live QA pass: canvas2d render crash, audio-ctx lifecycle, dead controls
- **Status:** done
- **Goal:** Fix confirmed live-page defects on /render/visualizer found during
  browser QA: every canvas2d mode threw `modeCtx.nowMs is not a function`
  per frame (registry is empty, fallback passed the raw 2D ctx where a
  BarModeContext was expected and a per-frame state literal), the shared
  AudioContext was closed on unmount but never recreated on remount
  (dead graph + "context is closed" warnings), RemixPanel fired ~76 stem
  probes on mount while collapsed, ReactivityHUD controls looked live in
  non-shader modes but only the shader consumes them, the Frame Rate card
  showed stale/fake metrics outside 3D and had dead Reset/Monitoring buttons,
  and AudioLatencyCard read a non-reactive ref so it stuck on "not
  initialized" whenever the parent stopped re-rendering.
- **Files:** packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx,
  useAudioGraph.ts, components/ReactivityHUD.tsx, Visualizer.tsx,
  features/remix/RemixPanel.tsx, services/api/remix.ts (POST probe),
  state/audioLibraryStore.ts (+test), useMCPContextSync.ts,
  components/AudioLatencyCard.tsx, components/FrameRateCard.tsx,
  tools/mcp/vision-mcp.mjs (send think:false - gemma4 burned num_predict on
  reasoning and returned empty content)
- **Acceptance:** all 6 canvas2d modes render with zero console errors during
  playback (Playwright verified, bars confirmed via pixel probe + local
  vision model); audio plays end-to-end with latency card showing real
  metrics in every mode; probe requests only fire when the Remix panel is
  open; shader-only HUD controls render disabled outside shader mode;
  Frame Rate card only appears in 3D where the probe actually runs;
  tsc + eslint (0 errors) + vitest 112 + playwright canvas2d/lrc 4/4 pass.
- **Last session:** Devin (SWE-2 Flash), 2026-11-05 - live QA via
  playwright-mcp + local gemma4 vision model; all fixes verified in-browser.

### T-VIZ-27 — Restore visualizer chrome CSS lost in the ee2714e slim rewrite
- **Status:** done
- **Goal:** The ee2714e "slim" rewrite of visualizer.css dropped every
  component-chrome rule (topbar children, icon buttons, menus, tuning groups,
  status badges, file browser, AI panel, bottombar, focus-visible states) -
  169 viz-* classes used in tsx had no matching selector, leaving toolbar
  buttons at 14x14px transparent and panels unstyled. Extract the missing
  rules from the pre-rewrite stylesheet (postcss AST walk, deduped, @media
  preserved, :scope rewritten to .viz-page) into visualizer-chrome.css,
  imported after visualizer.css in globals.css. Also fix the playhead
  gradient track (scaleX(0) with no driver - now bound to elapsed/duration),
  the duplicated .viz-audio-player rule, dead .viz-canvas-loading/
  .viz-loading-label rules, and lowercase transform function names.
- **Files:** packages/frontend/src/styles/visualizer.css,
  packages/frontend/src/styles/visualizer-chrome.css (new),
  packages/frontend/src/styles/globals.css,
  packages/frontend/src/features/visualizer/Visualizer.tsx
- **Acceptance:** computed style probe shows .viz-icon-btn at 32x32 with
  background/border/radius (was 14x14 transparent); topbar, tuning groups,
  bottombar and HUD z-ladder render; playhead track scaleX tracks elapsed
  (verified 0.01114 at 0:02/3:51); no horizontal overflow at 820px;
  postcss parses both stylesheets; tsc -b clean; vitest 900 pass;
  playwright canvas2d+lrc 4/4 pass; vision model audit confirms styled UI.
- **Last session:** Devin (SWE-2 Flash), 2026-11-05 - CSS analysis via
  postcss extraction + live computed-style probes + gemma4 vision audit.

### T-VIZ-28 — User-flow QA: A-B loop wrap, track-skip resume, stats-stack collision, topbar reachability
- **Status:** done
- **Goal:** Headed user-flow pass over /render/visualizer (track select,
  play, mode switches, transport, menus, file browser, mixer, remix):
  fix defects found and fold 3D telemetry into one corner without
  overlap.
- **Findings fixed:** (a) A-B loop state lived only in React state -
  the playback rAF loop never saw it, so the region painted but playback
  never wrapped; now mirrored into loopRegionRef synced by effect and
  read inside the rAF loop. (b) Switching tracks while playing left the
  keyed <audio> remounted paused (no pause event on unmount, isPlaying
  stayed true) - music silently stopped on skip; a 60 ms delayed play()
  on audioUrl change resumes it. (c) The 3D backend badge + new
  RenderStatsBadge stack at top-right collided with AudioLatencyCard -
  moved inside .viz-latency-panel as a vertical stack under the card,
  badge absolute positioning neutralized. (d) The app-shell topbar
  (connection dot + bell, z-20) overlapped the toolbar's rightmost
  buttons making them unclickable - .viz-actions gets 5.5rem inline-end
  padding. (e) Topbar gained a browse-library button (FolderOpen) opening
  the searchable AudioFileBrowser even after a track is loaded; header
  nesting fixed by rendering VizTopbar as .viz-topbar-row inside the
  single .viz-topbar header.
- **Files:** packages/frontend/src/features/visualizer/Visualizer.tsx,
  components/VizTopbar.tsx, styles/visualizer.css,
  useVisualizerPlayback.ts (loopRegionRef read),
  useVisualizerLifecycle.ts (handleLoopToggle)
- **Acceptance:** A-B loop wraps playback back to region start (verified
  live: currentTime stayed inside region across 10 s); mode switch keeps
  playing (t 5.1 -> 5.9, paused:false); 3D mode shows WebGL2 badge +
  live "60 FPS" RenderStatsBadge stacked under latency card at
  x1399 y325 (headed Chromium, real GPU); tsc -b clean; eslint 0 errors;
  pageerrors none.
- **Last session:** Devin (SWE-2 Flash), 2026-11-05 - headed Chromium
  user-flow probes + computed-bbox checks; all fixes verified live.

### T-VIZ-29 — Chrome redesign: slim bar, auto-hiding stage overlays, tabbed inspector
- **Status:** done
- **Goal:** Owner feedback: "when a track is loaded there is too much going
  on at once" — rebuild the chrome to be less cluttered. Approved scope:
  full redesign, stage overlays auto-hide during playback, secondary
  controls in a tabbed inspector.
- **What changed:**
  - Layout was genuinely broken, not just busy: `.viz-canvas-wrap` was
    `height:100vh`, pushing the transport bar and spectrum footer below
    the fold (probe: wrap y51 h900, bottombar y951). `.viz-page` is now a
    `100vh` flex column; `.viz-content` is a flex row; the canvas takes
    `flex:1; min-height:0` — transport + meters are always on screen.
  - New `VizInspector.tsx`: docked right drawer (in-flow flex sibling, so
    it squeezes the canvas instead of overlaying it) with tabs Scene /
    Tuning / Mixer / EQ / Remix / AI. Track-dependent tabs disable until a
    track loads. All panels stay mounted while the drawer is open (mixer
    audio-graph state survives tab switches); the drawer unmounts when
    closed, which also re-gates RemixPanel's probes.
  - Mixer (simple/pro toggle + StemMixerPanel/ProfessionalMixer), Master
    EQ, RemixPanel, SettingsPanel, ReactivityHUD, PresetFileUpload and
    AIVisualizerPrompt all moved out of the topbar/bottom-bar overlays
    into inspector tabs; `.viz-audio-player` is now transport-only and
    sits above the spectrum footer (transport is bottom-most).
  - `VizToolbar` slimmed: cycle-mode chip replaced by a direct FX/2D/3D
    segmented switch, added inspector toggle + chrome pin; PresetFileUpload
    moved to the AI tab. QuickPresetBar gained `showModeSwitch` (off — the
    topbar owns mode switching now).
  - Stage chrome auto-hide: while playing and unpinned, preset bar /
    latency+stats / style picker / AI preset chip / spectrum footer fade
    after 2.6 s idle; pointer movement over the canvas reveals them.
    Playhead stays (it is the seek surface). Pin button in toolbar.
- **Files:** components/VizInspector.tsx (new), VizToolbar.tsx,
  QuickPresetBar.tsx, Visualizer.tsx, styles/visualizer.css,
  docs/plans/tasks/visualizer.md
- **Acceptance:** live headed probe — canvas-wrap h=723 ending y774,
  transport y774-835, footer y835-900, no page scroll; inspector opens
  with 6 tabs, mixer tab renders both mixer variants; chrome hides ~2.6 s
  after last pointer activity during playback and re-reveals on move;
  tsc -b clean; eslint 0 errors; vitest 900 pass; playwright
  canvas2d+lrc 4/4 (one library-load flake passed on retry); gemma4 vision
  audit: clean layout, tabs correct, no overlap.
- **Last session:** Devin (SWE-2 Flash), 2026-11-05 - headed Chromium
  probes + computed bboxes + gemma4 vision audit of inspector screenshots.

### T-VIZ-30 — Feature separation: Remix builder out to /create/remix + z-index regression fix
- **Status:** done
- **Goal:** Owner: "separate features that don't belong on the same page
  but keep cohesion between pages." Audit showed the visualizer's Remix
  inspector tab embedded the same RemixPanel that already has a dedicated
  page at /create/remix — a production tool inside a preview surface.
- **What changed:**
  - Inspector tabs are now Scene / Tuning / Mixer / EQ / AI (Remix tab
    removed). The mixer tab gains a "Build a mashup" link card and the
    More menu gains a "Remix Studio" item; both call openRemixStudio(),
    which hands off via setPendingTrack(currentFilename) +
    setPendingRemixOpen() then navigates to /create/remix — the same
    pending-track mechanism Media Library already uses.
  - LineagePanel's startMashup/reopen now navigate to /create/remix
    instead of /visualizer (recipe + track handoffs are consumed by
    RemixPanel wherever mounted).
  - RemixPage reads peekPendingTrack() and passes it as currentTrack so
    recipe reopens match their source track (the panel's sourceTrack
    guard requires it), and shows an "Open in Visualizer →" link that
    re-hands-off the same track for preview — cohesion in both directions.
  - Regression found by the handoff test: .viz-page becoming display:flex
    made .viz-topbar a flex item, so its z-index:100 + backdrop-filter
    stacking context trapped the More/shortcuts menus (z-200) *below* the
    overlay scrim (z-150) — every menu item unclickable. Fixed:
    .viz-topbar is position:relative; z-index:160.
- **Files:** components/VizInspector.tsx, VizToolbar.tsx, VizMoreMenu.tsx,
  Visualizer.tsx, styles/visualizer.css, styles/visualizer-chrome.css,
  features/remix/RemixPage.tsx, features/media-library/LineagePanel.tsx
- **Acceptance:** headed probe — inspector shows 5 tabs (no Remix); More
  menu lists "Remix Studio"; clicking it lands on /create/remix with
  pendingTrack="mastered/Clever Mistakes...", panel auto-expanded
  (pendingRemixOpen consumed), "Open in Visualizer" link rendered;
  elementFromPoint confirms menu clicks reach buttons (scrim no longer
  intercepts); gemma4 vision audit confirms expanded panel + return link;
  vitest 900 pass; eslint 0 errors. (Full tsc blocked by unrelated
  agent-loop WIP in services/api — zero errors in touched files.)
- **Last session:** Devin (SWE-2 Flash), 2026-11-05 - headed handoff probe
  + z-index elementFromPoint verification + gemma4 vision audit.

### T-VIZ-31 — Track-load preset cascade: single apply, sequenced transitions
- **Status:** done
- **Goal:** Owner: "presets triggered upon loading a track need to behave
  better instead of so many things firing off at the same time."
- **What changed (useTrackSelection.ts):**
  - Lyrics fetch now runs CONCURRENTLY with ensureAnalysis() instead of
    sequentially — the whole preset cascade used to wait on the slow path.
  - Kinetic preset resolved ONCE: the visual preset bundle's own
    kineticPreset wins; the genre heuristic + backend suggestion is now a
    fallbackKineticId only used when no catalog preset applies. Previously
    setKineticPreset() ran unconditionally early AND again inside the
    preset block — two systems writing the same state in one batch, and
    the early write leaked through even when the user had manually locked
    a preset mid-load.
  - Auto-apply pulses the mode-fade overlay (220ms) so the params/colors
    identity swap reads as a transition instead of a one-frame flash.
  - Auto viz-mode switch delayed ~400ms with stale/user-pick re-checks —
    preset settle and mode crossfade are now two beats instead of one
    stacked double-transition.
- **Harness fix (useVisualizerLifecycle.ts):** __VIZ_TEST__.getState()
  never refreshed vizMode — it was missing from both the change-detection
  condition and the effect deps, so probes read a stale mode. Added.
- **Files:** useTrackSelection.ts, useVisualizerLifecycle.ts,
  Visualizer.tsx (setModeFade wiring), tools/probes/ (moved from
  docs/scratch — scripts don't belong with documents)
- **Acceptance:** headed probe at 120ms resolution shows the cascade as
  discrete beats — preset id cleared at select, single batched apply at
  ~2.5s (kinetic+preset together), fade pulse peaks 0.90, mode switch
  2d→3d lands ~400ms later as its own transition; 900 vitest + 4/4
  Playwright specs pass; eslint 0 errors on touched files.
- **Last session:** Devin (SWE-2 Flash), 2026-11-05 - headed cascade probe
  (tools/probes/viz-preset-cascade.mjs) + vitest + playwright specs.

### T-VIZ-32 — Lazy stems-analysis fetch (audit: what else fired on load)
- **Status:** done
- **Goal:** Owner: "what else is firing at the same time when it shouldn't."
  Full effect audit of the track-load path found one remaining unconditional
  heavy fetch: getStemsAnalysis(currentFilename) ran on EVERY track select.
  For tracks with separated stems the backend runs per-stem librosa feature
  extraction (4 stems via asyncio.to_thread) — real CPU work for a feature
  (mixer stem layers / ProfessionalMixer) the user may never open.
- **What changed (Visualizer.tsx):** the effect is now gated on actual
  consumers — vizMode === "shader" (ShaderVisualizer stem-reactive layers)
  or inspectorOpen && inspectorTab === "mixer" (ProfessionalMixer). A
  per-track fetched-set ref preserves the fetch-once-per-session cache;
  a failed fetch is evicted so the next activation retries.
- **Audit findings left as-is (intentional or cheap):**
  - useKeyPalette + useSpectralTimeline (ShaderVisualizer, FX mode only)
    fetch analysis-derived data on FX entry — both are intrinsic to FX.
  - LRC lookup tries up to 4 candidates (2 names x public+api) but
    early-returns on first hit; worst case is 4 fast 404s.
  - Section-boundary warp-preset cycling during playback is the
    intentional T-VIZ-20 feature, not a defect.
  - setupAudio/beat-detector/LRC-sync init on first play is guarded
    (connectedElements WeakSet) and lightweight.
- **Files:** Visualizer.tsx, tools/probes/viz-stems-lazy.mjs (new probe)
- **Acceptance:** headed probe — 0 stems-analysis requests on track load
  (was 1 per select), exactly 1 on inspector Mixer open, still 1 after
  tab revisit and FX-mode switch (per-track dedup), 0 page errors;
  eslint 0 errors; tsc clean for visualizer files.
- **Last session:** Devin (SWE-2 Flash), 2026-11-05 - headed lazy-fetch
  probe + effect-consumer audit.

### T-VIZ-33 — Decompose Visualizer.tsx (1469 → ~1290 lines)
- **Status:** done
- **Goal:** Owner: "break down any large files that are currently hard to
  process." Visualizer.tsx was the largest visualizer file and still
  carried three effect clusters + three JSX islands after the earlier
  hook extractions.
- **What changed:**
  - ``useVisualizerTrackEffects.ts`` (new hook) — the lazy stems fetch,
    auto-play-on-select and resume-across-track-switch effects moved out
    verbatim; ``stemsFetchedRef`` now lives inside the hook.
  - ``components/VizAudioBar.tsx`` — the ``.viz-audio-player`` strip:
    AudioTransport + the visually-hidden ``<audio>`` element with all
    playback event handlers.
  - ``components/VizMixerTab.tsx`` — inspector Mixer tab: pro/simple
    toggle, ProfessionalMixer/StemMixerPanel, Remix Studio link card.
  - ``components/VizPlayhead.tsx`` — the click-to-seek playhead overlay
    (fill, loop region/anchor, marker, readout); self-guards on
    ``audioDuration > 0``.
- **Files:** Visualizer.tsx, useVisualizerTrackEffects.ts (new),
  components/VizAudioBar.tsx (new), components/VizMixerTab.tsx (new),
  components/VizPlayhead.tsx (new)
- **Acceptance:** tsc clean for visualizer files, eslint 0 errors,
  608 visualizer vitest pass, canvas2d Playwright spec 3/3 — no behavior
  change, pure move.
- **Last session:** Devin (SWE-2 Flash), 2026-11-05 - extraction +
  typecheck/lint/vitest/playwright verification.

### T-VIZ-34 — Decompose StemMixer.tsx (989 -> 464 + 546-line hook)
- **Status:** done
- **Goal:** Continue the large-file breakdown - StemMixer.tsx mixed the
  WebAudio stem graph with the panel view in one file.
- **What changed:**
  - ``components/useStemMixer.ts`` (new) - the ``useStemMixer`` hook plus
    its pure helpers moved verbatim: ``StemMixerProps``, ``LoadedStem``,
    ``StemLevels``, ``StemQuality``, ``pickStemUrls``,
    ``gainMapToLinear``, ``computeStemQuality`` and the expected-band /
    FFT-bin energy math. ``React.MutableRefObject`` became a typed
    ``MutableRefObject`` import.
  - ``components/StemMixer.tsx`` keeps the panel view
    (``StemMixerPanel`` + ``EnhanceButton``), the ``STEM_NAMES`` /
    ``StemName`` / ``STEM_VISUAL_ROLE`` re-exports existing importers
    rely on, and re-exports the hook + its types for compatibility.
- **Files:** components/StemMixer.tsx, components/useStemMixer.ts (new)
- **Acceptance:** tsc clean for touched files (only pre-existing
  agent-chat WIP errors remain), eslint 0 errors, 573 visualizer vitest
  pass - pure move, no behavior change.
- **Last session:** completed before per-session logging was enforced on this entry; normalized 2026-11-06 under T-LIB-04.
### T-VIZ-35 — Extract ShaderHud from ShaderVisualizer.tsx (946 -> 789 + 160)
- **Status:** done
- **Goal:** Continue the large-file breakdown - ShaderVisualizer.tsx was
  one ~680-line component mixing the render loop with overlay chrome.
- **What changed:**
  - ``ShaderHud.tsx`` (new) - preset picker dropdown, FX slider panel
    and reset control extracted verbatim; the five repetitive slider
    blocks are now a config-driven map with identical DOM/classes, and
    ``showSelector`` state moved inside (it was HUD-local all along).
  - ``FxValues``/``DEFAULT_FX`` unified into exported
    ``ShaderFxValues``/``DEFAULT_SHADER_FX`` in ShaderHud - the parent's
    read/write-FX helpers and initializers now import the same types
    instead of duplicating the shape.
  - Parent keeps all render-loop state; FX values reach the HUD as one
    grouped ``fx`` object + ``onFxChange`` dispatch, so the persistence
    effect is untouched.
- **Files:** ShaderVisualizer.tsx, ShaderHud.tsx (new)
- **Acceptance:** tsc clean for touched files, eslint 0 errors, 573
  visualizer vitest pass - pure move.
- **Last session:** completed before per-session logging was enforced on this entry; normalized 2026-11-06 under T-LIB-04.
### T-VIZ-36 — Extract KineticTransport from KineticTypographyPage.tsx
- **Status:** done
- **Goal:** Continue the large-file breakdown - the kinetic-typography
  page (~1350 lines) mixed track loading/presets/render orchestration
  with its playback strip.
- **What changed:**
  - ``components/KineticTransport.tsx`` (new) - the transport row
    (restart/play-pause/+5s, scrubber, time readout, mute, volume) and
    the keyboard-hint footer moved verbatim; ``formatTime`` moved with
    them (transport was its only caller). ``elapsedRef`` is passed as a
    prop so the +5s button keeps its no-stale-closure read.
- **Files:** KineticTypographyPage.tsx,
  components/KineticTransport.tsx (new)
- **Acceptance:** tsc clean for touched files, eslint 0 errors (the
  feature has no vitest coverage - pre-existing warnings only).
- **Last session:** completed before per-session logging was enforced on this entry; normalized 2026-11-06 under T-LIB-04.
### T-VIZ-37 — localStorage analysis cache (skip ensure-analysis round-trip on repeat visits)
- **Status:** done
- **Goal:** Owner: "tracks shouldn't need to analyze more than once." Backend already caches (DB + on-disk JSON, verified 0.3 s `status:"cached"` hit), but every page load still paid a network round-trip before presets/beat grid applied.
- **What changed:**
  - ``analysisCache.ts`` (new) - per-file localStorage entries
    (``nma.viz.analysis.<enc>`` → ``{v, savedAt, analysis}``) plus a
    recency index; MAX_ENTRIES=10 (~1.7 MB, under quota), 180-day TTL,
    version-tagged, shape-validated on load, quota-failure eviction +
    retry. Pure storage-agnostic functions so vitest's node env can
    inject a fake Storage.
  - ``useVisualizerState.ts`` - ``analysisData`` now hydrates from the
    cache in the ``useState`` initializer; a write-through effect
    persists only entries whose object identity changed (ref snapshot).
  - ``useTrackSelection.ts`` - ``realBpm`` falls back to the hydrated
    analysis's ``tempo_bpm`` when ``trackMetadata`` is empty, so
    BPM-aware preset selection works on cache hits.
- **Files:** analysisCache.ts (new), analysisCache.test.ts (new),
  useVisualizerState.ts, useTrackSelection.ts
- **Acceptance:** 9 new vitest cases (round-trip, slash keys, corrupt /
  wrong-version / shapeless drops, index pruning, LRU eviction,
  re-save recency, storage-failure false); 595 visualizer tests pass;
  tsc + eslint clean on touched files.
- **Last session:** completed before per-session logging was enforced on this entry; normalized 2026-11-06 under T-LIB-04.
### T-VIZ-38 — Fix dead peak indicators and offscreen reflections in bar modes
- **Status:** done
- **Goal:** Owner: "lets do bar visualizations." Audit of the four
  bar-style Canvas2D modes against the bar-research doc found the
  documented peak/reflection features were present in code but
  non-functional.
- **What changed:**
  - ``renderBars`` - ``state.barPeaks[i] = easedH`` ran BEFORE the
    peak-update block, so ``bh > barPeaks[i]`` was never true and the
    decay branch collapsed to ``max(bh, bh*0.985) = bh``: peak
    indicators were pinned to the bar top forever. Removed the
    clobbering assignment; the existing decay block now works.
  - ``renderMirroredBars`` / ``renderStereoSplitBars`` - same class of
    bug: ``barPeaks[i] = bh`` with no decay path at all, so "peaks"
    were just the current frame's height. Added the standard
    high-water-mark + ``PEAK_DECAY`` update (matching
    ``renderStackedFrequencyBands``, which was already correct).
  - ``drawBar`` reflection - drawn at ``refY = h + 2*dpr``, i.e.
    entirely below the canvas bottom edge and clipped invisible.
    Now hangs below the bar baseline (``y + bh + 2*dpr``); dropped the
    now-unused ``h`` parameter.
  - ``renderBars`` harmonic overlay - fed a raw FFT-bin index into
    ``freqMap`` as if it were a bar index (``t`` ~ 8 pushed every
    sample to the top bin, so the overlay was a flat shimmer, not
    per-bar harmonics). Now samples ``freqMap(i) * 2``, one octave
    above each bar's mapped bin.
  - Removed dead ``barVelocities`` allocations in ``renderBars`` and
    ``renderStackedFrequencyBands`` (allocated, never read or written;
    only ``renderSegmentedLedBars`` uses the field).
- **Files:** canvas2dModes.ts, canvas2dModes.test.ts (new)
- **Acceptance:** tsc -b --force clean project-wide; eslint 0 errors on
  the file (3 pre-existing warnings elsewhere); 597 visualizer tests
  pass. Headed playback verified 2026-11-06: reflections confirmed
  rendering below the baseline via canvas pixel scan (previously
  impossible — clipped offscreen); peak decay proven deterministically
  by canvas2dModes.test.ts (call-recorder ctx asserts the white tick
  floats above the bar top after a spectral drop in both renderBars and
  renderMirroredBars, and that reflection tops stay inside the canvas).
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-VIZ-39 — Fix stacked-frequency-bands index-space bug + invalid color-alpha strings
- **Status:** done
- **Goal:** Owner: "check where else math might be invalid and fix it."
  Full audit of canvas2dHelpers/perceptualScales/particles/canvas2dModes
  after the T-VIZ-38 fixes.
- **What changed:**
  - ``renderStackedFrequencyBands`` - third instance of the index-space
    bug class: ``layer.start + i`` mixed a bin-space layer offset with a
    bar index and fed it to ``freqMap`` (domain 0..barCount-1). Mapper
    output clamped every sample to the top FFT bin, so low/mid/high
    layers all drew identical heights. Now sweeps each layer's spectrum
    fraction by column position (``p*barCount`` stays in domain) through
    the perceptual mapper; beat-glow reuses the sampled top-layer value
    instead of a second arbitrary bin index. Also guards ``step`` and
    ``freqLen`` against 0.
  - ``withAlpha()`` helper (canvas2dHelpers) - ``color + "80"`` only
    yields a valid color for #rrggbb; #rgb shorthand, named, or rgb()
    colors produced invalid fillStyles the canvas silently ignored.
    All 21 ``color + "XX"`` concatenation sites across canvas2dModes,
    Canvas2DVisualizer, and particles.ts now route through it.
  - ``particles.ts`` center-glow alpha byte - ``phraseFlash*40 +
    bass*60`` could exceed 255 and emit a 3-char hex suffix; now clamped
    to a byte.
- **Files:** canvas2dModes.ts, canvas2dHelpers.ts, particles.ts,
  Canvas2DVisualizer.tsx, canvas2dModes.test.ts, canvas2dHelpers.test.ts
- **Acceptance:** tsc -b --force clean; eslint 0 errors (2 pre-existing
  warnings remain in canvas2dModes); 601 visualizer tests pass incl. new
  regression tests: stacked-bands layers provably sample different
  spectrum slices, withAlpha normalizes #rgb/non-hex/undefined inputs.
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-VIZ-40 — WebGPU compute spike: port the GLSL particle layer to TSL (single-layer, gated)
- **Status:** todo
- **Goal:** Measure — on the owner's rig, headed — whether a TSL/NodeMaterial port of the R3F particle layer with its update in a WebGPU compute pass beats or out-capabilities the WebGL/GLSL baseline, behind the existing WebGPU opt-in. A written negative result is a valid, complete outcome.
- **Files:** new spike module under `packages/frontend/src/features/visualizer/webgpu/`; the particle layer under `viz-styles/` (exact file confirmed during the step-1 baseline); switch point in `VisualizerScene.tsx` only if the verdict is merge.
- **Plan:** Research: `docs/knowledge/browser-tech-transfer-2026-11-05/README.md` §2.2 + §3. Steps: (1) headed baseline — frame-time p95 at DPR cap + draw calls (RenderStatsBadge) for a particle-heavy scene on WebGL, recorded in this item; name the exact particle-layer file(s). (2) Port that one layer to TSL with a compute-pass update, gated by `isWebGPUOptIn()`; no other layer touched — the backdrop dome is out of scope. (3) Headed A/B on the same track + scene, opt-in on vs off: no black-screened layers; frame time against the T-VIZ-18 budget (20 ms p95); note the particle-count ceiling each path sustains. (4) Verdict written into this item with the numbers: merge, iterate, or negative result (spike code removed, finding kept). (5) If merged: TSL has no repo compile gate — add a smoke check per `docs/guides/visualizer-debug.md` so the port cannot rot silently.
- **Acceptance:** Baseline and A/B numbers recorded in this item; opt-in off = zero behavior change (existing visualizer tests pass); opt-in on = no black-screen layers in the ported scene; decision recorded with evidence. Non-goals: no library-wide GLSL→TSL port, no default flip away from WebGL, no ShaderCanvas-lane or Canvas2D work.
- **Depends on:** gate cleared — T-VIZ-15/16/18/19 landed 2026-11-05/06, so the data contracts and governor this spike is judged against already exist.
- **Last session:** Orion, 2026-11-05 — item registered together with the browser-tech-transfer research doc (same commit); no code touched.

### T-VIZ-41 — Shared AudioContext + Tier 2 per-frame chroma palette
- **Status:** done
- **Goal:** Close the two visualizer/audio loose ends: app-wide
  AudioContext consolidation (D4 follow-up) and Q5 Tier 2 per-frame
  chroma-driven hue shifts.
- **What changed:** New `packages/frontend/src/shared/audioContext.ts` singleton
  (`getSharedAudioContext`, closed-context recovery) replaces ad-hoc
  `new AudioContext` — every former site (BeatTimeline, StemMixer +
  ProfessionalMixer fallbacks, useTrackManager, AudioVisualizer,
  audioProbe) now goes through the singleton; `packages/frontend/src/shared/audioContext.ts`
  is the only `new AudioContext` left in `src/` and self-heals a closed
  context. The visualizer-owned graph in `useAudioGraph` remains the
  canonical owner for playback routing.
  Tier 2 chroma: `tools/audio-analysis/analyze.py` and
  `tools/audio_agent_profile.py` emit bounded `chroma_frames` (~2 fps,
  normalized 12-bin pitch-class vectors + per-frame confidence) with
  `chroma_times`/`chroma_frame_hz`; `audio.py` passes the field through
  on both analysis response builders. Frontend: `chromaHueAtTime` in
  `keyPalette.ts`, time-aware `useKeyPalette`, `u_chroma_hue` uniform
  wired through ShaderVisualizer → ShaderCanvas (both render paths) →
  `spectralReactor` in shaders.ts. Tier 1 key-derived hue remains the
  fallback for missing/malformed/low-confidence chroma. Payload is
  additive — pre-Tier-2 cached analyses stay valid (no schema bump).
- **Files:** packages/frontend/src/shared/audioContext.ts (new), components/audio/{BeatTimeline,
  AudioVisualizer}.tsx, features/three-js-studio/hooks/useTrackManager.ts,
  features/visualizer/{useKeyPalette,keyPalette,shaders,ShaderVisualizer}.ts(x),
  features/visualizer/components/{ShaderCanvas,useStemMixer}.tsx,
  professionalMixer/useProfessionalMixer.ts, utils/audioProbe.ts,
  tools/audio-analysis/analyze.py, tools/audio_agent_profile.py,
  api/audio.py, keyPalette.test.ts, docs/architecture/chroma-hue-mapping.md.
- **Verification:** vitest keyPalette.test.ts 38/38 pass (dominant
  pitch-class mapping, empty windows, confidence thresholds, out-of-range
  times, malformed data, nonzero t0); tsc -b clean; python compile clean.
  Note: chroma_frames is produced by the tools/audio-analysis pipeline
  that writes `{id}_analysis.json`; the live API analyzer
  (`_build_analysis_result`) does not compute chroma — same boundary as
  key detection today, and the Tier 1 fallback covers it.
  UPDATE (T-AUD-14): `_key_and_chroma_features` in audio_analyzer.py now
  emits key + chroma_frames for every backend, so the live API path
  produces the same payload — schema bumped to v3.
- **Acceptance:** satisfied at completion (entry predates the R1 field requirement; normalized 2026-11-06 under T-LIB-04).
- **Last session:** Devin, 2026-11-06 - implementation swept into `8b322e70`; audioContext singleton + shader texture2D fix in the follow-up commit.

### T-VIZ-42 — Stage chrome deconfliction: dead Warp clicks, top-right triple-booking, z-ladder doc

- **Status:** done
- **Goal:** Owner report — "clicking Warp does nothing" plus overlapping
  chrome with no hierarchy. Line-by-line review of Visualizer.tsx,
  ShaderHud.tsx, ShaderVisualizer.tsx and both stylesheets, verified live
  in headless Chromium (patchright) with real mouse hit-testing.
- **What changed:**
  - Root cause of the dead Warp click: with the More/shortcuts overlay
    open, `.viz-page[data-viz-overlay] .viz-shader-hud` was demoted to
    z-10 — under the z-150 scrim. The HUD stayed *visible* but every click
    hit `.viz-overlay-scrim` (verified via elementFromPoint), which merely
    dismissed the overlay. Now `display:none` — no ghost layer. First
    attempt failed silently: globals.css imports this file into
    `@layer(components)` while Tailwind utilities live in
    `@layer(utilities)`, and layered utilities beat layered components
    regardless of specificity — the `flex` class kept display:flex alive.
    `display:flex` moved onto `.viz-shader-hud` itself and `flex` removed
    from the element's class list.
  - Top-right was triple-booked: ShaderHud (FX mode), StylePicker (3D),
    and the AudioLatencyCard+stats stack (always) all claimed
    top-right; the z-40 card buried the z-10 picker. Latency/stats moved
    to `top-3 left-3` — pointer-events-none telemetry on the free corner;
    left/right separation survives short stages where bottom-right
    collided with the HUD (verified: 9px overlap at 720p before the move).
  - `.viz-style-picker` z-index 10 → 40 (stage-chrome tier).
  - Z-index ladder documented in a header comment in visualizer.css
    (10 content → 40 chrome → 100 debug → 150 scrim → 160 interactive
    chrome → 200 menus).
- **Files:** features/visualizer/{ShaderHud.tsx,Visualizer.tsx},
  styles/{visualizer.css,visualizer-chrome.css}.
- **Verification:** live session — warp dropdown opens, "Deep Calm"
  pins (label updates), HUD hides (computed display:none) under More
  overlay and restores (display:flex) on dismiss; HUD/latency rects no
  longer intersect; tsc -b clean; eslint 0 errors (pre-existing warnings).
- **Acceptance:** satisfied at completion.
- **Last session:** Devin, 2026-11-07 — live-verified fix; note the
  Tailwind cascade-layer trap for future display overrides in this file.

### T-VIZ-43 — Stage chrome hierarchy: inspector consolidation, QuickPresetBar shader dedupe

- **Status:** done
- **Goal:** Owner report — "a lot of overlapping elements fighting for
  attention", "layout can't fit everything", "no sense of hierarchy".
  Design pass on top of T-VIZ-42's corner deconfliction.
- **What changed:**
  - Stage-level `StylePicker` column (3D) and floating `ReactivityHUD`
    (bottom-left) removed — both were duplicates of inspector panels.
    `StylePicker` now renders at the top of the inspector Scene tab;
    `ReactivityHUD` was already the Tuning tab content. One canonical
    home per control.
  - `.viz-inspector .viz-style-picker` neutralized to static flow
    (position/max-height/overflow/margin reset) so stage absolute rules
    can't leak into the dock; focus-mode fade rules for the stage picker
    deleted; `.viz-style-picker` removed from the chrome-hidden opacity
    list since it no longer lives on stage.
  - `QuickPresetBar` hidden in shader mode — ShaderHud already carries
    the full preset list + FX + warp, so the bar was a duplicate surface
    colliding with the HUD on narrow stages.
  - `__VIZ_TEST__.setStyle(style)` added to the dev harness
    (useVisualizerLifecycle) since capture scripts could no longer click
    the inspector-hidden StylePicker; both record-geometric.mjs copies
    updated to drive the harness.
- **Files:** features/visualizer/{Visualizer.tsx,
  useVisualizerLifecycle.ts}, styles/{visualizer.css,
  visualizer-chrome.css}, tests/browser{,/capture}/record-geometric.mjs.
- **Verification:** live collision audit at 1600x900 across all three
  modes — zero overlapping chrome rects; inspector picker position
  static, ~285px wide inside the 320px dock; shader HUD the only
  top-right owner in FX; tsc -b clean.
- **Acceptance:** satisfied at completion.
- **Last session:** Devin, 2026-11-07 — hierarchy pass landed; stage now
  carries only glanceable telemetry + one-click presets.

### T-VIZ-44 — Baseline declutter pass driven by vision audit

- **Status:** done
- **Goal:** Owner: "the current baseline still looks wonky" — run the
  vision pipeline (T-MOD-05-fixed) against the default 3D/geometric
  baseline and fix what it reports.
- **What changed:**
  - `geometric.tsx` — wireframe icosahedron detail 2 → 1 (320-face
    lattice read as noise); orbital spiral 420 → 300 points; outer
    InstancedParticles 1000 → 620 with hueRange 0.2 → 0.12, baseSize
    0.08 → 0.10, stretch 1.5 → 1.2 (tighter hue band, fewer larger
    quads = designed shell instead of chaotic field).
  - `visualizer-chrome.css` — track `<select>` had collapsed to ~202px
    (vision read the clipped "night-drive (83 BPM)" as obscured by the
    Enhance button): selector cap 500 → 640px, select
    min-inline-size 240px. Measured: select 202 → 292px.
- **Files:** viz-styles/geometric.tsx, styles/visualizer-chrome.css.
- **Verification:** live captures before/after at t≈5/10/11.6s of
  night-drive.wav through `__VIZ_TEST__`; gemma4 audit flagged dense
  wireframe + saturated particle chaos + clipped track name — all three
  addressed; post-fix audit reported no visible defects (model grading
  is soft, so geometry was verified by measurement instead).
- **Acceptance:** satisfied at completion.
- **Last session:** Devin, 2026-11-07 — vision-loop improvement pass;
  BuilderFigure silhouette confirmed as intentional toggleable layer,
  not a defect.

### T-VIZ-45 — Track-select whiplash: real cover transition + figure mount fade

- **Status:** done
- **Goal:** Owner report — selecting a track "fires a preset all of a
  sudden", things snap onto the canvas, especially the figure.
- **Root cause:** `handleSelectLibraryTrack` applied the whole preset
  bundle (kinetic + vizParams + bg + mesh + style + preset id) in ONE
  batch and pulsed `modeFade` for only 220ms. The fade started fading IN
  the same frame the new style/colors mounted — the black never covered
  the swap, so every track change was a hard cut. Style change remounts
  the entire R3F scene; BuilderFigure mounts/unmounted instantly too.
- **What changed:**
  - `useTrackSelection.ts` — two-phase transition: `setModeFade(1)`,
    cover fully (380ms > the 300ms CSS fade-in), apply the bundle under
    full black, reveal 80ms later. Stale-request and manual-preset-lock
    guards re-checked inside both timeouts so a quick second selection
    can't be clobbered or prematurely revealed.
  - `visualizer-chrome.css` — `.viz-builder-figure` gets a one-shot
    `viz-builder-in` keyframe (0.7s ease-out, fade + 14px rise) since it
    returns null when hidden and snapped into existence.
- **Files:** features/visualizer/useTrackSelection.ts,
  styles/visualizer-chrome.css.
- **Verification:** live probe sampling `.viz-mode-fade` opacity across
  a track switch — cover engages (opacity 1) then reveals (0) across
  the ~800ms window; tsc -b clean.
- **Acceptance:** satisfied at completion.
- **Last session:** Devin, 2026-11-07 — note: BuilderFigure's flat
  silhouette is deliberate art direction (character bible, near-black +
  accent rim); "no textures" is by design. Richer figure animation is a
  separate redesign task if wanted.

### T-VIZ-46 — BuilderFigure render pass: volume, set dressing, idle drift

- **Status:** done
- **Goal:** Owner report — character render is "poorly animated with no
  textures". Improve via vision + line-by-line review.
- **Review findings (BuilderFigure.tsx, all 587 lines):** body pass was
  flat `#050508` (zero internal volume); lamp glowed but never lit the
  figure; bench/lamp were one flat fill with no tonal separation; no
  floor contact shadow; `rootX`/`rootY` never drifted so idle read
  mannequin-stiff. LIMB proportions left frozen per character bible.
- **What changed:**
  - `drawFigure` pass stack now 4 layers: accent halo → lamp-offset
    accent wash (+1.4,-1.4px, energy/pulse-scaled alpha) → near-white
    edge → vertical gradient body (`#34345c` shoulders → `#06060f`
    feet) replacing flat BODY.
  - Static layer (`buildStatic`): tonal separation (lit bench top
    `#0b0b14`, shaded legs `#040408`), lamp bulb `#7aa2e8`, workpiece
    on bench, radial floor contact shadow.
  - Idle life: `driftX`/`driftY` slow sine pairs on root position
    (±2.9px / ±1.1px), zero under `calm`.
- **Files:** features/visualizer/components/BuilderFigure.tsx.
- **Verification:** canvas exported raw + 3x-upscaled; gemma4 vision —
  at 1x "no shading" (240px below model threshold), at 3x confirms
  "visible shading: yes, reads as person: yes". Pixel probe confirms
  torso ~(36,36,68) vs legs ~(15,15,33). tsc -b + eslint clean
  (2 pre-existing `??` warnings).
- **Acceptance:** satisfied at completion.
- **Last session:** Devin, 2026-11-07 — commit pending.
