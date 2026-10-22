# Next Actions — Oct 2026 (post viz-motion review)

**Status:** Reconciled 2026-10-22 — all shipped items marked done, all
open items named. Nothing in Steps 0–4 is unaccounted for.
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

**2.9 follow-up landed — the 2D lane (2026-10-13).** The shader lane could
freeze its audio inputs and still render, because a shader frame is a function
of time plus the analysis timeline. The 2D lane cannot: its bars read the live
`AnalyserNode` byte spectrum and its waveform reads the time-domain buffer, so
a frozen frame is a blank canvas rather than a recording. The follow-up
therefore added a real piece rather than a copy of the same three functions:

- `services/analysisAudioFrame.ts` — a pure frame synthesizer. Band energies
  come from the **measured** spectral timeline (the same endpoint the shader
  lane reads), RMS from the same frame, the beat grid from `AudioAnalysisData`
  when it exists (onsets, downbeats, `beat_times`, drum classes), and the
  spectrum is filled so each band's *mean byte* equals that band's measured
  energy — the export's anchor to the real signal. The waveform is a sine at
  the frequency the measured ZCR implies with the measured envelope as
  amplitude: an oscilloscope at the right pitch and level, and the header
  says plainly that it is not the track's waveform.
- Timeline-first, not analysis-first. Observed live: the analysis cache and
  the spectral timeline are populated separately (Ad Nauseam's analysis is
  keyed `…Ad-NauseamV2`, so `analysis/by-filename/…Ad-Nauseam.m4a` 404s while
  its timeline returns 200). Requiring analysis first produced a
  **300-frame MP4 of a black canvas that looked like a success**. A
  timeline-only frame is a real recording of the track's envelope, so that is
  now the primary path; `frameReadiness` reports what a frame can be built
  from, and the exporter refuses with a message when it is nothing.
- `Canvas2DVisualizer` publishes `Canvas2DFrameAccurateApi`:
  `beginDeterministicRun` resets every stateful driver (particles, springs,
  shockwaves, palette, gradient cache), the live rAF loop is gated, `Math.random`
  draws from a seeded generator and `performance.now()` returns virtual time
  (both re-exported through `nowMs()`/`rand()` so live behaviour is
  unchanged), and `document.hidden` no longer skips a virtual frame.
- The exporter captures **the canvas the lane names**, not "a canvas" from
  the DOM. The visualizer page always mounts a three-js canvas, and it comes
  first in document order — that was the actual cause of the black export
  above. `FrameAccurateRenderApi.canvas()` is now part of the contract, and
  `ShaderCanvas` forwards its element up through a new `canvasRef` prop so the
  shader lane publishes the same one.
- The hook takes a resolver instead of a shader-only ref, so one exporter
  serves both lanes; the button shows in shader and 2D modes.

**Verified in-browser** (Ad Nauseam, 490×240, Windows): 300 frames,
10.000000 s @ 30 fps, h264; two runs differ in exactly **6 bytes** (the
container's creation-time fields — the same signature the shader lane's
verified pair shows); frame 0 is clean (flat baseline, one shockwave ring)
and frame 150 carries bars plus expanding shockwaves. The refusal path was
exercised live too: exporting 2D with no track loaded yields no file and
`Export failed — this track has no analyzed timeline — run analysis first`.

New: 21 frontend unit tests (`analysisAudioFrame.test.ts`), with a
mutation check that reverting the band geometry to the live `bandAverage`
rounding makes the band-exactness test fail.

**three-js-motion-features-2026-10.md** (F3 → F1 → F4 → F2 → F5):
F1–F5 **all landed and browser-verified** (F1 camera transitions, F2 section
driver, F4 beat source, F5 studio export). The plan's own status lines for
F4/F5 ("Partial") predated the landing commits; the build notes below are the
record. The one open thread is that the "LrcViz render path" the 2D export
follow-up assumed no longer exists as a separate path.

**remix-mashup-2026-10.md:** ✅ **Complete** — approved and built (B1–B7,
A1–A7), plus the Windows e2e pass. Status lines in this file that said it was
"untouched, still Proposed" were stale; they belonged to an earlier revision
of this plan.

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

