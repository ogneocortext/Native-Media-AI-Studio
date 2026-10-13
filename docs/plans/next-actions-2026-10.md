# Next Actions — Oct 2026 (post viz-motion review)

**Status:** Proposed 2026-10-12 — awaiting owner review
**Decides:** none (status reconciliation + sequencing; no new architecture)
**Owner:** repo owner (implementation: local coding agent)
**Approved:** (pending)

## 1. Where things stand (reviewed 2026-10-12)

Remote `origin/main` is **3 commits ahead** of the Oct 6 plans baseline —
local checkouts must `git pull` before any new work:

- `3686d55` (Oct 11) `feat(visualizer)`: frame-snapshot PNG capture (More
  menu), A-B loop region (L key / More menu, latency-compensated), FX shader
  preset improvements (beat-quantized motion, idle motion, organic drift,
  highlight rolloff, density fixes from the vision audit).
- `5d6ac8b` (Oct 11) `feat(visualizer)`: shared `vizMotion.ts` module —
  `attackRelease` (frame-rate-independent envelope), `beatSnap` (quantizes
  continuous `beatPhase` into a grid-locked spike), `energyHue` (cool blue
  at rest → warm orange-red at full energy), `rolloff` (`1 - exp(-x·k)` so
  loud frames keep detail under bloom) — applied across all 15 Three.js
  styles, plus a declutter pass (geometric, neural, cosmic, inferno, storm)
  and a decision-log entry. Gates (type, lint, unit) pass; six weakest
  styles re-captured and vision-checked.
- `ef6ae78` (Oct 11) `docs(agents)`: bootstrap points at project skills.

### Plan-vs-reality reconciliation

**studio-quality-2026-10.md** (visualizer 2.x lane):

| Item | Plan said | Reality 2026-10-12 |
|---|---|---|
| 2.7 wire motion vocabulary | Open | **Done** — `vizMotion.ts` applied to all 15 styles |
| 2.4 motion vocabulary (old `motion/` modules) | Half-built, zero consumers | **Superseded** — `vizMotion.ts` replaces `motionEasing.ts` / `motionMoves.ts` / `useMotionDriver.ts`; old modules are dead code → remove |
| 2.6 color/feel polish | Open | **Partial** — `energyHue` done; remainder open |
| 2.8 beat anticipation (predictive) | Open | **Partial** — `beatSnap` quantizes; true look-ahead prediction not built |
| 2.9 deterministic frame-accurate export | Open | **Partial** — PNG still snapshot only |
| 2.2 reactivity triad UI | Open | **Open** — biggest user-facing gap (processor exists internally, no panel) |
| 2.3 genre reactivity presets | Open | **Open** |
| 2.5 latency budget, visible | Open | **Open** — `RenderStats` still fps/calls/triangles only |
| 2.10/2.11 real-time data correctness | Open | **Open** |

**three-js-motion-features-2026-10.md** (F-sequence F3 → F1 → F4 → F2 → F5):

| Item | Reality 2026-10-12 |
|---|---|
| F3 render-loop easing utilities | **Done** — `vizMotion.ts` |
| F1 eased camera transitions | Open |
| F4 beat-phrased animation (anticipation) | Partial — quantization only, not prediction |
| F2 section-aware motion driver | Open |
| F5 deterministic frame-accurate export | Partial — snapshot only |

**remix-mashup-2026-10.md:** untouched, still **Proposed** — owner approval
required before any build.

## 2. Next course of action

### Step 0 — Sync and verify (no new code)
1. `git pull` — local is 3 commits behind `origin/main`.
2. Run gates (type, lint, unit) on the merged tree; confirm green.
3. Windows-only: re-capture the 15 styles mid-track; confirm the six
   weakest (geometric, neural, storm, vinyl, aurora, three-particles)
   still read fixed after the merge.

### Step 1 — Reconcile the docs (small docs commits)
1. `studio-quality-2026-10.md`: mark 2.7 **Done** (+ build notes), 2.6 /
   2.8 / 2.9 **Partial**, 2.4 **Superseded** by `vizMotion.ts`.
2. `three-js-motion-features-2026-10.md`: mark F3 **Done** (+ build notes),
   F4 / F5 **Partial**; set plan status to **In progress** (it is being
   built from — approval implied by merged work).
3. Remove dead `motion/` modules (`motionEasing.ts`, `motionMoves.ts`,
   `useMotionDriver.ts`) — first check no test or import still references
   them; if any do, migrate the reference, then delete.

### Step 2 — Visualizer lane, in this order (user-facing gaps first)
1. **2.2 reactivity triad UI** — the sensitivity processor already exists
   internally (`audioReactivityProcessor.ts`); build the user-facing panel.
   This is the largest visible gap.
2. **2.3 genre reactivity presets** — extend the existing genre-matching
   pattern (currently kinetic lyric presets only) to reactivity.
3. **2.5 latency budget, visible** — extend `RenderStats` beyond
   fps/calls/triangles so the latency budget is observable.
4. **2.8 proper (predictive anticipation)** — `beatSnap` quantizes the beat;
   build look-ahead so motion *leads* the beat instead of landing on it.
5. **2.9 deterministic frame-accurate export** — graduate the PNG snapshot
   into a recorded export of the visualizer page.
6. **2.10 / 2.11 real-time data correctness** — plumb real BPM + beat grid
   into the reactivity processor; live FFT fallback when the spectral
   timeline is absent.

### Step 3 — Motion lane remainder
F1 (eased camera transitions) → F2 (section-aware motion driver) →
complete F4 / F5 (prediction + deterministic export).

### Step 4 — Remix / mashup (gated)
Plan is **Proposed** and untouched — **do not build until the owner
approves**. Suggested sequence when approved: job tracking → richer
source discovery → local-Ollama prompt-to-recipe (draft/review/build) →
MCP `remix_*` tools → tone shaping + structured warnings → frontend
entry point and controls.

## 3. Decisions needed from the owner
1. Approve this sequencing (Step 2 order) or reprioritize.
2. Approve the remix/mashup plan for build, or defer it.
3. Dead-code call: remove the old `motion/` modules (recommended) or keep.

## Build notes
*(appended when implemented)*
