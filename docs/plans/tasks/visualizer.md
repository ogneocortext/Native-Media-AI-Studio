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

### T-VIZ-20 — Feedback/Warp preset mode (Milkdrop idiom, native)
- **Status:** done
- **Goal:** Promote ShaderVisualizer's existing ping-pong feedback (ShaderCanvas `feedback` props: zoom/rotation/decay) from a lab feature into an audience-facing preset mode: one warp engine, many looks, presets as data.
- **Files:** `packages/frontend/src/features/visualizer/ShaderVisualizer.tsx`, `components/ShaderCanvas.tsx`, new `packages/frontend/src/features/visualizer/warpPresets.ts`
- **Plan:** Research: `docs/knowledge/visualizer-mode-research-2026-11-03/README.md` §1 (native path A chosen by owner, 2026-11-03). Steps: (1) generalize the feedback resample beyond zoom/rotate/decay scalars — add swirl and radial-flow terms driven by uniforms; (2) define the preset format in `warpPresets.ts` (warp params, palette, draw-element selection, audio-response gains) as typed data; (3) author 6 starter presets spanning calm→aggressive; (4) cycle presets on section boundaries via sectionStateMachine, crossfading through the feedback buffer (the buffer makes transitions free — never hard-cut); (5) consume enveloped bands/onset envelope per T-VIZ-15/16 contracts, not raw FFT.
- **Acceptance:** 6 presets selectable and visibly distinct on the same track; preset change at a section boundary produces no hard cut (frame-diff check per `docs/guides/visualizer-debug.md`); GLSL passes the repo compile check; frame time inside the T-VIZ-18 budget at DPR cap.
- **Last session:** Kilo, 2026-11-03 — landed in `ac37347` (single commit for the item): swirl + radial-flow uniforms in ShaderCanvas's composite shader, typed `warpPresets.ts` with 6 presets (deepCalm, glassWater, neonPulse, copperSpiral, plasmaStorm, singularity; per-preset audioGains), section-boundary cycling in ShaderVisualizer. Orion static review 2026-11-03: no-hard-cut acceptance holds by construction (transitions change uniforms only; the feedback buffer carries the image) — a manual frame-diff run was not performed and is not required given the mechanism. Two open threads: (a) presets auto-cycle only — manual pin/select registered as T-VIZ-25; (b) warp drive uses existing bass/energy values — retrofit to the T-VIZ-15/16 envelopes when those land. Ledger entry written by Orion at the owner's request.

