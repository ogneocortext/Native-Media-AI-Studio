# Next Actions — Oct 2026 (post viz-motion review)

**Status:** Proposed 2026-10-12 — awaiting owner review (updated 2026-10-13)
**Decides:** none (status reconciliation + sequencing; no new architecture)
**Owner:** repo owner (implementation: local coding agent)
**Approved:** (pending)

## 1. Where things stand (reviewed 2026-10-13)

Remote `origin/main` at `ae9d188`. Thirteen commits landed since the
2026-10-12 review (via merge `801c99c`):

Visualizer lane:
- `1bf5ca7` (Oct 13) `feat(visualizer)`: **Plan 2.2 reactivity triad** —
  `audioReactivityProcessor` gains asymmetric attack/release smoothing, a
  sensitivity master gain, and a beat (transient) response knob, surfaced by
  a new `ReactivityHUD` and `QuickPresetBar`. Also **Plan 2.5**: `RenderStats`
  now reports `audioToVisualMs` (audio→visual pipeline latency, 20–40 ms
  target band). Playwright specs hardened — assertions read the real
  `window.__VIZ_TEST__` harness instead of always-true polling.
- `ae9d188` (Oct 13) `test(visualizer)`: unit coverage for the last three
  pure modules; unflaked the doc-checker self-test.

Backend / infra fixes:
- `0f63e22` / `bb09e42` `fix(separation)`: `DEMUCS_MAX_SEGMENT_SECONDS`
  typo that broke every separation with a `segment_size`.
- `370efc3` `fix(api)`: shell-out handlers offloaded to threads —
  `POST /api/hyperframes/render`'s 600 s timeout was freezing the event
  loop (including the SSE health stream) for up to ten minutes.
- `d022374` `fix(gitignore)`: restored `check_ports.ps1` re-include so the
  layout gate passes.
- `a789a04` `docs(gates)`: stale-path-reference checker (D39).
- `923241b` `docs(reliability)`: logged the demucs fix and the disproved
  event-loop hypothesis.
- Chores: `ports.json` owns AI-service URLs, job-store selector scoping
  (perf), Atomic Chat health probe, JSON normalization (encoding/EOL).

**Agent trailer note:** `1bf5ca7` carries `Co-authored-by: Cline` — the local
agent is now Cline (Desktop), not Ling/Kilo. The AGENTS.md attribution table
still lists Ling 3.1 Flash; the owner should update it if the switch is
permanent.

### Plan-vs-reality reconciliation (updated 2026-10-13)

**studio-quality-2026-10.md** (visualizer 2.x lane):

| Item | Reality |
|---|---|
| 2.7 wire motion vocabulary | **Done** — `vizMotion.ts` across all 15 styles |
| 2.2 reactivity triad UI | **Done** — `ReactivityHUD` + `QuickPresetBar` (`1bf5ca7`) |
| 2.5 latency visible | **Done** — `audioToVisualMs` in `RenderStats` (`1bf5ca7`) |
| 2.4 motion vocabulary (`motion/` modules) | **Live, not dead — correction.** `useMotionDriver` is consumed by `ShaderVisualizer.tsx` (+ `shaderMotionWiring.test.ts`); `motionEasing`/`motionMoves` feed `useMotionDriver`. The Oct 6 "zero consumers" note was stale. **Do not remove.** |
| 2.6 color/feel polish | **Partial** — `energyHue` done; remainder open |
| 2.8 beat anticipation (predictive) | **Partial** — `beatSnap` quantizes; true look-ahead not built |
| 2.9 deterministic export | **Partial** — PNG still snapshot only |
| 2.3 genre reactivity presets | **Open** |
| 2.10 / 2.11 real-time data correctness | **Open** |

**three-js-motion-features-2026-10.md** (F3 → F1 → F4 → F2 → F5):
F3 **Done** (`vizMotion.ts`); F4 / F5 **Partial**; F1 / F2 **Open**.

**remix-mashup-2026-10.md:** untouched, still **Proposed** — owner approval
required before any build.

Open design question (decision-log material, not a task): two motion systems
now coexist — `motion/` (`useMotionDriver` → `ShaderVisualizer`, the FX shader
path) and `vizMotion.ts` (the 15 Three.js styles). Whether they should
converge is a D-call, not a cleanup.

## 2. Next course of action (updated)

### Step 0 — Sync and verify (no new code)
1. `git pull` — 13 commits since the last review.
2. Re-run `python tools/run-gates.py` on the merged tree (commits claim
   green; verify after the merge).
3. Windows-only: confirm `ReactivityHUD` / `QuickPresetBar` live in the
   visualizer and the `RenderStats` latency readout ticks.

### Step 1 — Reconcile the docs (small docs commits)
1. `studio-quality-2026-10.md`: mark 2.2 / 2.5 / 2.7 **Done** (+ build
   notes), 2.6 / 2.8 / 2.9 **Partial**, 2.4 **Live** (consumed by
   `ShaderVisualizer`).
2. `three-js-motion-features-2026-10.md`: mark F3 **Done** (+ build notes),
   F4 / F5 **Partial**; set plan status to **In progress**.
3. ~~Remove dead `motion/` modules~~ — **STRUCK 2026-10-13:** the modules
   are live. Do not remove.

### Step 2 — Visualizer lane, in this order (user-facing gaps first)
1. **2.3 genre reactivity presets** — extend the existing genre-matching
   pattern (currently kinetic lyric presets only) to reactivity.
2. **2.8 proper (predictive anticipation)** — `beatSnap` quantizes the beat;
   build look-ahead so motion *leads* the beat instead of landing on it.
3. **2.9 deterministic frame-accurate export** — graduate the PNG snapshot
   into a recorded export of the visualizer page.
4. **2.10 / 2.11 real-time data correctness** — plumb real BPM + beat grid
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
3. Agent attribution: **Resolved 2026-10-13** — no change to the AGENTS.md
   table (correct as-is); the per-commit trailer always reflects the agent
   actually used, which rotates between Cline and Kilo.
4. Motion systems: leave `motion/` + `vizMotion.ts` coexisting, or log a
   decision to converge them?

## Build notes
*(appended when implemented)*