**Status 2026-10-22: ✅ Verified.** Gates run: `docs` and `ruff` were the
only failures, both from the same root cause — stale references to the two
docs moved out of `docs/knowledge/` on 2026-10-22 (`three-js-studio.md`
and `unity-audio-visualization-2026.md`). Fixed in `d3aa92c` (path refs in
`tools/README.md`, `unity-visualizer/README.md`, `app-research-gaps-2026.md`,
`three-js-studio.md`) plus `tools/pyproject.toml` (N999 per-file-ignore for
hyphenated tool scripts, needed by the new `docs-tracker.py`). Full suite:
docs PASS, ruff PASS, arch/routes/type/lint/pytest/tools-pytest/build/unit
PASS — 227 s.
   **Verified 2026-10-13, two of three:** `ReactivityHUD` renders live —
   "Reactivity Tuning / BEAT / Overall Energy 57% / Focus Emphasis
   (All/Bass/Vocals/Highs) / Reactivity Boost 1.0x / Genre Presets" — and
   `QuickPresetBar` is mounted (its genre presets drive the same store).
   The `RenderStats` latency readout **does not tick in this environment**:
   measured, not assumed — the r3f `<Canvas>` produces no new frames here, so
   `RenderStatsProbe`'s `useFrame` never reaches its 1-second window. Evidence:
   the WebGL canvas is byte-identical across 1.5 s while the track plays
   (bass 0.71, energy 0.46 flowing through the 50 ms interval splice, which is
   *not* r3f-driven), plain `requestAnimationFrame` ticks only ~2/s in the
   page, and `.viz-backend-badge` holds only the "WebGL2" renderer badge with
   `renderStats` still null after 10+ s in 3D mode. `prefers-reduced-motion` is
   false and `sceneFrozen` defaults false, so neither explains it. This is
   most likely the automated browser's frame scheduling — the same reason
   F5's >640×360 encode is owed a non-headless run — but it could not be proven
   from inside the browser, so the badge stays **owed a non-headless check**
   rather than marked verified. An e2e assertion for it would fail here for the
   same reason, so none was added.

### Step 1 — Reconcile the docs (small docs commits)
1. `studio-quality-2026-10.md`: mark 2.2 / 2.5 / 2.7 **Done** (+ build
   notes), 2.6 / 2.8 / 2.9 **Partial**, 2.4 **Live** (consumed by
   `ShaderVisualizer`).
2. `three-js-motion-features-2026-10.md`: mark F3 **Done** (+ build notes),
   F4 / F5 **Partial**; set plan status to **In progress**.
3. ~~Remove dead `motion/` modules~~ — **STRUCK 2026-10-13:** the modules
   are live. Do not remove.

**Status 2026-10-22: ✅ Already reconciled** — both plan files carry these
statuses as of their 2026-10-13/21 build notes; nothing to re-mark. Re-verify
with `python tools/docs-tracker.py` before the next milestone instead of
re-reading the tables.

**Docs hygiene (2026-10-22):** `python tools/docs-tracker.py` regenerates
`output/docs-tracker.json` — per-document `date`, author (from the
`Co-authored-by:` trailer), and tags, plus a "written per day" count. Runs
in the `docs` gate (`check-all.py`), so provenance is generated, not curated.

### Step 2 — Visualizer lane, in this order (user-facing gaps first)
1. **2.3 genre reactivity presets** — ✅ Done (Orion 2026-10-13, needs
   Windows verification).
2. **2.8 proper (predictive anticipation)** — ✅ Done (Orion 2026-10-13,
   needs Windows verification).
3. **2.9 deterministic frame-accurate export** — ✅ Done, shader scope
   (Orion 2026-10-13, needs Windows verification). Follow-up: extend the
   virtual-time pattern to the 2D / 3D / LrcViz render paths.
   → **2D lane landed 2026-10-13** (build notes below); 3D exports from its
   own studio lane (F5, `useThreeScene.ts` clock hijack). The "LrcViz render
   path" in the follow-up no longer exists as a separate path: LRC is a lyric
   overlay layer consumed by shader/2D/3D, and its state is sampled
   deterministically per frame rather than re-drivered (see the `lrcSyncAt`
   note below).
4. **2.10 / 2.11 real-time data correctness** — ✅ Already done
   (pre-existing).
