# Next Actions — Oct 2026 (post viz-motion review)

**Status:** Proposed 2026-10-12 — awaiting owner review (updated 2026-10-13;
2.3/2.8/2.9 implemented by Orion 2026-10-13, pending owner verification)
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
| 2.8 beat anticipation (predictive) | **Done** — see build notes below |
| 2.9 deterministic export | **Done** (shader scope) — see build notes below |
| 2.3 genre reactivity presets | **Done** — see build notes below |
| 2.10 / 2.11 real-time data correctness | **Done** (pre-existing: `tempo_bpm` + `beat_times` plumbing, `liveSpectralFrame.ts`) |

## Build notes — 2.3 / 2.8 / 2.9 (Orion, 2026-10-13)

Implemented and pushed; **not yet verified on Windows** (gates, Playwright,
vision checks must run on the owner's machine before this is trusted).

**2.3 genre reactivity presets** — new `reactivityGenrePresets.ts`: four
presets (EDM: fast attack 0.8 / beat 2.0 / bass focus; Ambient: release 0.45 /
beat 0.35; Vocal-led: mid focus; Phonk/Bass: attack 0.85 / beat 2.2) each with
genre keywords, triad, focus and gain. `matchReactivityGenrePreset(genres)`
mirrors the kinetic presets' substring matching. UI: chips in the reactivity
panel (`ReactivityHUD`), never Master EQ. `Visualizer.tsx` applies the
preset (triad + focus + gain, persisted via the existing triad storage) and
auto-applies on track load from the filename genre signal — the same signal
the kinetic auto-select uses — with a guard ref so a manual pick made
mid-load is never clobbered. 8 unit tests; triad values pinned inside the
HUD slider ranges.

**2.8 beat anticipation** — two channels:
- *Processor uniform* (`audioReactivityProcessor.ts`): `BeatPhaseWave.
  timeToNextDownbeat()` (grid index % 4 === 0; BPM-grid fallback) feeds an
  `anticipation` uniform that ramps 0→1 over 120 ms before each downbeat,
  hits 1 as the transient accent fires, then holds at 0 — no drift, no
  effect on non-downbeat beats. `anticipationEnabled` config (default true).
- *Motion driver* (`motion/`): `buildShaderMotionInput` now derives the
  lookahead from the next **downbeat** (the `MotionInput.nextBeat`
  contract always said "downbeat"; the builder never filtered — two
  existing tests updated to the corrected behavior). `ResolveMotionOptions.
  anticipationEnabled` is the per-style toggle. Note: the motion wind-up
  keeps its tuned 2-beat `durationBeats` (vision-validated); the plan's
  "~120 ms" is implemented as the processor uniform ramp.
- 9 new/updated unit tests; 33/33 green via tsc + a node harness
  (vitest could not run in this environment).

**2.9 deterministic frame-accurate export (shader scope)** — new
`services/frameAccurateExport.ts`: drives `renderAtTime(i/fps)` for exactly
`round(durationSec * 30)` frames (10 s → 300), timestamping each at `i/fps`
(never the wall clock), muxing via mediabunny. `ShaderVisualizer` publishes
a `ShaderFrameAccurateApi` (`beginDeterministicRun` /
`renderAtVirtualTime` / `endDeterministicRun`): virtual frames override the
audio clock, freeze all live inputs (audio graph, FFT, beat pulse, phrase
flash — the frame is a pure function of the analysis timeline), step
`dtSec` at exactly 1/fps, and quiesce the rAF loop so no live frame can
mutate driver state mid-export. Trigger: "Export 10s HQ" in the More menu
(shader mode only); result lands in `recordedBlob` for the existing
download path. Backgrounding the tab drops nothing (no rAF in the loop).

**2.10 / 2.11** were already done (verified, not built here).

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
1. **2.3 genre reactivity presets** — ✅ Done (Orion 2026-10-13, needs
   Windows verification).
2. **2.8 proper (predictive anticipation)** — ✅ Done (Orion 2026-10-13,
   needs Windows verification).
3. **2.9 deterministic frame-accurate export** — ✅ Done, shader scope
   (Orion 2026-10-13, needs Windows verification). Follow-up: extend the
   virtual-time pattern to the 2D / 3D / LrcViz render paths.
4. **2.10 / 2.11 real-time data correctness** — ✅ Already done
   (pre-existing).
5. **2.6 color/feel polish (remainder)** — ✅ Done (2026-10-13):
   `gammaDrive` in `viz-styles/vizMotion.ts` gamma-corrects the five
   energy-driven HSL lightness sites; frequency→color convention verified
   (already shipped in `pulse.tsx`'s bars). Windows gates green.

### Step 3 — Motion lane remainder
F1 (eased camera transitions) → F2 (section-aware motion driver) →
complete F4 / F5 (prediction + deterministic export).

**2026-10-13 update:** F1 verified landed (`cameraTransitions.ts` →
`useThreeScene.ts`). **F2 landed** — `services/sectionDriver.ts` (§3 map +
cut/wipe resolution, 19 tests), `useSectionDriver` in
`hooks/useTrackMetadata.ts`, `useThreeScene.ts` wiring (cut on
snare/downbeat; 0.9 s `settle-soft` wipe otherwise; scaled `beatPunch`,
particle speed, light-palette hue rotation), `sectionDriven` template opt-in.
Wiring it also completed the studio's previously dead audio path: the engine
owns real `audioElementRef`/`analyserRef` refs and `ThreeJSStudio.tsx` now
renders a hidden `<audio>` for the selected track instead of passing dummy
`{current: null}` refs. **Browser-verified on Windows**: on
`c0ac669c_…The Last-Original-V1.m4a` (130 BPM, 7 sections) the dolly camera's
smooth z-glide stops and switches to the handheld random walk at exactly the
68.61 s intro→chorus boundary.

**F4 landed** — the studio's `getCurrentBeat` was a never-ready stub, so
every beat-driven path (including `beatPhrasing.ts`'s anticipation → pop →
hold) was dormant. `ThreeJSStudio.tsx` now passes the real
`useBeatTimeline` getter through a late-bound ref, sampled at the audio
playhead. Browser-verified: the HUD beat dot fires at the track's BPM.

**F5 landed (studio lane)** — clock hijack in `useThreeScene.ts`
(`renderAtTime` + quiesced live frames + seeded PRNG for per-frame
randomness), `services/videoExport.ts` (pure `planExport` + mulberry32,
10 tests), and an "Export 10 s MP4" button in `StudioHeader`. The mux
reuses the shader lane's `frameAccurateExport.ts`. Browser-verified: UI
path + graceful "needs WebCodecs" fallback (this headless Chromium's H.264
encoder rejects >640×360 — the shader exporter carries the same
constraint). The full 300-frame encode and byte-comparability check need a
non-headless browser.

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

**2026-10-13 (F4 + F5, Windows gates green: all nine; browser-verified):**

- **F4** — the beat *source* was the gap, not the service. `useThreeScene`
  received a never-ready `getCurrentBeat` stub from `ThreeJSStudio.tsx`
  because the scene engine is built before `useTrackManager` (hook order).
  Fixed with a late-bound ref: the engine samples the real
  `useBeatTimeline` getter at the audio playhead (beat times are
  track-relative), falling back to the render clock before an audio element
  exists and to not-ready when the track has no analysis. Verified in the
  browser: HUD beat dot edges at 130 BPM on a 7-section track.
- **F5** — the loop body is now a shared `runFrame`; the live rAF driver
  and the export's `renderAtTime` both call it, with the export clock
  (index-driven delta/elapsed) winning while active and live frames
  quiesced so nothing mutates between captures. Determinism has two more
  enemies than the clock: per-frame `Math.random` (handheld walk, beat
  shake, particle wrap) and accumulated state — both handled by the seeded
  PRNG (`videoExport.ts`'s mulberry32) and `resetDeterministicState()`
  (shake, camera blend, section override, light palette, mixers, authored
  particle layout). The mux reuses the visualizer's
  `frameAccurateExport.ts` instead of a second encoder. Browser-verified:
  button + plan + graceful fallback; the >640×360 H.264 rejection in this
  headless Chromium means the full 300-frame encode is still owed a
  non-headless run.

**2026-10-13 (2.6 remainder + F2, Windows gates green: type / lint / unit):**

- **2.6** — `gammaDrive(x, γ=2.2)` in `viz-styles/vizMotion.ts` gamma-corrects
  the five energy-driven HSL lightness sites (`geometric`, `neural`, `storm`,
  `pulse`); envelope ramps (`beatPulse`, `beatSnap`, the processor's
  `anticipation`) stay linear deliberately — the same rule the processor
  documents. Frequency→color verified, not built: `pulse.tsx`'s bars already
  implement §2's convention (bass warm / mid green / treble blue); other styles
  key hue by energy (`energyHue`), a different shipped axis. 9 new
  `vizMotion.test.ts` cases.
- **F2** — `sectionDriver.ts` is pure (map, boundary scan, cut-vs-wipe by
  beat alignment within 0.06 s), so the accept behavior is unit-testable
  without a browser; the loop wiring (cut clears the F1 transition for a
  hard jump, wipe begins a 0.9 s `settle-soft` blend) reuses
  `cameraTransitions.beginCameraTransition`'s new `anchor` parameter. The
  studio audio fix is load-bearing, not incidental: without a real audio
  element the section playhead is null and the driver is inert by design.
- Still open across both: the browser accept checks (≥3-section track in the
  studio, three-track before/after captures for the visualizer styles) and the
  F4 `getCurrentBeat` stub. — *F4's stub and the section-track check are now
  closed (above); the visualizer three-track captures remain.*