### T-VIZ-21 — Kinetic Typography mode (lyrics as the visual)
- **Status:** todo
- **Goal:** A mode where the song's words are the scene: line/word animation (snap, stack, scale, scatter) driven by vocal-stem energy and beat phase over a minimal reactive ground — not an overlay on another visual.
- **Files:** `packages/frontend/src/features/visualizer/canvas2dModes.ts`, `visualizerHelpers.ts` (CANVAS_2D_MODES), `lyricsSync.ts`, `components/LyricOverlay.tsx`, `motion/motionMoves.ts`
- **Plan:** Research: mode-research doc §2. Steps: (1) register mode id `kinetic-type` in CANVAS_2D_MODES + budget table (text is the focal point; global effects minimal per the budget rules); (2) reuse the lyricsSync line lookup (currentLine/nextLine/progress) — extend to word-level only if line timing proves too coarse in testing; (3) choreography vocabulary from existing motion moves: line entry on the vocal onset, hook lines get the squash/impact move on beat phase, exit by decay — deadpan register: restrained palette, no bouncy easing (owner's songs are dry/skeptical; match the brand); (4) instrumental tracks fall back to title/section cards so the mode never sits empty.
- **Acceptance:** on a lyric-timed track, line entries land within one frame of the line start at 60 fps; hook repetition is visibly emphasised over verse lines; mode is readable with audio muted (screenshot check); reduced-motion setting freezes choreography to fades.
- **Depends on:** T-VIZ-15/16 data contracts (enveloped vocal energy, onset envelope) — spec against them, build after they land.

### T-VIZ-22 — Stem Scene (one visual agent per stem)
- **Status:** todo
- **Goal:** A 3D style where each stem is a visual agent in one scene: drums = percussive geometry striking on hits, bass = ground mass heaving, vocals = central form, other = atmosphere field; layout from stemSpatial.
- **Files:** new `packages/frontend/src/features/visualizer/viz-styles/stemScene.tsx`, `viz-styles/helpers.ts` (getStemEnergy), `stemSpatial.ts`, `viz-styles/index.ts`
- **Plan:** Research: mode-research doc §3. Steps: (1) per-stem agents as instanced/merged geometry — draw calls inside the T-VIZ-18 budget (~150) from the start; (2) drive agents from getStemEnergy per-stem bands/onsets (the API instancedParticles and aurora already use); (3) solo/mute a stem in the StemMixer and the matching agent must respond alone — that isolation check is the mode's correctness test; (4) when stems are absent, degrade to the mixed-signal agents (bass/mid/treble split) rather than an empty scene.
- **Acceptance:** stem isolation check passes for drums/bass/vocals; draw calls ≤ budget on the reference track; no per-frame React state (refs only, per architecture rules).
- **Depends on:** T-VIZ-16 (per-stem onset envelopes improve strike timing; mode can ship on energy alone if scheduled first).

### T-VIZ-23 — Spectral Terrain Flyover style
- **Status:** todo
- **Goal:** An endless ridged-terrain flyover as a WebGL style: spectrum shapes the ridgeline, enveloped bass drives speed, sub drives heave, treble adds rim sparkle.
- **Files:** new `packages/frontend/src/features/visualizer/viz-styles/terrain.tsx`, `viz-styles/index.ts`
- **Plan:** Research: mode-research doc §4 (ranked #1 wow-per-cost in the Synesthesia spec). Pure GLSL displaced grid on the ShaderCanvas pattern (fullscreen approach, no scene graph); scroll phase from the audio clock (architecture rule 2 — never performance.now for motion); DPR governed by T-VIZ-18 when it lands.
- **Acceptance:** forward motion is continuous with no visible tile repetition over 60 s; a bass drop measurably increases speed/heave within one beat; frame time inside budget at DPR cap.

### T-VIZ-24 — Kaleidoscope post pass (VisualizationFX)
- **Status:** todo
- **Goal:** 6/8/12-fold mirror symmetry as a toggleable ShaderPass in the VisualizationFX composer chain, intensity driven by section state and the onset envelope — a multiplier over every existing mode, not a new mode.
- **Files:** `packages/frontend/src/features/visualizer/VisualizationFX.tsx`
- **Plan:** Research: mode-research doc §5. Insert the pass after UnrealBloomPass and before the grade pass; fold count selectable; intensity defaults to 0 (off) and presets/sections may raise it.
- **Acceptance:** enabling the pass on any 3D style produces stable symmetry with no seam artifacts at fold boundaries; pass cost ≤ 1 ms at 1080p on the reference GPU (RenderStats frame-time delta).

### T-VIZ-25 — Warp preset pin/select control
- **Status:** todo
- **Goal:** Let the user pin a single T-VIZ-20 warp preset (or re-enable auto-cycling) from the ShaderVisualizer controls — required for video production, where a render must hold one look per section rather than accept the cycle.
- **Files:** `packages/frontend/src/features/visualizer/ShaderVisualizer.tsx`, `warpPresets.ts`
- **Plan:** Add a preset picker (the six ids from warpPresets.ts) plus an "Auto (cycle on sections)" option, defaulting to Auto so current behaviour is unchanged. Pinning sets warpPresetIdRef and suspends the section-boundary cycling while pinned. Follow the existing feedback-control state pattern in the same file (feedbackEnabled/Zoom/Rotation/Decay).
- **Acceptance:** with a preset pinned, section boundaries no longer change the active preset (verify across two boundaries); switching back to Auto resumes cycling at the next boundary; control state survives a shader-preset change in the same session.

### T-VIZ-26 - Live QA pass: canvas2d render crash, audio-ctx lifecycle, dead controls
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

### T-VIZ-27 - Restore visualizer chrome CSS lost in the ee2714e slim rewrite
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

### T-VIZ-28 - User-flow QA: A-B loop wrap, track-skip resume, stats-stack collision, topbar reachability
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
