# Tasks — Visualizer

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.4
Rules: `docs/plans/tasks/README.md` — **the §2 refactor protocol applies
to every item here: tag first, ledger report after.**
Module map: `docs/architecture/visualizer.md` (D14). Never touch
`unity-visualizer/`.

### T-VIZ-01 — Tag + decomposition plan for Visualizer.tsx
- **Status:** doing
- **Goal:** `pre-refactor` tag placed; a written slice plan exists that
  splits Visualizer.tsx (≈104 KB) into ≤40-minute items in this file.
- **Files:** packages/frontend/src/features/visualizer/Visualizer.tsx
- **Acceptance:** Tag exists on the remote; slice items T-VIZ-02+ written
  with files + acceptance each.
- **Last session:** Cline, 2026-10-26 — tag `pre-refactor-2026-10-26` placed.
  File read in full (2,475 lines). Slice plan written below:

**Slice plan — Visualizer.tsx decomposition (each ≤40 min):**

1. **T-VIZ-02 — Extract `useVisualizerState` hook** — All `useState`/`useRef`
   declarations (bgColor, meshColor, audioUrl, currentFilename, isPlaying,
   isPaused, error, libraryFiles, liveAudioData, adaptiveDpr, renderStats,
   aiEnhancing, openOverlay, activeVisualPresetId, activeShaderPreset,
   reactivityGain, frequencyFocus, reactivityTriad, activeGenrePresetId,
   stemsMixerState, proMixerMeters, useProMixer, elapsed, audioDuration,
   vizParams, perceptualScale, kineticPreset, loadedPreset, visualizationStyle,
   vizMode, canvas2DMode, sceneFrozen, prefersReducedMotion, showTestPanel,
   pendingTrack, showSettings, showAnimDemo, showTheatreStudio, showExportModal,
   showAIPanel, visualsVisible, lyricsVisible, characterVisible). Returns
   state + setters + refs. Files: new `useVisualizerState.ts`, Visualizer.tsx.
   Acceptance: same state surface, zero behavior change; tsc + vitest pass.

2. **T-VIZ-03 — Extract `useTrackSelection` hook** — `handleSelectLibraryTrack`
   (170 lines), `handleFile`, `resetAudioDerivedState`, `trackRequestRef`,
   `visualPresetLockRef`, `userPickedGenrePresetRef`, `userPickedVizModeRef`,
   analysis/stems/lyrics loading, auto-apply preset logic. Files: new
   `useTrackSelection.ts`, Visualizer.tsx. Acceptance: track select/load
   behaves identically; `handleSelectLibraryTrack` no longer in Visualizer.tsx.

3. **T-VIZ-04 — Extract `useVisualizerPlayback` hook** — playback rAF loop
   (elapsed tracking, beat latch, LRC live sync), pause sync, blob URL
   cleanup, unmount cleanup, `togglePlayPause`, `cycleVizMode`, loop A-B.
   Files: new `useVisualizerPlayback.ts`, Visualizer.tsx. Acceptance:
   playback/seek/loop behaves identically; tsc + vitest pass.

4. **T-VIZ-05 — Extract `useVisualPresets` hook** — `applyPreset`,
   `handleVisualPresetSelect`, `handleClearPreset`, `deriveTrackMeta`,
   `handlePresetLoaded`, reactivity triad persistence, genre presets,
   `visualPresetLockRef`. Files: new `useVisualPresets.ts`, Visualizer.tsx.
   Acceptance: preset apply/clear/visual-preset-select behaves identically.

5. **T-VIZ-06 — Extract `useVisualizerUI` hook** — overlay state
   (shortcuts/more/fx), outside-click dismisser, keyboard shortcuts map,
   mode crossfade, prefers-reduced-motion, test panel, `__VIZ_TEST__` harness.
   Files: new `useVisualizerUI.ts`, Visualizer.tsx. Acceptance: keyboard
   shortcuts and overlays behave identically.

6. **T-VIZ-07 — Extract JSX sub-components** — `VisualizerHeader` (topbar +
   track selector + analyze/enhance buttons), `VisualizerStage` (canvas +
   shader/2D + letterbox + BuilderFigure + QuickPresetBar + ReactivityHUD),
   `VisualizerFooter` (spectrum + beat dot), `VisualizerAudioPlayer`
   (transport + mixers + EQ + RemixPanel), `VisualizerEmptyState`,
   `VisualizerExportModal`, `VisualizerTestPanel`. Files: new
   `components/` sub-files + Visualizer.tsx. Acceptance: render output
   identical; snapshot/playwright canvas2d.spec.ts passes.

7. **T-VIZ-08 — Compose thin `Visualizer()` orchestrator** — wires hooks +
   sub-components, no state of its own. Acceptance: Visualizer.tsx reduced
   to ~200-300 lines; tsc + vitest + canvas2d.spec.ts + lrc-visualizer.spec.ts
   all pass.

**Ledger §3.4 checkpoints after each slice:** track-change reset, naming
rules, HUD/presets unchanged — verified item by item.

### T-VIZ-02 — Decompose Canvas2DVisualizer.tsx
- **Status:** todo
- **Goal:** Canvas2DVisualizer.tsx (≈83 KB) split per the D14 module map
  (split into sequenced items first if it exceeds the size rule).
- **Files:** packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx
- **Acceptance:** Ledger §3.4 reported item by item after the work —
  track-change reset, naming rules, HUD/presets unchanged.
- **Last session:** —
