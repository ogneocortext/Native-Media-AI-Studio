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

