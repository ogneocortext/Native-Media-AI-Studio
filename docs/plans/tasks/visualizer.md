# Tasks — Visualizer

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.4
Rules: `docs/plans/tasks/README.md` — **the §2 refactor protocol applies
to every item here: tag first, ledger report after.**
Module map: `docs/architecture/visualizer.md` (D14). Never touch
`unity-visualizer/`.

### T-VIZ-01 — Tag + decomposition plan for Visualizer.tsx
- **Status:** done
- **Goal:** `pre-refactor` tag placed; a written slice plan exists that
  splits Visualizer.tsx (≈104 KB) into ≤40-minute items in this file.
- **Files:** packages/frontend/src/features/visualizer/Visualizer.tsx
- **Acceptance:** Tag exists on the remote; slice items T-VIZ-02+ written
  with files + acceptance each.
- **Last session:** Cline, 2026-10-26 — tag `pre-refactor-2026-10-26` placed
  and pushed to remote. File read in full (2,475 lines). Slice plan written
  with 7 slices (T-VIZ-02–T-VIZ-08), each with files + acceptance.

### T-VIZ-02 — Extract `useVisualizerState` hook
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

### T-VIZ-02 — Decompose Canvas2DVisualizer.tsx
- **Status:** todo
- **Goal:** Canvas2DVisualizer.tsx (≈83 KB) split per the D14 module map
  (split into sequenced items first if it exceeds the size rule).
- **Files:** packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx
- **Acceptance:** Ledger §3.4 reported item by item after the work —
  track-change reset, naming rules, HUD/presets unchanged.
- **Last session:** —