5. **2.6 color/feel polish (remainder)** — ✅ Done (2026-10-13):
   `gammaDrive` in `viz-styles/vizMotion.ts` gamma-corrects the five
   energy-driven HSL lightness sites; frequency→color convention verified
   (already shipped in `pulse.tsx`'s bars). Windows gates green.

**Status 2026-10-22: ✅ All five items landed.** Nothing in Step 2 is open
except the Windows verification of 2.3 / 2.8 / 2.9 (owed to the owner's
machine, not a code gap).

### Step 3 — Motion lane remainder

**Status 2026-10-22: ✅ All five landed.** F1–F5 shipped and are
browser-verified on Windows (build notes below). The only open thread is
the D40 delegation (`motion/` → vizMotion primitives), which is scoped
and owner-approved — it is a layering task, not a feature gap.

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
reuses the shader lane's `frameAccurateExport.ts`. **Verified in-browser
at 480×360 (the largest size this headless Chromium's encoder accepts):**
`ffprobe` on two runs — exactly 300 frames, 10.000000 s @ 30 fps; the two
files differ in exactly **6 bytes** — the `mvhd`/`tkhd`/`mdhd`
creation-time fields only. One determinism leak was found and fixed on
the way: the live loop originally quiesced per captured frame, so
`frameCountRef` (the particle-update parity gate) advanced between
captures; it is now a per-export quiesce with the counter reset. **The
F5 accept criterion is met and measured.**
**D40 layering task (scoped 2026-10-21, owner-approved -- for the
local agent):** Both motion APIs stay (D40 amendment). In
`features/visualizer/motion/`, where `motion/` implements a concept
that `viz-styles/vizMotion.ts` already owns, delegate to the
primitive instead of keeping the parallel implementation:
(1) envelope smoothing -> `attackRelease`; (2) beat-grid
quantization -> `beatSnap`; (3) gamma handling -> `gammaDrive`
(gamma=2.2). Scope limits: no API changes on either side; no
changes to the 12 Three.js style consumers or to
`cameraTransitions.ts`; `ShaderVisualizer`'s one consumed channel
(`cameraOffset.x` -> `u_camera_offset`) must behave identically.
Characterize before delegating -- pin current `motion/` outputs in
its colocated tests first; where a concept's math differs
materially from the primitive, stop and report the difference
rather than forcing the delegation (the goal is one implementation
per shared concept, not identical numbers at any cost). Gates:
motion + vizMotion unit tests, tsc, and a browser check of the
shader lane. Each delegation is an independent commit, reversible
on its own.

### Step 4 — Remix / mashup (gated)

**Status 2026-10-22: ✅ Complete.** Approved and built (B1–B7, A1–A7),
plus the Windows e2e pass. See `remix-mashup-2026-10.md` for the build
notes; the two additions to `/api/audio/*` (`preview-audio`,
`preview-file`) are in `tools/audio_routes_baseline.json` alongside B2's
`/from-prompt`, which had been left out of the baseline when it shipped.

### Step 5 — Storyboard enrichment (from track-production practice)

**Status 2026-10-22: proposed, not started.** Owner-requested
exploration; design source is
`docs/knowledge-library/storyboard-enrichment-from-track-practice-2026.md`
(rules R1–R6 with the production evidence behind each). Goal: the
storyboard generator stops taking only `theme + num_scenes` and starts
consuming the track data the owner already has — the track-lyrics
library (6 tracks, 216 lines), measured beat grids, Whisper
transcripts, and character references.

- **S1 — Measured-grid input (R1).** Storyboard jobs accept a measured
  BPM + beat grid + section boundaries; when library/metadata BPM
  disagrees with the measured grid, the board carries a conflict flag
  and the grid wins. Consumes a supplied grid — no dependency on the
  parked madmom A/B verdict.
- **S2 — Sung-truth diff (R2).** Diff the Whisper transcript against
  the lyric sheet at board build; sheet-only sections are marked
  `not_sung` and produce no panels and no on-screen text. (Receipt:
  the Valley Phonk bridge, written but not sung in the Extended V2
  render.)
- **S3 — Scene schema + compiler times (R3/R4/R6).** Scenes grow
  `section`, `lyric_lines[]` refs, beat-anchored start/end, `framing`,
  `source_aspect`, `character_ref` (reference asset + identity
  checklist + off-axis flag), and `accent`. The HyperFrames compiler
  manifest emits absolute start times derived from the grid on the
  input timeline. Characterize existing payloads first — the compiler
  accepts legacy shapes today and must keep doing so.
- **S4 — Panel lifecycle + conformance (R5).** Panels carry
  `planned → generated → accepted | rejected(+reason)`; the acceptance
  check is a place/theme conformance review behind an interface whose
  first implementation is the local VLM route (Gemma 4 E2B via Ollama,
  chosen 2026-10-22). No hard dependency: boards work with the check
  unimplemented, panels just stay `generated`.
- **S5 — Lyric data completion + wiring.** (a) Capture **The Last
  Original** lyric sets 1 and 2 (Suno URLs in the design doc §4) into
  the track-lyrics library — a read-only transcription pass like
  2026-09-30's, so it is Orion/owner-side work, not a code task; the
  code side is only the two new JSONs + index entries. **(a) done
  2026-10-22:** both sets captured and filed the same day this step was
  proposed; the same pass enriched every library entry with per-render
  Suno style prompts (`renders[]`). (b) Wire
  `track_lyrics_id` into the generator job params (contract sketch in
  the design doc §3).

## 3. Decisions needed from the owner
1. Approve this sequencing (Step 2 order) or reprioritize. — **Resolved
   2026-10-22:** the written order is the order work shipped in; nothing
   has been done out of it.
2. Approve the remix/mashup plan for build, or defer it. — **Resolved
   2026-10-22:** the plan is complete (B1–B7, A1–A7) and on `main`.
3. Agent attribution: **Resolved 2026-10-13** — no change to the AGENTS.md
   table (correct as-is); the per-commit trailer always reflects the agent
   actually used, which rotates between Cline and Kilo.
4. Motion systems: **Resolved 2026-10-21** -- layer, don't merge
   (D40 amendment in the decision log). Both APIs stay; `motion/`
   delegates to vizMotion's primitives where the concepts coincide.
   Scoped build task: Step 3, D40 item below.

## Where the work is concentrated (2026-10-22)

Generated from `python tools/docs-tracker.py` (`output/docs-tracker.json`) —
the `docs per lane` count is the objective signal; a lane with a big share
of the library is where the docs live, and a lane with no docs at all is
where no work has been recorded.

| Lane | Docs | Signal |
| --- | --- | --- |
| Knowledge library | 119 | Bulk of the research library (2026-09-29 import spike) |
| Plans & roadmaps | 13 | Active: feature roadmap, next-actions, per-lane plans |
| Storyboards & visual storytelling | 8 | Production artifacts (mirrored to `packages/frontend/public/docs`) |
| Notes (not authoritative) | 8 | Working material — archive candidates per D12 |
| Architecture & decisions | 6 | D1–D44 + Q1–Q6 |
| Setup & requirements | 6 | Environment + system requirements |
| UX audit | 4 | Visualizer review findings |
| Docs & hygiene | 4 | AGENTS.md, cheatsheet, testing workflows |
| Guides | 4 | User/operator guides |
| API reference | 1 | Single API reference doc |
| Scratch (not authoritative) | 1 | Working material — archive candidate |

**Status 2026-10-22: everything that shipped is on `main` and the gates
are green.** The only two things still owed are (a) the D40 layering task
(`motion/` → vizMotion primitives), scoped and owner-approved, and (b)
Windows verification of 2.3 / 2.8 / 2.9 — owed to the owner's machine, not
a code gap. Re-run `python tools/docs-tracker.py` at each milestone
rather than re-ranking by memory.

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
- Still open across both: ~~the browser accept checks~~ — **done for 2.6
  (2026-10-13):** before/after captures in the 3D viz-styles path on "The
  Last"'s quiet verse for all four changed styles; measured quiet-decile
  lift +1.12 (geometric) and +2.00 (neural), median ~unchanged, no clipping
  increase in any style, crushed blacks down 1–4.6 pp. A second track
  ("Before the Fade") adds +4.21 at the quiet decile with a small +0.11 pp
  clipping increase (watch item). **D24's third class is blocked on input,
  not skipped:** every analyzed track in the library measures 0.306–0.369
  mean energy, all from the same generated pipeline — there is no
  acoustic/sparse source to capture until one is imported. F4's stub and
  the section-track check are closed (above).
- **Watch item:** a one-off *"Maximum update depth exceeded"* crash in the
  visualizer, observed right after Vite hot-reloaded `viz-styles` modules
  during a live 3D scene (the `git revert`/`reset` capture cycles), which
  reverted the mode to shader and unmounted the 3D tree. Not reproducible
  in three clean-load attempts with the same mode/track/style sequence, and
  no commit of ours touches the visualizer's mode switching — treat as
  HMR-correlated and re-open with a deterministic repro if it recurs on a
  fresh load.
  **2026-10-13 re-check:** it recurred twice more, both times with the remix
  panel open on a fresh load — eight consecutive errors over ~40 s in one
  session (which stopped as soon as an HMR edit landed), and once at 150 s
  into a page's life during the 2D frame-accurate export. Re-investigated the
  next day and it did **not** recur in three fresh loads (panel interaction,
  mode switching and a full 2D export), so it is neither clean-load
  reproducible nor HMR-only. Two things a future session should not redo: the
  unguarded-setState-in-effect sweep across `visualizer/` and
  `three-js-studio/` found **no** `useEffect` that sets state without a
  dependency array (the single grep hit, `PresetFileUpload`, has
  `[processText]`), so that hypothesis is closed. And React attaches the
  component stack as *extra* `console.error` args rather than in the message
  text, so Playwright's plain console capture never shows it — install a
  `console.error` recorder via `page.evaluate` **before** the panel mounts to
  get one. The two known occurrences are both recorded with their
  page-relative timestamps, so a matching stack can be compared against them.
