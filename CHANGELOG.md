# Changelog

All notable changes to the Native Media AI Studio project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added - stem remixing and mashups across different songs

`packages/backend/app/services/stem_remixer.py` + `/api/audio/remix/*`
(`sources`, `probe/{track}`, `preview`, `build`). Builds a new composition from
stems belonging to *different* tracks.

The organising decision: a remix renders as a **plain four-stem directory**
(`vocals/drums/bass/other.wav` + `remix.json`), so the Suno enhancer chain,
`/api/audio/stem-file` playback and the visualizer's per-stem mapping all work
on a remix unchanged. Only the arrangement logic is new.

An arrangement is a list of slots over a bar grid; each slot names the stems
playing during its span. Source tempo is detected and time-stretched onto a
common grid automatically (measured 143.555 / 135.999 / 151.999 BPM, stable),
with equal-power crossfades between slots and bar-aligned looping when an
arrangement outlasts its source.

**Key matching is deliberately not automatic.** Chroma flatness on these stems
measures 0.978-0.998 (1.0 = pure noise, ~0.1 = a single pitch), and Ad-Nauseam
returned a *different* argmax between two runs (A# → F). Auto-applying that
would pitch-shift by an arbitrary amount, so `key_shift_semitones` is an
explicit per-layer parameter and `probe_track` reports `key_confident: false`
rather than pretending.

`preview_recipe` resolves a recipe without writing: exact timeline, each
source's stretch ratio and measured level, plus a warning for near-silent
layers. That warning exists because tracks here open instrumentally — Ad-Nauseam
vocals are silent for the first 7.06 s, and a layer at `source_start_bar=0`
renders digital silence that reads as a broken mixer.

Routes registered in `main.py` (an unregistered router loses every route
silently, since OpenAPI is built from decorators and never runs a handler body);
`audio_routes_baseline.json` refreshed to 36 routes. 24 new tests, including a
synthetic equal-power crossfade check — asserting the fade against real material
would encode the arrangement (the drums stem fades −18.9 → −26.8 dBFS over its
own first 6.3 s) rather than the algorithm.

Measured: two-slot four-stem render in 6.9-22.7 s; crossfade overlap engaged at
`xf_ns=[0, 69632]`; rendered peaks match their sources (drums 0.622 vs 0.6221,
bass 0.055 vs 0.0535).

#### Remix listing and mastering, added in review

`GET /api/audio/remix/list` reads rendered remixes back from the manifests
written at render time, so the listing cannot drift from what was built.

`POST /api/audio/remix/{name}/enhance` runs the Suno master chain over a
rendered remix. This closes a real gap rather than adding a nicety:
`/api/audio/enhance-stems` resolves a *library* filename under `output/audio/`
and then finds that file's stems, so pointing it at a remix 404s on both a bare
name and an absolute path (verified, both). The enhancer *service* takes a stem
directory and works unchanged, so the new route is a thin bridge.

#### Defects found reviewing the remix code

- **`probe_track` required a `vocals` stem**, while `list_stem_sources`
  advertises partial stem sets. A drums-only track was listed as a usable
  source and then failed to probe, so the two disagreed. Tempo is now taken
  from the first available stem, preferring drums. (Confirmed on a synthetic
  drums-only track; `take-the-crown` now probes its drums and returns the same
  151.999 BPM.)
- **`remix_enhance` awaited a coroutine through `asyncio.to_thread`** —
  `suno_enhancer.enhance_stems` is already async, so this returned the
  coroutine object and raised on `.wav_path`.
- **`EnhanceResult` has no `duration` field** (`success/output_dir/wav_path/
  mp3_path/steps/error`), so the duration now comes from the remix manifest.
- **Probe cache was written beside the stems**, inside a directory owned by
  `source_separation` that otherwise holds only stem WAVs. Moved to
  `output/remixes/.probes/`.
- **`crossfade_bars` accepted `inf`/`nan`** (they pass a bare `>= 0`) and then
  died inside `int(round(...))` far from the bad value.
- Two more stale `10-step` docstrings in `suno_enhancer.py` (`SunoEnhancer`,
  `enhance_stems`) missed by the earlier pass over that file.

29 tests now; audio route baseline 38.

### Added - frontend controls for remixing

`features/visualizer/components/RemixPanel.tsx`, mounted in the Visualizer
under Stem Mixer, plus `services/api/remix.ts` as a typed client.

The panel builds a mashup and **plays it back**: three one-click presets (Drums
A + Vocals B, Intro → swap, Blend A + B), editable slots (bars, crossfade, and
per-layer track/stem/gain/key-shift/start-bar), Preview, Build, per-stem play
buttons and a "Master it" button that runs the Suno chain over the result.
Earlier remixes are listed and re-playable.

`GET /api/audio/remix/{name}/file/{which}` was added because without it the
feature is **silent**: a remix lands in `output/remixes/<name>/`, which no other
route serves, and `/api/audio/file/...` resolves under `output/audio/`. It
streams the four stems or the enhanced master.

Three defects the browser found that no type check would have:

- **The panel picked the wrong songs.** It compared the visualizer's library
  *path* (`Suno-V6-Mini/SunoV6Mini-Ad-Nauseam.m4a`) against stem *directories*
  (`SunoV6Mini-Ad-Nauseam`), so the match always failed and it fell back to
  `tracks[0]` — alphabetically `demucs_test_input`, a 10-second demucs test
  fixture. The first build laid real drums under a tenth of a second of scratch
  vocal, which reads as the feature being broken. Now matched on basename, and
  source B must be at least 30 s (durations are probed once and cached on disk).
- **A play button on digital silence.** The built-stem list was all four stems,
  so `other` got a button and returned −240 dBFS when no slot used it. Now only
  the stems the recipe actually references.
- **`eslint-disable` for a rule this project does not configure**, which errors
  rather than warns. The seeding effect was restructured around an explicit ref
  guard instead.

Verified in a real browser end to end: select track → panel seeds
`SunoV6Mini-Ad-Nauseam` at 144 BPM → preset → Build → 10.0 s two-song mashup
rendered and streamed (drums −5.4 dBFS peak / 40% audible, vocals −11.4 dBFS /
66% audible). All 7 gates pass.

### Fixed - the Suno mastering chain had never produced a file (P0)

`suno_enhancer.py` (14 steps, `/api/audio/enhance-stems`) aborted at step 5 on
every run. Five defects were stacked behind the first, each hiding the next:

- `_db_to_linear` called `math.pow` on an ndarray
  (`_band_rms_deesser` passes one gain per STFT frame).
- `_reverb_and_delay` called `np.convolve`, which is 1-D only, on a
  `(channels, samples)` array.
- `_compress_audio` and `_simple_limiter` looped `range(len(y))`, which on a
  `(2, N)` array walks the **channel** axis — the right channel was never
  compressed, and the limiter never engaged on the audio at all.
- Step 2a called `_high_pass(y[0], …)` and re-wrapped the result as `(1, N)`, so
  every stem became mono at the first processing step and the export was written
  `channels=1`.

Two further defects made the output measurably *worse* than its input:

- **The reverb drowned the track.** Peak-normalising a white-noise IR makes
  convolution ~6x louder than dry before `mix` is applied. Measured: 87.8% of
  output energy was reverb tail; the noise floor in a quiet passage rose from
  -32.2 to -22.4 dBFS — a 9.8 dB hiss over the whole track, which is the
  "sounds unpolished / synthetic" symptom. L2-normalising the IR makes `mix`
  mean what it says: contribution 87.8% -> 4.8%, noise floor -22.4 -> -32.0 dBFS.
- **The high-pass deleted the bass.** `pre_highpass_hz` was 120.0 against the
  module's own stated intent (~30 Hz). 62% of all energy in the source sits below
  120 Hz, so 89% of the bass band was removed. Now 30.0.

`_mix_stems` was also reworked: it divided the bus by the stem count (-12 dB, so
the ceiling never engaged) and folded stereo to mono. Both attempts to "fix" its
weighting — 1/RMS per channel, then peak-normalise per stem — made the tonal
balance worse in opposite directions; it now sums the stems as separated and
applies a single gain to the sum.

Measured on `SunoV6Mini-Ad-Nauseam` (209 s): correlation with the summed stems
**0.19 -> 0.86**, crest factor 18.16 dB against 16.02 dB in the source (slightly
more dynamic range than the input, rather than less), `channels=2`, limiter
engaging at -1.00 dBFS. Chain runs all 14 steps in ~175 s.

Still open: bass reads 10-15% low in the two bass-heaviest passages, not yet
localised. See `docs/knowledge-library/ai-music-mastering-stems-2026.md` §6.

### Added - naming and grouping for preset variants

A preset variant is one preset's rendering of a track, written as its own file so
two presets can be compared by measurement and auditioned side by side.
Convention: `<source stem> [<preset>].<ext>`, e.g. `Still I Rise [warm].wav`. The
original is never renamed, provenance reads off a folder listing, and `[` sorts
after alphanumerics so variants group beside their source.

`state/audioNaming.ts` gains `variantFileName`, `parseVariantName`,
`isVariantFile`, `variantLabel`, `variantOptionLabel` and `groupAudioEntries`,
with 18 tests. Grouping is derived rather than stored, so the six pages that read
`useAudioLibrary()` (D16) are unaffected until a selector opts in;
`KineticTypographyPage`'s library `<select>` is the first, using `<optgroup>`.

Variants belong under `output/audio-variants/`, deliberately outside
`output/audio/` — `/api/audio/files` walks that tree with `rglob`, so anything
written inside it would appear in every selector in the app.

`_separate_demucs` read `opts.source_path`, which `SeparationOptions` never
defines, so **every** Demucs run raised `AttributeError` — swallowed by a broad
`except Exception` into `SeparationResult.error`. The hierarchical path was worse:
it passed `source_path=` as a keyword the signature rejected, so it raised
`TypeError` before reaching the read. Both defects were proven by executing the
real functions before fixing (`docs/plans/studio-quality-2026-10.md` §0.1).

`source_path` is now an explicit parameter. Verified live: `POST
/api/audio/separate-file` on a 1-second WAV returns HTTP 200 with all four stems
written to disk (WAV + MP3).

### Fixed - shader visualizer 404'd on every uploaded track (P1, Phase 0.2)

`Visualizer.tsx` passed `cleanTrackName(currentFilename)` to `ShaderVisualizer`,
which fed it to `useKeyPalette` and `useSpectralTimeline` as an **API key**. Every
uploaded file is content-addressed (`a6792f53_<name>.wav`), so the cleaned name
404'd for all of them and the spectral timeline and key palette silently never
loaded. Split into `trackName` (display) and `trackFile` (cache key). Verified in
the browser: four hash-prefixed tracks now fetch `spectral-timeline` with 200
(was 404 for every one).

### Changed - "no analysis" is a state, not an error (P1, Phase 0.3)

`classifyAnalysisResponse()` makes a 404 from the analysis endpoint a distinct
`not-analyzed` outcome instead of an error, so the UI can offer "Analyze". 403/500
still surface as errors — collapsing those would let a misconfigured proxy look
like an ordinary unanalyzed track.

**Known limit, stated rather than papered over:** the browser's own
`Failed to load resource` console line for a 4xx is emitted by the network stack
and cannot be suppressed from application code, so the plan's "zero red console
entries" acceptance is not achievable as written.

### Verified - full test-suite audit (2026-10-02)

**Frontend unit:** 420 passed (10 files). **Playwright E2E:** 81 passed, 0 failed.
**Backend:** 250 passed. All 7 gates green.

Audited every test file for the defect classes that make a suite lie about the
product. Findings and fixes are below; the three real defects (production test
harness, dev-overlay E2E failures, a tautological assertion hiding an a11y bug)
were fixed. Everything scoped as follow-up is recorded in **D26** rather than
silently patched.

### Security - the visualizer test harness was shipping in production builds

`window.__VIZ_TEST__` was registered with no environment guard and was verified
present in the built bundle (`dist/assets/Visualizer-*.js`). Anyone with a devtools
console could load an arbitrary library track, switch render modes, and toggle
layers. The Ctrl+Shift+T test panel — which dumps live state on screen — was
reachable in production for the same reason.

Both are now behind `import.meta.env.DEV`. Vite substitutes that statically, so
the code is *removed* from the production bundle rather than skipped at runtime;
verified by rebuilding and confirming `__VIZ_TEST__` is absent. Playwright runs
against the Vite dev server, so the suite is unaffected.

### Fixed - three E2E failures that were never app defects

A full Playwright run failed 3 of 80. All three shared one root cause: the Vite
dev server injects `/__devtools/embedded.js`, which

- **intercepted pointer events.** `sidebar.spec.ts` timed out on a button that
  Playwright itself reported as "visible, enabled and stable" — because
  `document.elementFromPoint` at its centre returned the overlay, not the button.
- **fetched icons from `https://api.iconify.design` at runtime**, and the CORS
  errors then failed two `unity.spec.ts` console assertions.

`removeDevToolOverlays()` in `tests/helpers.ts` now blocks the route and strips
the overlay, and runs from both `cleanupRoutes` and `navigateWithWait` — cleaning
only in `beforeEach` is useless because the overlay is re-injected on every
navigation. All three pass.

### Fixed - a test that could not fail, and an accessibility defect it was hiding

- `settings.spec.ts` asserted `toBeGreaterThanOrEqual(0)` on an element count.
  That is true for every array, so the test passed whether or not the feature
  existed. It now asserts the control is visible and keyboard-focusable.
- Added a test that every settings form control has an accessible name. It failed
  immediately and found a real defect: the **Ollama URL input had only a
  `placeholder` and no accessible name**, while its siblings on the same page had
  `aria-label`. Fixed.
- A wider sweep found the same class on `/library`, `/logs`, `/audio-analysis`,
  `/storyboards` and `/unity`. **Recorded as open, not silently fixed** — it is a
  broad multi-file a11y sweep and belongs in its own change.

### Fixed - `aurora` was implemented but unreachable, and one picker option was a dead value

Found by browser automation, not by reading the code. `Canvas2DVisualizer`
rendered `aurora` and the effect budget had an entry for it, but the mode picker's
`<option>` list was hardcoded and never included it — so **no user could select
it**. It was reachable only via `__VIZ_TEST__.set2DMode('aurora')`, which is
exactly how dead UI survives a test suite. The cause was four divergent copies of
the mode list.

- `CANVAS_2D_MODES` in `visualizerHelpers.ts` is now the **only** definition. The
  budget imports `Canvas2DMode` from it rather than redeclaring it; `useState`
  uses it instead of an inline 12-member union.
- **Both** mode `<select>`s render `CANVAS_2D_MODES.map(...)` instead of
  hardcoded options. The compact menu keeps short labels via a typed
  `CANVAS_2D_MODE_SHORT_LABELS`, so a missing entry is a compile error rather
  than a blank option.
- The hidden test-panel picker also offered `value="stereo-split-bands"`, which
  is **not a real mode** (it is `stereo-split-bars`). Selecting it set state to a
  value no branch handled, so the canvas fell through every `else if` and drew
  nothing.
- `as any` removed from the mode selects and the test harness setter.

Guards added so this cannot recur: 8 cross-module assertions in
`canvas2dModeBudget.test.ts` (budget equals the canonical list both ways, both
label maps cover it, no label map invents a value outside it) and a Playwright
spec that asserts the **UI** — not the harness — offers exactly the modes the
runtime supports. Removing `aurora` from the list fails 6 of them.

### Fixed - Canvas2D: no more effect hierarchy (closes the 2026-10-02 diagnosis)

`Canvas2DVisualizer.tsx` drew **all four** global effects on every frame of
every mode, before the mode's own rendering: trail/ghost fill, phrase flash,
beat vignette and drum shockwaves. With a mode's own glows on top that is 5-7
simultaneous large-area effects with no focal point — the "visual noise" failure
in `docs/knowledge/canvas2d-visualizer-diagnosis-2026-10-02/README.md`, where
everything reacts to everything so nothing reads.

- **Per-mode effect budget** (`canvas2dModeBudget.ts`), as data, per the
  diagnosis doc's own recommendation. `MAX_EFFECTS = 2`, applied at runtime by
  `resolveActiveEffects`; a mode may declare more than two because which effects
  fire is frame-dependent, but three can never fire at once.
- **Unknown modes get nothing.** A new mode is inert until it declares a budget,
  which is the strongest reading of "do not add a 14th mode until the effect
  budget exists".
- Trail alpha moved out of a 4-level nested ternary with duplicated
  `prefersReducedMotion` branches and into the budget.
- Beat-vignette alpha ceiling halved, 0.45 → 0.225, per "halve the alpha ceiling
  globally, then re-evaluate".
- Shockwave **spawning** is gated too, not just drawing — spawning rings a mode
  will not draw leaked them into the next beat and filled the 8-ring pool.
- The perceptual-scale selector was copy-pasted **six times**; it is now
  `makeFreqMapper()` / `sampleMappedBand()` in `canvas2dHelpers.ts`.

### Added - Asymmetric band smoothing for the Canvas2D modes

`asymmetricSmoothStep` / `asymmetricSmoothBands` (0.8 attack / 0.12 release) in
`canvas2dHelpers.ts`, per §1 of
`docs/knowledge/gemini-ae-to-canvas2d-2026-10-02/README.md` — "damping
high-frequency flicker is the #1 visual-fatigue fix". Tested but **not yet wired
into a mode**; the existing per-mode springs still apply.

### Added - Motion vocabulary for audio-reactive visuals (closes gap #16)

Implements the ten moves from
`docs/knowledge/gemini-motion-design-2026-10-02/README.md` — previously the
single largest unaddressed item in `app-research-gaps-2026.md` §16, where every
reactive parameter shared one trigger source, one direction and one easing
curve. New module `packages/frontend/src/features/visualizer/motion/`:

- `motionEasing.ts` — easing curves, a sub-stepped damped spring, the decaying
  harmonic, and `SECTION_EASING` (the spec's per-section palette, keyed by the
  section names `sectionStateMachine.ts` already uses).
- `motionMoves.ts` — all ten moves, plus `assignStaging` (driver dominance: one
  onset owns global motion, so two stems never drive the same spatial vector),
  `ImpulseTrigger` (first-derivative triggering with a noise gate, replacing
  level-mapping that made meshes twitch every frame) and the motion gates.
- `useMotionDriver.ts` — `resolveMotion()` composes them per frame from the
  latency-compensated audio clock, and resets its state on a seek.
- 151 unit assertions, no browser required (`pnpm test:unit`).

Two corrections to the spec, both verified by tests:

- **`flareXZ`**: the spec gives `1.154 (= 1/0.75, volume-preserving)`. The number
  is right — `1/√0.75` — but the derivation is not; `1/0.75` is 1.333 and inflates
  volume 33% on every kick. Now derived as `1/√compressionY`.
- **`stepAngle`**: the spec's `0.196` rad lands 0.011 rad short of a full turn
  every 32 hats. Now exactly `2π/32`.

Deliberately not done: the per-viz-style mapping from audio onto `MotionInput`,
and the A/B screenshot validation the spec recommends. The moves are correct and
tested; they are not yet driven by any existing style.

### Changed - Audio API split into four modules (D15)

- `app/api/audio.py` reduced from 2,746 to 1,106 lines, split into four peer
  modules under the unchanged `/api/audio` prefix: `audio.py` (upload, analysis
  endpoints, in-memory cache, JSON index), `audio_stems.py` (separation),
  `audio_edit.py` (extract/rename/trim/file serving), and `audio_analysis.py`
  (result builder, curve maths, visualization suggestions, section labelling —
  no routes). All 32 routes are registered in `main.py`; the route surface is
  unchanged, verified by `tools/snapshot-audio-routes.py`.
- `find_stem_dir` moved from the API layer to `services/source_separation.py`,
  which owns `SEPARATION_DIR`. This removes the last `services/` → `app/api`
  import (verified repo-wide as zero).

### Fixed - Duplicate uploads, stale analysis caches, and silent CPU fallback

- **Content-addressed uploads** — files are named from `sha256(bytes)[:8]`, so
  re-uploading the same track resolves to the same path instead of creating a new
  row and a new copy. Writes are atomic. `tools/dedupe-audio-uploads.py` reported
  68 rows for 58 unique files; the 10 duplicates were collapsed and three
  byte-identical orphan files deleted (13.8 MB freed). `storage/studio.db.dedupe.bak`
  is kept as a rollback until the database is confirmed good.
- **Analysis schema v2** — results are stamped with a schema version and
  pre-v2 cache, database and JSON-index entries are rejected as stale rather than
  served. Existing analyses re-analyze lazily on request; they are not bulk
  regenerated.
- **Silent CPU fallback** — `AudioAnalysisResult(extra="ignore")` was dropping the
  `computed_on` field, so successful GPU analyses reported no device and read as
  a CPU fallback. CUDA is verified working on the GTX 1070 Ti (`sm_61`), and
  `analyze-cuda` now reports `computed_on=GPU`.
- **Ollama section labelling latency** — requests now send `think:false` and try
  a cheap-first model chain with a 12-second per-model budget. Hidden thinking
  dominated the cost (one request: 39.5 s → 0.6 s); the endpoint went from ~81 s
  to ~7.9 s. Recorded in `docs/knowledge-library/ollama-thinking-structured-outputs.md`.
- **Audio VRAM handover is Ollama-aware** — Ollama's models are offloaded before
  CUDA work and restored afterwards, instead of contending for VRAM.

### Fixed - A VRAM test that depended on the host's live RAM

- `test_music_generation_cycle_returns_vram_to_baseline` stubbed `get_vram_status`
  but not `_can_safely_offload`, which `begin_music_generation` calls when VRAM is
  short. The real method reads `psutil.virtual_memory()`, so on a host above
  `MAX_SYSTEM_RAM_PERCENT` (75%) the offload is skipped and the test fails with
  `success=False`. This host sits at 61%, so it was passing by luck. Confirmed by
  simulating a 92% RAM host, which reproduced the failure, then stubbed the
  method the way `test_audio_vram_handover.py` already does.

### Changed - One shared audio-library store feeds every selector (D16)

- Six pages each fetched `/api/audio/files` from their own `useEffect` and kept
  their own copy — ArtDirection, Audio Analysis, Kinetic Typography, Storyboards,
  the 3D studio and the Visualizer. They now share one Zustand store
  (`state/audioLibraryStore.ts`) with the naming and dedup rules in
  `state/audioNaming.ts` and a `useAudioLibrary()` hook. Verified live: **1
  network request per page instead of six.**
- **Duplicate and inconsistent entries fixed at the source.** Each site stripped
  the `<sha256[:8]>_` prefix with its own regex, and two incompatible forms were
  in use. `/^[0-9a-f]{8}_[0-9a-f]{8}_/` requires *two* prefixes, so it stripped
  nothing from single-prefix names — **12 of the 58 library rows showed a raw
  hash in some selectors and a clean name in others.** One rule now strips any
  number of stacked prefixes; verified in a browser that no dropdown renders a
  hash or a duplicate name.
- **Files with no track name are labelled, not shown as hex.** Four library
  files are named with a bare uuid and are byte-identical to each other; they
  previously rendered as 32 characters of hex. They now read
  `Unnamed track ec2c16`. Collapsing the four into one requires content hashing,
  which is a data decision rather than a rendering one.

### Fixed - Hierarchical separation bypassed the GPU serialising queue

Found by implementing `docs/knowledge/gemini-stem-mixer-ux-2026-10-02/README.md`
and reading the code rather than the brief.

`SourceSeparator` has a single-worker `asyncio.Queue` explicitly documented as
*"Process separation jobs serially to cap GPU memory"*. Single-pass separation
correctly went through it — but `separate(mode="hierarchical")` returned
`_separate_hierarchical(...)` **before** reaching `enqueue()`, and that method
calls `_separate_mdx_net` directly. Two concurrent hierarchical separations would
therefore hold two Demucs models on an 8 GB card: exactly the CUDA OOM the queue
exists to prevent. Reachable from the UI, since `StemMixer` exposes a
separation-mode selector.

Hierarchical needs *more* GPU than single-pass (vocal model, then Demucs on the
residual), so this was the worst case for the unguarded path. Both modes now route
through one `_run_through_queue` helper, and `SeparationJob` carries the `mode` so
the worker can pick a backend — previously the worker had no way to know.

Guarded by `tests/test_separation_queue.py`, which fires two hierarchical and one
single-pass job concurrently and asserts max concurrency is 1. Mutation-checked:
reverting the routing produces *"backends ran 3 at once; GPU work is not
serialised"*.

Worth recording about that check: two earlier mutation attempts produced **false
negatives** — the first replaced `db / 20` in a comment rather than the code, the
second used a tolerance loose enough that the wrong value still passed. A
surviving mutant is not evidence the code is correct.

### Added - dB fader scale and macro presets for the stem mixer

Per the same brief: the mixer used a linear 0–1 slider, so a user could not tell
unity from 0.94, and the brief's corrections are ±1.5 dB — the regime where a
number is required. Now:

- `-24…+6 dB` faders with a live readout and double-click-to-reset per stem
- Balanced / Vocal Boost / Karaoke preset pill, plus a ghost Reset
- Defaults to Balanced (vocals +1.5 / drums 0 / bass −0.5 / other −1.5), so the
  mixer is better than raw separated stems with zero input
- Magnetic snap near 0 dB, strict `<` so exactly ±0.5 dB stays reachable

`dbToGain` lives in a new pure module, `stemMixPresets.ts`, converting to linear
gain only at the `GainNode` boundary — the amplitude-vs-power trap (`/20` vs `/10`)
now has one home, mutation-checked. 28 unit tests, frontend suite 179 passing.

Two deliberate non-changes, recorded in the brief itself: **EQ stays** (removing a
working feature is a product decision, not a mechanical one) and no `mp3_url` was
added, because analysis URLs are never played — only read for `energy_curve`.

### Added - Stem pipeline test coverage (19 tests)

`docs/knowledge-library/stem-system-evaluation-2026.md` finding 3.5 found the whole
stem pipeline covered by two tests, both on the analysis endpoint's empty case. New
`packages/backend/tests/test_stem_pipeline.py` closes the gaps that document named:
the skip-existing separation guard, stem-file serving (WAV bytes, invalid stem name,
bad format, 404s), `get_stems` / `stems-status`, and `find_stem_dir` path resolution
including hash-prefix rename tolerance. Backend suite: **247 passed**, up from 228.

Two traps worth recording:

- A global exception handler rewrites `HTTPException` into
  `{"error": {"code", "message"}}`, not FastAPI's default `detail`. Three tests failed
  against correct endpoints before `_detail()` was added to handle both shapes.
- `..%2Fsecrets` cannot be tested through HTTP — the ASGI router normalises the path
  and 404s before the handler runs. The invalid-stem-name guard is therefore also
  asserted by calling the handler coroutine directly, the only way to reach it.

The skip-existing guard test is mutation-checked: disabling the guard makes it attempt
a real Demucs run and hang, which is precisely the 2–10 minute cost the guard avoids.

### Fixed - STEM_NAMES as a single source of truth, and a hardcoded stem count

Finding 3.2 said the four stem names were spelled out in three places. On the backend
that was true. Replaced the two remaining inline literals:

- `source_separation.py` — `["vocals", "drums", "bass", "other"]` → `STEM_NAMES`
- `stem_analysis.py` — same list → `source_separation.STEM_NAMES`

Also fixed a residue the audit had missed: the skip-existing guard compared against a
literal `>= 4`, the last place assuming exactly four stems. It now computes
`required = len(source_separation.STEM_NAMES)`, so adding a stem cannot silently
disable the guard. Guarded by `test_stem_names_is_single_source_of_truth`.

### Docs - Re-verified the stem audit against source and marked it accurate

The audit is dated 2026-09-30 and had drifted. Every finding was checked against
current code rather than trusted:

- **5 resolved** (2.1, 2.2, 3.1, 3.3, 3.4) — including both criticals; the code was
  ahead of the document.
- **3.5 resolved** by the tests above.
- **4.4 recorded as invalid.** It claimed analysis-path playback always fetches WAV
  because `StemsAnalysisResponse` lacks `mp3_url`. But `Visualizer.tsx` only consumes
  those URLs for `energy_curve` data — it constructs no `Audio` element and sets no
  `.src`. Playback goes through `StemMixer` → `getAudioStems()`, which already prefers
  `stems_mp3` with a WAV fallback. No change made, because the finding describes no
  real cost.
- **5.2's recommendation withdrawn.** Tightening sync from 500 ms to 250 ms would
  contradict the measured result recorded in the code: "checking every frame caused
  audible skipping."
- **4.5 corrected** — the two sampling implementations are now equivalent, so this is
  future-drift insurance rather than a live bug. Also recorded that `getStemEnergy`
  has 12 viz-style consumers, which the original finding did not note.

Remaining work is now ranked by value-per-effort in the document, replacing a table
that assumed all 16 findings were open. Recommended next: 4.1 (`get_stems_status`
blocks the event loop on a large library) then 4.3 (`ensureStems` starts an unattended
2–10 minute separation on a track click).

### Changed - Consolidated duplicated plumbing across tools/

An audit of `tools/` (38 files, ~10,600 lines) found the same four patterns
re-implemented per script, with the copies drifting apart. New
`tools/_toolutil.py` holds them once, following the existing `_gitutil.py`
precedent:

- **Repo-root resolution was written 14 different ways** (`parent.parent`,
  `parents[1]`, inline `sys.path` juggling). Nine tools now import `REPO`,
  `DEFAULT_DB` and `AUDIO_DIR` from one place, so "where does this tool look?"
  is answered by reading one module rather than seven.
- **`tracked_python_files` was duplicated** across the
  `check-subprocess-encoding.py` / `fix-subprocess-encoding.py` pair. The bodies
  were identical and only the docstrings had diverged — the fix copy had lost
  its entirely, so two scanners documenting "the same rule" had stopped
  describing the same thing. Both now use the shared one.
- **`prune-checkpoint-refs.py` documented a `git()` wrapper** without saying what
  it was for. It is `run_git(...).strip()`; the wrapper is legitimate (six call
  sites want the stripped form) but that is now written down, along with why the
  stderr and encoding handling that *matters* lives in `_gitutil.run_git`.

`_toolutil.py` also holds read-only SQLite access, timestamped backups, and the
`VACUUM INTO`-verify-swap compaction, which two tools had each reimplemented with
differing safety. It imports nothing from the application and touches no
network, because a tool that must run standalone cannot depend on the backend
being up.

Net **−52 lines** with 14 tools now sharing one module. Verified by running each
migrated tool and confirming it resolves the same paths and produces the same
output as before.

### Added - Live characterisation tests for the Ollama adapter

The adapter (`adapters/ollama.py`, 1,470 lines) and its shared client
(`core/ollama_client.py`) had **no test coverage at all**, which is why the
`ollama_chat` refactor was deferred: there was nothing to refactor against.

`tests/test_ollama_live.py` runs against a real Ollama and **skips automatically**
when none is reachable (`NMA_OLLAMA_TESTS=1` requires one, `NMA_OLLAMA_URL`
repoints it). Eight tests pin the server behaviours the code depends on, all
established by observation via the new `tools/probe-ollama.py`:

- **`think=False` omits the `thinking` key entirely** rather than returning `""`.
  A caller writing `msg["thinking"]` would raise; the adapter and frontend both
  use `.get(...)`, which is why this was worth pinning.
- **`tool_calls[].function.arguments` is a dict, not a JSON string.** This is
  what `execute_tool_call`'s `**arguments` depends on; a string would make every
  tool call raise `TypeError`.
- **An unknown model raises `RuntimeError`**, rather than returning an empty
  result that would read as success.
- **An empty `messages` list is HTTP 200, not an error** — it looks like success
  and yields nothing, so `done` alone is not proof of a usable answer.
- **An unknown tool returns `"Unknown tool: <name>"` and does not raise**, so a
  caller that never inspects the result feeds that sentence back to the model as
  a successful tool result.

`tools/probe-ollama.py` records all of this from a live server and is the tool to
run first when Ollama behaves oddly. It **probes local models only**, and the
exclusion is authoritative rather than a name guess: Ollama marks remote entries
with `remote_host`/`remote_model`, and a remote entry reports `size: 326`, which
would win the "smallest model" sort and then fail with HTTP 402 — measuring the
network rather than this server. `:cloud` is kept only as a fallback. Each model
is listed as `[local]`/`[remote]` so the split is visible at a glance.

Verified: 10 passed in 2.1 s warm against Ollama 0.35.0; 10 skipped when the
server is absent. All 7 gates pass with 228 pytest.

### Added - A nesting gate, so deep functions cannot come back

- `tools/report-nesting.py` gained a `--baseline` mode and now **fails** the
  repo check when any function's control-flow nesting gets deeper than the
  committed `tools/nesting-baseline.json` (493 functions tracked). It runs in the
  `docs` gate, so `python tools/run-gates.py` and the pre-commit hook both catch a
  regression. Improvements are reported but never fail; re-baselining is a
  deliberate act.
- `tools/verify-nesting-gate.py` is the mutation check: it deepens a real
  function in `api/docs.py`, confirms the gate rejects it, and restores the file.
  Without it, "the gate passes" is only evidence that it has never been seen to
  fail — which is exactly the mistake I made twice in this work.

Building the gate surfaced three failure modes, each found by testing it rather
than assuming:

- **It passed vacuously.** A baseline written for a different root matched no
  functions and reported success. The worst possible outcome for a gate, so the
  gate now requires the baseline to match at least one function and fails
  otherwise.
- **A syntax error made it pass.** Unparseable files were skipped silently, so
  broken source *reduced* the score and looked like an improvement. They are now
  reported and fail the check.
- **Baseline keys were path-dependent.** Running the same tree with a relative
  versus an absolute root produced different keys, so the gate rejected a tree it
  had just accepted. Keys are now relative to the root, and duplicate function
  names get an occurrence index so a deep copy cannot be masked by a shallow one.

Verified: all 7 gates pass; the gate rejects a deliberate `7 -> 8` regression and
accepts both relative and absolute roots.

### Changed - Flatten the two most deeply nested backend functions

- Added `tools/report-nesting.py`, which measures real control-flow nesting depth
  per function (via AST, not indentation heuristics) and flags the anti-patterns
  nesting hides: broad `except Exception` that neither logs nor re-raises,
  deeply nested `return`s, and `try` inside a loop. **118 functions** sit at
  depth ≥ 4; the worst was 9.
- **`get_result` (depth 8, 10 deeply-nested returns) → depth 3.** It contained
  two near-identical ~30-line blocks for images and video, each five levels deep,
  differing only in subdirectory, result `kind`, and timeout. Extracted into
  `_save_comfyui_asset` (download + validate + save one asset) and
  `_collect_comfyui_outputs` (scan nodes for one output type); the endpoint is
  now a 3-line table over `images`/`gifs`/`video`.
- **`get_video_models` (depth 8) → depth 3.** The Wan-variant `if/elif` chain
  sat four levels deep inside two nested loops. Extracted `_wan_variant_fields`
  and `_scan_model_dir`, and replaced the inline tuples with named constants, so
  the variant labels have one definition instead of being interleaved with
  filesystem scanning.
- `get_result` had **no test coverage**, so 12 tests now pin the behaviour it had
  to preserve. One of them failed on first run and the test was wrong, not the
  code: `sanitize_filename("")` raises, so a blank filename is an error rather
  than a fall-through. The test now documents that.

Verified: all 7 gates pass with 218 pytest (was 206). The route surface is
unchanged — 245 paths before and after, confirmed against a stashed HEAD build —
and `/api/integrations/comfyui/video-models` still returns its 5 models.

### Changed - Pooled database connections (removes per-query open/close)

- `get_db()` now takes a **per-thread pooled connection** instead of opening and
  closing one per call. Measured against the real database: **0.015 ms vs
  0.970 ms per call — 65x, 98% less overhead**, across ~113 call sites. The
  savings compound on any request touching several of them.
- **Per-thread, not global**, because `asyncio.to_thread` is used at 61 sites, so
  concurrent DB work genuinely runs on several threads. A single shared
  connection would serialise every query behind sqlite3's internal lock;
  `check_same_thread=False` permits cross-thread use but does not make
  *concurrent* use safe.
- **A pooled connection is only reused while `DB_PATH` is unchanged.** This was a
  real defect, caught by the existing suite: with unconditional reuse, a
  connection opened against the old file kept serving it, producing "no such
  table" errors in 10 tests. Tests and tooling reassign `DB_PATH`, and the same
  hazard applies to any future multi-database mode. `init_db` also drops the pool,
  so the first query after a migration cannot see a pre-migration schema.
- **`release_connection` never returns a mid-transaction connection**, so a caller
  that uses `get_connection()` directly and forgets to commit cannot leak an
  uncommitted write into the next caller. `get_db()`'s own `except` already
  handles the common case, so this guard is only reachable via the lower-level
  API — there is a dedicated test for it.
- **`close_pooled_connections()` runs on shutdown** (`lifespan`). On Windows an
  open handle blocks the database file from being replaced, which would break a
  later compaction or restore. The pool is also bounded at 16 per thread.
- Two functions that open and close their own connection
  (`set_log_analytics_last_cleanup`, `cleanup_old_log_events`) now use
  `get_connection_unpooled()`; closing a *pooled* connection would leave the pool
  holding a reference to a dead connection.
- `wal_autocheckpoint` now visibly works: the `-wal` file sits at 88 KB where it
  previously grew unbounded on a writer that commits every 30 seconds.

Verified: all 7 gates pass with 206 pytest (was 198); backend restarted and
`/api/health`, `/api/audio/files`, `/api/jobs` and `/api/outputs` all respond.
New `tests/test_db_pool.py` covers reuse, isolation, bounding, shutdown and
per-thread behaviour, and the rollback guard is verified by mutation.

### Fixed - SQLite layer: the same VACUUM bug in a second place, plus connection pragmas

- **`cleanup_old_log_events` had the identical `VACUUM`-in-a-transaction
  defect** that was fixed in `cleanup_old_gpu_telemetry`. It called
  `conn.execute("VACUUM")` immediately after a `DELETE`, and Python's sqlite3
  opens a transaction on the first write, so SQLite refused. Because the
  function's `finally` only closed the connection, the exception still propagated
  — this path **raised on every call that deleted ≥1000 rows**, and freed pages
  were never reclaimed.
- **`safe_vacuum(conn)` is now the single way to reclaim space.** It commits
  first, then vacuums, and logs rather than raises on failure — the rows are
  already deleted and later inserts reuse freelist pages regardless. Both
  cleanup paths use it.
- **`cleanup_old_gpu_telemetry` no longer references a closed connection.** The
  previous fix put `safe_vacuum(conn)` *after* the `with get_db()` block, where
  `conn` is out of scope. It now runs inside the block, after the delete.
- **`journal_mode=WAL` is set once in `init_db`, not on every connection.** It is
  a persistent, database-wide property, so re-issuing it across ~113 `get_db()`
  call sites was redundant and could itself fail with "database is locked" while
  readers were active.
- **`synchronous=NORMAL` and `wal_autocheckpoint=1000`** are now set per
  connection. The former avoids an fsync on every commit for a process that
  writes a telemetry row every 30 s; the latter bounds the `-wal` file, which
  otherwise grows without bound on a long-running writer.

New `tests/test_database_connections.py` covers all of it. The tests are
verified to catch the originals by mutation: removing the `commit()` from
`safe_vacuum` reproduces `VACUUM skipped (cannot VACUUM from within a
transaction)` and fails two tests.

### Fixed - The database grew to 549 MB because telemetry was never pruned

- **`gpu_telemetry` held 125,889 rows / 392.8 MB**, each storing a full JSON
  process list (~3.5 KB) every 30 seconds, in a studio whose actual content is
  ~50 audio files. **549.3 MB → 50.8 MB.**
- **The retention guard was unrelated to age.** It read
  `int(event_loop.time()) % 1000 < 10`, which fires only when the monotonic
  clock lands in a narrow band — measured at ~1.7% of cycles. It is now elapsed
  time, expressed as two pure helpers so it is testable without an event loop.
- **`VACUUM` was running inside a transaction**, where SQLite raises "cannot
  VACUUM from within a transaction". The exception aborted the cleanup, so freed
  pages were never reclaimed — which is why the freelist showed only 1.2 MB
  against 548 MB of rows that were almost entirely deletable. The delete now
  commits first and `VACUUM` runs on its own connection.

New `tools/report-db-size.py` attributes the size (works without the `dbstat`
vtab, which the bundled sqlite3 lacks) and `tools/compact-studio-db.py` applies
the policy. The latter compacts via `VACUUM INTO` + verify + swap, so an
interrupted run cannot leave a truncated database. Both are dry-run by default.

Verified: `integrity_check ok`, 50 audio rows intact, and
`/api/health/gpu/history?range=24h` still serves its window.

### Fixed - Audio library database: broken rows and empty metadata

- **5 rows pointed at files that had moved.** Three recorded root-level names for
  files that live in `Suno-V6-Mini/`, and two carried stale hash prefixes from the
  old `uuid4()[:8]_` naming (`90c24323_Context Window (Final Polish).wav` →
  `Context Window (Final Polish).wav`). Both `filename` and `stored_path` now
  resolve.
- **8 rows pointed at files that no longer exist at all** and were listed in every
  selector despite being unservable. All 8 were the *same tracks* surviving on
  disk under another name, so retiring them lost no audio — 58 rows → 50. The
  guard is deliberate: a row is only deleted when a surviving file matches it
  after prefix-stripping. The audit reported `retire-UNSAFE: 0`, meaning no row
  was deleted on the assumption that its content was redundant.
- **`file_size` was `0` on all 58 rows** — the uploader never populated the
  column. Now backfilled from disk for all 50 remaining rows and verified
  byte-for-byte, so content can be compared in future (previously impossible).

New `tools/repair-audio-db.py` (dry-run by default, backs up before writing) and
`tools/audit-audio-db.py` (read-only health check). Verified after: `integrity_check
ok`, `foreign_key_check` clean, 0 unresolvable rows, 0 zero-size rows, and the
Visualizer dropdown shows 0 duplicates and 0 raw-hash entries.

### Added - Tooling guards for the audio path

- `tools/check-subprocess-encoding.py` rejects locale-decoded subprocess output
  (the cause of a confidently wrong "commit is missing" verdict), with
  `tools/fix-subprocess-encoding.py` to apply the fix.
- `tools/prune-checkpoint-refs.py` previews Cline checkpoint refs; it is
  age-based (14 days) by default so recent restore points stay rewindable.
- `tools/snapshot-audio-routes.py` fails on route-surface drift, and duplicate
  audio rows/files are now detected. Note the limit recorded in D15: it cannot
  catch a missing import, since OpenAPI is decorator-generated and never runs a
  handler body.
- System diagnostics reports the serving `sys.prefix`, which is the reliable way
  to confirm the active conda environment — the Windows launcher may display the
  base Python executable.
- `tools/report-missing-audio.py` inventories `audio_files` rows whose file is
  gone, split into relinkable (the file moved, e.g. into a subdirectory) and
  no-trace-on-this-machine. Read-only. It also surfaced that `file_size` is `0`
  for all 58 rows, so content cannot be matched by size.

## [2.0.0] - 2026-10-01

> **Major release.** The audio path is no longer an analysis side-channel — stem
> separation and mixing are now first-class features. Breaking changes are listed
> under **Changed**; the `/api/audio` stem endpoints previously failed at runtime
> (see Fixed) and are now stable.

### Added - Stem separation and mixing as first-class features

- **Per-stem separation** via Demucs 4.1.0 with Spleeter fallback, exposed
  through `POST /api/audio/separate`, `POST /api/audio/separate-file`, and the
  async `GET /api/audio/separate-jobs/{job_id}` polling endpoint.
- **Stem discovery and retrieval** — `GET /api/audio/stems/{filename}`,
  `GET /api/audio/stems-status`, and `GET /api/audio/stem-file/{track}/{stem}`
  serve per-stem WAV, plus lightweight MP3 (~13% of WAV size) encoded lazily on
  first request.
- **Stem-reactive visualisation** — `POST /api/audio/stem-visualization` returns
  shader-uniform-ready per-stem curves; `spectral_bands.py` and
  `useSpectralTimeline` drive band and timeline lookups.
- **Vocal enhancement** — `suno_enhancer.py` provides compression, de-essing,
  normalisation, and reverb/delay returns per stem.
- **Professional mixer** (`professionalMixer/`) — per-channel EQ, compression,
  pan, fader, FX sends, per-bus and master processing, and live metering, sharing
  the page's single `AudioContext` (D4).
- **Equalizer panel, spatial stem assignment** (`stemSpatial.ts`), section-aware
  shader preset state machine (`sectionStateMachine.ts`), and the instanced blob
  field style (`viz-styles/pppanik.tsx`).
- `tools/export_spectral_timeline.py` exports band timelines for offline
  rendering, and `docs/knowledge-library/stem-system-evaluation-2026.md`
  records the evaluation.

### Fixed - Undefined-name crashes in the audio, SSE, and video paths

Six `F821` undefined names and a duplicated method definition were reachable at
runtime and raised `NameError` on execution. They compiled cleanly, so no gate
caught them; `ruff check` (F821) now reports the backend as clean.

- `app/sse/handler.py`: `JobStatus` was referenced by the job-update priority
  logic but never imported, so **every job-status SSE broadcast raised
  `NameError`**. Also removed a second, duplicate `send_job_update` method that
  silently shadowed the first and made its priority computation dead code.
- `app/api/audio.py`: `source_separation`, `SourceSeparator`, and `Any` were
  used but never imported, breaking the stem pipeline — `GET /stems`,
  `GET /stems-status`, `GET /stem-file`, and `POST /separate-file`. Added the
  module import and removed the local imports that were shadowing it.
- `app/services/source_separation.py`: the Spleeter path referenced
  `source_separation.STEM_NAMES` from inside the `source_separation` module
  itself.
- `app/api/video.py`: the canvas-loop endpoint constructed a `RenderSpec(...)`
  that was both undefined and unused; removed it along with the unused
  `fade_in`/`fade_out` locals.
- Removed six genuinely-unused imports and dead locals after confirming each had
  zero remaining usages.

### Fixed - `pnpm type-check` failed on a clean checkout

`tsconfig.tests.json` globbed `tests/**/*.ts`, which swept in
`tests/browser/out/` — the gitignored agent-scratch directory that AGENTS.md
reserves for throwaway artifacts. A fresh clone with scratch output present
failed the build with `error TS18047` in a file nobody authored. All 17 tracked
specs live directly in `tests/`, so `tests/browser/out/**` is now excluded.

### Changed - Visualizer decomposition and audio-graph consolidation

`Visualizer.tsx` was 2,361 lines and `Canvas2DVisualizer.tsx` 1,560. Both are
now orchestration over focused modules, with no logic changes.

- `visualizerHelpers.ts`, `canvas2dHelpers.ts` — pure helpers (file-ref
  encoding, payload narrowers, colour lerp, easing, noise/FBM).
- `components/RenderStats.tsx` — renderer telemetry overlay.
- `useVisualizerRecording.ts` — MP4/WebCodecs capture with WebM fallback; owns
  its recorder and timer teardown.
- `useAudioGraph.ts` — the shared `AudioContext` graph.

**Behavioural fix found during the split:** the graph-construction block
(`AudioContext → analyser → EQ → mainGain → destination`) was copy-pasted three
times — in `setupAudio`, `handleFile`, and `handleSelectLibraryTrack` — and the
two handler copies had already drifted from the original (dropping
`estimateOutputLatency` and its comments). It now exists once, as
`ensureAudioContext()`, so audio setup no longer depends on whether a track was
uploaded or picked from the library.

Also removed `freqArrayRef`, which was written in all three copies and never
read, and a double `AudioContext.close()` on unmount. The recording handlers'
`useCallback` dependency arrays were `[]` while closing over `setError`; they now
declare their real dependencies.

### Fixed - Transient colour shift in the PPPANIK blob field

`InstancedBlobField` accepted a `transientColorShift` prop, renamed it to
`_transientColorShift`, and never used it. `pppanik.tsx` passes `0.3`, so the
value type-checked and looked live while doing nothing — the field rendered a
single flat violet for every one of its 40,000 instances.

Per-instance colour is now written with `setColorAt`: a resting cold-blue →
magenta gradient spread by instance phase, lerped toward a hot orange on
transients. The frame loop reuses the `transientNorm` value already computed for
ejection so colour and motion stay in sync, and the base colours are precomputed
once rather than per frame.

`MeshBasicMaterial.color` changed from violet to white, because material colour
multiplies into the per-instance colour and would otherwise tint every instance.

Verified against Three.js directly: `instanceColor` allocates to 120,000 floats,
1,166 distinct colours, and the hottest instance shifts (0.059, 0.100, 0.301) →
(0.340, 0.249, 0.271). tsc 0, eslint 0 errors, build 0, Playwright 9/9.

### Changed - Gemini guidance docs marked as implemented

The set still read "Nothing here has been committed — review first", written
before the v2.0.0 work landed. Each file now maps to the module that implements
it, records the one deliberate deviation (unverified Ashima `snoise` was not
adopted), and points at `docs/architecture/visualizer.md`.

### Fixed - PPPANIK blob field now driven by audio, not a clock

`InstancedBlobField` animated against `performance.now()`. Its "transient" was
`Math.sin(phase + time * 2.0)` — a fixed-frequency oscillation that fired on a
timer whether or not music was playing. The field was described as
audio-reactive but would have looked identical playing a track, paused, or with
no audio at all.

All motion now derives from live audio:
- **Bass** → radial displacement (was: unscaled clock noise)
- **Beat, or treble > 0.82** → injects a transient envelope that decays at
  3.2/s, so hits throw the spores and they settle rather than blinking
- **Mid** → overall swell on the beat grid; **treble** → fine shimmer
- **`audioData.beatPhase`** drives the phase, falling back to a slow free phase
  only when the backend has no analysed grid

`InstancedBlobField` gained an `idlePreview` shimmer (default 0.35) that scales as
`1 - max(bass, mid, treble) * 1.6`. Measured: in silence the idle mix is 0.350
with a 0.5177 radius spread so the style is visible pre-playback; under loud
audio it falls to 0.0000 and the spread becomes 0.4214 from real bass alone; in a
quiet passage it blends at 0.2660. Idle can therefore never mask a genuine
reaction.

Idle motion is welcome and expected — styles must stay previewable before
playback, which is why `ShaderCanvas` keeps its clock for `u_time`. The rule is
that idle animation must never *masquerade* as a reaction, so it blends out as
soon as real audio energy arrives.

`pppanik.tsx` feeds real values, preferring the spectral bands in
`audioData.current` and falling back to analysed stem curves via `getStemEnergy`
when stems aren't separated. Drivers are passed as a **ref**, not props: R3F
doesn't re-render per frame, so props would freeze at the last React render.

Per the project rule that visuals follow audio and only UI chrome animates on
its own, `Canvas2DVisualizer`'s explicitly-labelled idle/ambient layer and
`three-particles` (clock for integration, audio scales the rate) were audited
and left alone. `ShaderCanvas` likewise keeps its clock for `u_time` so shader
presets stay inspectable before playback.

### Fixed - Text files committed as UTF-16, and a text-encoding guard

`tools/design-feedback/README.md` was tracked as **UTF-16LE** — the signature of a
PowerShell `>` redirect. Git displayed it as a binary blob, every text tool read
mojibake, and the knowledge-library mojibake checks could not parse it at all.
Content was intact; only the encoding was wrong. Converted to UTF-8 with LF line
endings, verified byte-identical after decoding.

Added `tools/check-text-encoding.py` and wired it into `tools/check-all.py` and
the pre-commit hook. It rejects UTF-16, NUL bytes, and invalid UTF-8 across all
885 tracked text files, while deliberately **allowing** a UTF-8 BOM — six tracked
files (`.ps1`, `.csproj`, `.slnx`, `.json`) need one for PowerShell and Unity.
Verified against deliberately corrupted fixtures: both the UTF-16 and NUL-byte
cases fail as intended.

### Fixed - Stale pppanik header and stray CHANGELOG trailers

`pppanik.tsx`'s doc comment still described the pre-fix behaviour ("Bass → noise
displacement") and omitted the ref-based driver handoff. Two `Co-Authored-By`
trailers had also been left inside the CHANGELOG body, splitting a section and
interrupting the paragraph flow. Both corrected.

### Fixed - Machine PATH traps documented in AGENTS.md

A `bash` invocation was run expecting Git Bash; on this workstation bare `bash`
resolves to `C:\Windows\System32\bash.exe`, the **WSL launcher**. It failed while
translating a Windows PATH entry (an unrelated Android SDK path) and surfaced an
error mentioning tools that have nothing to do with this project. Running the
repo hook installer via `C:\Program Files\Git\bin\bash.exe` works.

`AGENTS.md` now records the three bare names that mislead on this machine, each
verified by resolving it rather than assumed:

| Bare name | Resolves to |
|---|---|
| `bash` | WSL launcher (not Git Bash) |
| `python` | `C:\Python314` **3.14.7** — lacks the backend deps; the project interpreter is `nma-studio-cuda` **3.11.9** |
| `node` | fnm alias; `npm.cmd` is present on two PATH entries |

Also clarified that the project's PowerShell 7.6+ requirement applies to its own
scripts, not to the agent shell, which is PowerShell 5.1.

**No PowerShell profile was modified** — none of the four `$PROFILE` paths exist
on this machine, so the confusion comes from the system PATH, not a profile.
Editing one would have treated the wrong cause.

### Changed - Renamed machine-generated benchmark files, untracked a build cache

Three benchmark JSON files carried run ids in their names
(`audio-bench-20260906_194811.json`), which are meaningless to a human reader and
go stale as soon as the benchmark is re-run. Renamed to describe what they hold:
`audio-analysis-backends.json`, `audio-analysis-backends-run2.json`, and
`video-render-backends.json`. The two renderer docstrings that cited the old
video-bench path were updated to match.

`tools/hyperframes-built-this-from-a-dream/.waveform-cache/` held a single file
named `v2_Built This From A Dream.mp3_7325546-1788280340000.json` — a content hash
plus an epoch-ms run id. It is derived data regenerated on every build, so it is
now gitignored and untracked rather than renamed. The file remains on disk.

A repo-wide filename scan also flagged `__init__.py` and the
`UPPER_SNAKE_CASE` markdown docs; both were deliberately left alone.
`__init__.py` is required by Python's import machinery, and the shouty doc names
are a consistent house convention, not obfuscation.

### Added - Self-describing `_about` blocks in frontend-driving JSON

The JSON data files that drive frontend features were bare payloads with no
indication of what they were for. An agent (or a person) opening
`track-lyrics/index.json` saw only `{tracks:[...]}` with nothing saying it feeds
the Kinetic Typography page, or that the timing is estimated rather than real.
The knowledge-library JSONs already carried `title`/`version`/`description`; the
consumed configs did not.

Added an `_about` block to the four files a reader most needs context for:
`packages/frontend/public/track-lyrics/index.json`, `config/ports.json`,
`config/tracks.json`, and `config/model_routing.json`. Each records its purpose,
the modules that consume it, a per-field schema, and how to extend it safely.

Non-obvious facts now live in the files rather than only in code:
- `track-lyrics/index.json` timing is **estimated** by spreading lines evenly
  across `durationSec` — preview only, never for final renders.
- `model_routing.json` rules are **first-match-wins** and order-dependent, so a
  new rule must be inserted above any broader rule it should override.
- `ports.json` naming convention (`*_port` = number, `*_url` = full URL) and
  which of the services are optional.

Keys are underscore-prefixed so they group together and cannot collide with a
data key. TypeScript interfaces are structural, and both `portConfig.ts` and
`vite.config.ts` read only named fields rather than iterating, so the extra keys
are inert. Verified: tsc 0, eslint 0 errors, Playwright 10/10, 34 routes.

### Changed - Trusting gate output on Windows

`pnpm type-check` and `pnpm lint` reported exit code 1 through the PowerShell
`.ps1` wrapper while actually passing, because the wrapper writes notices to
stderr and swallows the child's status. For any gate whose exit code matters,
run it via `pnpm.cmd` from Python `subprocess` with an explicit `cwd` and read
`returncode`. Treat an empty capture as "failed to capture", never "passed".

### Added - Knowledge-library validation and local pre-commit guard

- `tools/validate-knowledge-tags.py` checks every library document has YAML
  frontmatter whose **first** tag is a primary category, that `aliases`,
  `cssclasses` and `date` are present, that no mojibake remains, that
  `migration-progress.md` lists each document in the correct section with
  correct counts, and that markdown is LF. Vocabulary drift is reported in both
  directions: a tag in use but absent from the guide, and a guide tag no
  document uses.
- `scripts/git-hooks/pre-commit` runs that validator when staged changes touch
  `docs/knowledge-library/`, and is silent on every other commit (~250ms).
  Installed by `scripts/install-git-hooks.sh`, which is idempotent, backs up any
  hook it replaces, and preserves a pre-existing `pre-commit` by calling it.
- No CI (D10): local hooks are the only automated guard, so they must be
  installed once after cloning with `bash scripts/install-git-hooks.sh`.
- `docs/knowledge-library/tagging-guide.md` documents the extended tag vocabulary
  actually in use; the migration checklist now requires the primary tag first.

### Fixed - Knowledge-library tag consistency

- Repaired double-encoded emoji in `migration-progress.md`, where a lossy console
  round-trip had rendered every heading marker and entry tick as mojibake.
- Corrected the primary category on four documents that led with a cross-cutting
  tag, and re-filed tracker entries whose section contradicted their tag.
- Restored LF line endings in `index.md` and added `.gitattributes` pinning
  markdown to LF, after a text-mode rewrite turned a 20-line count edit into a
  234-line diff.
- Recomputed `index.md` tag counts from the documents themselves; they had
  drifted to totals of 72 against a stated 64.

### Added - Toast system

- `error` is a first-class toast type with its own variant, `role="alert"` and the
  longest duration; genuine failures no longer report as warnings.
- De-duplication of identical live messages, a four-toast stack cap, a dismiss
  button, per-toast `detail` text, and `duration: 0` for sticky toasts.
- Live-region ARIA semantics; timers pause on hover and keyboard focus.
- 13 Playwright tests (`tests/toast.spec.ts`); `MediaLibrary` consolidated onto the
  shared utility, replacing a bespoke toast and a blocking `alert()`.

### Fixed - Public tunnel access for sandbox VM agents

- CORS: `CORSMiddleware` now matches tunnel origins by pattern
  (`allow_origin_regex`). It previously used a static list, so randomized
  tunnel hostnames failed every preflight with 400 and no ACAO header.
- Vite 8 no longer treats `allowedHosts: "all"` as a wildcard, which returned
  `403 Blocked request` for every tunnel host. Replaced with an explicit
  hostname/suffix list on `server` and `preview`; unknown hosts stay blocked.
- The tunnel publishes **only** the Vite dev server, which proxies `/api`,
  `/output` and `/ws` to the backend, so a single public URL serves UI and API.
  This is what fits a free ngrok account, which serves one endpoint at a time
  (`ERR_NGROK_334` otherwise). `-Target both` restores two endpoints.
- `start-tunnel.ps1` tracks the real tunnel PIDs, sweeps orphans, and probes
  the live endpoint before advertising it.
- `sseService` prefers the same-origin `/api/events` proxy when tunneled;
  `getEventsUrl()` returns an absolute `127.0.0.1` address that resolves to the
  *agent's* machine, so real-time updates stalled on every load.
- Added `scripts/check-tunnel.ps1` to re-probe a live tunnel; the startup
  `Verified` flag goes stale when the free tier drops a connection.

### Fixed - UI

- `components.css` gradients were written `in oklch, 145deg`; the angle must
  precede the interpolation method, so all 15 declarations were invalid and
  silently dropped. Reordered.
- Added contrast-safe text tokens (`error-text`, `success-text`, `link`), a
  dark-mode gray ramp remediation, and a `light:` variant for the manual
  theme toggle.

### Fixed - Tooling

- `tsconfig.tests.json` now matches the app compiler options
  (`useDefineForClassFields`, `isolatedModules`) so tests are type-checked
  under the same rules as the code they exercise.
- `scripts/**/*.ps1` ignore pattern now covers subdirectories, and the tunnel
  scripts are explicitly re-included so they stay versioned.
## [1.8.0] - 2026-09-23

> First tagged release. Incorporates all prior `[Unreleased]` entries below,
> which were committed without versioning.

### Added - Logging correlation + log analytics hardening

- `X-Request-ID` is now a real correlation id: `RequestIDMiddleware` sets a
  `contextvars` id per request, every log record carries `[request_id]`, slow
  requests log at INFO (health/SSE/fast at DEBUG), and the exception handler
  logs method + path + request id.
- `POST /api/integrations/config/settings` `log_level` changes apply live via
  `apply_log_level()` (validated, 422 on bad values) — no restart.
- `GET /api/logs/{name}` returns 404 for unknown logs; `POST /api/logs/clear`
  truncates handler-safely (no more NUL padding); `/frontend` batches capped
  at 100 entries with level validation and message truncation.
- `read_log_tail` is now a bounded deque (no full-file reads);
  `get_recent_errors` scans newest-first and skips traceback continuations.
- Log analytics parser strips `[request-id]` prefixes so grouped messages
  stay grouped; `get_tracer()` returns a no-op tracer instead of `None`.
- Frontend `logger.ts`: one shared flush timer across all loggers (was one
  interval per source), `sendBeacon` on hide/unload with keepalive fallback,
  direct-backend fallback for detached frontends.

### Added - Centralized ComfyUI path resolution

- New `core/paths.py` helpers (`comfyui_dir/output/input/models_dir`) honor
  `config.comfyui_output_dir` — replacing scattered `PROJECT_ROOT.parent /
  "ComfyUI"` literals and machine-specific absolute paths in `outputs.py`,
  `upscale_service.py`, `comfyui_manager.py`, `comfyui_client.py`,
  `logging_config.py`, and `gen3d_service.py`.
- Fixed a real derivation bug: with an explicit output dir, the upscale input
  dir resolved to `ComfyUI/ComfyUI`.
- Upscale temp inputs (`nma_upscale_*`) are now deleted after use (3 stale
  files removed from ComfyUI `input/`).

### Added - Script organization + model maintenance tools

- All 27 Python helpers moved out of `docs/scratch/` → `tools/scripts/`
  (16 utilities) and `tools/tests/` (11 live verification scripts + fixture);
  `AGENTS.md` documents the convention.
- Consolidated duplicates: 3 `/object_info` probers → `comfyui_model_audit.py`
  (`dump` + `verify` modes); 2 model downloaders → `comfyui_download_models.py`
  (`--set qwen-upscalers|wan22|all`, portable ComfyUI resolution).
- New `tools/tests/vision_eval.py` harness (6 fixed cases, JSONL baseline)
  plus `comfyui_fix_models.py` one-shot model-folder repair (placeholders
  removed, duplicates hardlinked, motion module relocated).

### Added - Frontend loading + CSS/theming overhaul

- Route-level `PageLoader` replaces the blank `Suspense fallback={null}`.
- `@theme` block maps design tokens to utilities — ~600 `text-muted` /
  `bg-surface` / `text-primary` usages previously generated **zero CSS**.
- New `.shimmer` skeleton utility (MediaLibrary placeholders were static);
  gradients interpolate `in oklch`; `transition: all` scoped (15 sites);
  selects/inputs/secondary buttons/neumorphic made theme-aware (no more
  hardcoded dark hexes or `!important`); duplicate `kt-spin` keyframes removed.
- Accessibility: `prefers-contrast: more` hardening, `forced-colors` focus
  fallback, brand `::selection`, balanced headlines, reduced-motion intact.
- Layer order documented as load-bearing (`base` before `theme` keeps the
  `color-scheme` toggle working — layers beat specificity).
- Research captured in `docs/knowledge-library/modern-css-2026.md`.

### Added - Vision pipeline reliability + Ollama prompting

- `vision_describe`/`vision_ocr` were timing out past MCP limits: first-attempt
  `num_predict` 1024→4096 (a cap, not a target) cut UI audits 43s→17s;
  `done_reason` gating (instead of punctuation heuristics) cut a failing OCR
  case 90s→14s; best-result tracking stops retries erasing successes; dead
  VRAM warmup helpers wired in; keep-alive 30m.
- Task→model routing in `analyze.mjs` (`MODEL_PROFILES` + `MODE_MODEL` +
  `--model` override): OCR/table/chart → minicpm-v:8b (10s warm),
  compare → qwen3-vl:2b (262K ctx), default gemma4 — with resident-model
  stickiness (capability-verified, never text models) because cold loads cost
  30–100s. `--json` reports the actual serving model.
- `plan_blender_script` and Unity `plan_unity_scene` now send Ollama `format`
  JSON schemas (constrained decoding) plus few-shot/negative guidance;
  Blender schema validated live (exact keys), Unity fired live (24s, zero
  invented commands). Research in `docs/knowledge-library/ollama-prompting-2026.md`.
- Baseline: vision eval 6/6 PASS; backend 63/63 tests; `tsc` + `vite build` clean.

## [Unreleased]


### Added - Toast system

- `error` is a first-class toast type with its own variant, `role="alert"` and the
  longest duration; genuine failures no longer report as warnings.
- De-duplication of identical live messages, a four-toast stack cap, a dismiss
  button, per-toast `detail` text, and `duration: 0` for sticky toasts.
- Live-region ARIA semantics; timers pause on hover and keyboard focus.
- 13 Playwright tests (`tests/toast.spec.ts`); `MediaLibrary` consolidated onto the
  shared utility, replacing a bespoke toast and a blocking `alert()`.

### Fixed - Public tunnel access for sandbox VM agents

- CORS: `CORSMiddleware` now matches tunnel origins by pattern
  (`allow_origin_regex`). It previously used a static list, so randomized
  tunnel hostnames failed every preflight with 400 and no ACAO header.
- Vite 8 no longer treats `allowedHosts: "all"` as a wildcard, which returned
  `403 Blocked request` for every tunnel host. Replaced with an explicit
  hostname/suffix list on `server` and `preview`; unknown hosts stay blocked.
- The tunnel publishes **only** the Vite dev server, which proxies `/api`,
  `/output` and `/ws` to the backend, so a single public URL serves UI and API.
  This is what fits a free ngrok account, which serves one endpoint at a time
  (`ERR_NGROK_334` otherwise). `-Target both` restores two endpoints.
- `start-tunnel.ps1` tracks the real tunnel PIDs, sweeps orphans, and probes
  the live endpoint before advertising it.
- `sseService` prefers the same-origin `/api/events` proxy when tunneled;
  `getEventsUrl()` returns an absolute `127.0.0.1` address that resolves to the
  *agent's* machine, so real-time updates stalled on every load.
- Added `scripts/check-tunnel.ps1` to re-probe a live tunnel; the startup
  `Verified` flag goes stale when the free tier drops a connection.

### Fixed - UI

- `components.css` gradients were written `in oklch, 145deg`; the angle must
  precede the interpolation method, so all 15 declarations were invalid and
  silently dropped. Reordered.
- Added contrast-safe text tokens (`error-text`, `success-text`, `link`), a
  dark-mode gray ramp remediation, and a `light:` variant for the manual
  theme toggle.

### Fixed - Tooling

- `tsconfig.tests.json` now matches the app compiler options
  (`useDefineForClassFields`, `isolatedModules`) so tests are type-checked
  under the same rules as the code they exercise.
- `scripts/**/*.ps1` ignore pattern now covers subdirectories, and the tunnel
  scripts are explicitly re-included so they stay versioned.
### Fixed - Audio analysis payload, contract + correctness (2026-09-21)

Review of the analysis pipeline (`app/api/audio.py`, `app/services/audio_analyzer.py`, `tools/lib/audio.py`) found several real defects; all are fixed and verified.

- **Payload reduced 16×**: `_build_analysis_result` emitted the full-resolution RMS envelope (~23k points on a 4-min track) four times per response — `energy_curve` (documented as "60-100 points for viz") was full-res, and both `timing_contract.energyCurve` (23k dicts) and `timing_contract.amplitudeEnvelope` duplicated it. Measured: **1091 KiB → 70 KiB** on the HITL-V2 stem, *with* new downbeat and spectral data added. Curves are now downsampled once (`energy_curve`=100, `amplitude_envelope`≤1024) and reused.
- **Silent beat truncation**: `beat_times` was capped at 800 while `beat_count` reported the true count (a 230 s track reported 1029 beats but shipped only 800, desyncing the tail of long/high-tempo tracks). Cap raised to 4000 with an explicit `beats_truncated` flag.
- **Downbeats were a beat-gap heuristic** (`gap > 1.5× beat period`), which almost never marks a real bar line. Now every 4th beat (4/4), matching `scripts/generate_timing_contract.py` and the `stillIRiseTiming` reference (336 beats / 84 downbeats), plus a new `downbeat_times` field.
- **Beat energies were raw RMS** (~0.05) despite the shared contract documenting 0..1. Now normalized.
- **Hardcoded `confidence=1.0`** in `_extract_beat_features` (and 1.0 fallbacks in madmom/sonara) made every track look equally trustworthy. Replaced with `beat_confidence()` — interval-stability + tempo-agreement based (0.971 measured on a steady track).
- **`tools/lib/audio.py` ffmpeg fallback was broken**: `cmd.insert(-2, "-ar")` produced `-ac -ar 22050 2 out.wav`, so any `.m4a`/`.mp4`/`.aac` that librosa cannot decode failed to load. Rebuilt the argument list and switched to per-call `tempfile.mkstemp` (the old fixed temp name collided between concurrent analyses).
- **`/api/audio/analyze-cuda` decoded + beat-tracked the file twice** per request (once for the CUDA pass, once for librosa). Added `AudioAnalyzer.analyze_from_audio()` and `analyze_with_cuda(y=…, include_audio/beats=…)` so both passes share one decode; CUDA envelope overrides are now downsample-consistent.
- **`audio_analysis_handler.save_analysis()` called `analyzer.save_to_json()`**, which did not exist (`AttributeError` on every custom-path save). Added the public `save_to_json(result, output_path=None)`; `_save_to_json` is now a thin wrapper over a shared `_result_payload()` that also persists downbeats.
- **madmom path mislabeled downbeats as onsets** (`onset_frames=downbeat_frames`) — real librosa onsets are now computed and downbeats travel in their own fields. **sonara path** now prefers engine-provided `beat_times` instead of re-deriving them with our hop length (hop mismatch misplaced beats).
- **Other fixes**: `_downsample_curve` divided by zero for `max_points < 2`; `file_path.relative_to(AUDIO_DIR)` raised `ValueError` for paths outside the library (new `_relative_audio_path`); `get_analysis_by_filename` never cached the JSON-index result (every request re-parsed a multi-MB file); `get_analysis_result` echoed the request `Origin` in `Access-Control-Allow-Origin`, bypassing the app's CORS allowlist, and matched job ids by substring; `analyze-all` re-read + rewrote the index per file and keyed by basename (splitting entries for `output/audio/<album>/` subfolders); analysis JSON writes moved to UTF-8; `/analysis/summary` advertised `has_spectral` from keys this payload never contained (always false) — now reports a real compact `spectral` block plus `has_downbeats`.

### Added - GPU offloads for CPU-bound audio DSP (2026-09-21)

Audit of CPU-only hotpaths (backend services, music-gen, Go sidecars) found three genuine cases; all fixed and verified on the GTX 1070 Ti:

- **`cuda/processor._analyze_cpu` returned zero-filled `spectral_rolloff` / `spectral_bandwidth` / `onset_envelope`** — the "CPU fallback" was a stub, so non-CUDA environments (and any CUDA exception) silently lost 3 of 6 features. Now fully implemented in numpy (85% rolloff via cumsum/argmax, bandwidth as weighted std-dev around centroid, positive log-magnitude frame diff for onset). Also fixed a latent centroid broadcasting bug in the same method (`(freqs * stft).sum(axis=0)` had bins/frames swapped).
- **New `resample_audio_gpu()`** (`audio_analyzer.py`): `torchaudio.functional.resample` on CUDA with librosa fallback — the madmom-infer path resampled 4-minute tracks on CPU (librosa/soxr); GPU resample of 3×10 s buffers now takes 0.01 s.
- **torchaudio Spectrogram window device bug**: `window_fn=torch.hann_window` builds the window on CPU, so the "primary" CUDA path raised `input and window must be on the same device` on **every call** and silently ran the legacy torch.stft fallback. Window is now device-bound via lambda; the real torchaudio CUDA path works (`computed_on=cuda` verified).

Audited and confirmed intentionally CPU (no change): librosa `beat_track`/`onset_*` (no GPU equivalent), loudness via FFmpeg `ebur128`/`loudnorm`, thumbnails via FFmpeg `scale=`, music-gen ACE-Step (`device=auto`, intentional Tier-3 CPU offload for 8 GB VRAM), VRAM manager (no unnecessary eviction), Go sidecars (only FFmpeg shells). Backend tests 49/49 pass; GPU/CPU smoke suite in `tools/tests/test_gpu_offloads.py` passes 9/9.

### Added - madmom-infer + sonara analysis backends wired (2026-09-21)

Both packages referenced by the analyzer were present in `nma-studio-cuda` but the wiring called APIs that do not exist.

- **madmom-infer 0.2.0**: `_analyze_madmom` now runs the real ported pipeline (`madmom_infer.features.downbeats.{RNNDownBeatProcessor, DBNDownBeatTrackingProcessor}` with `beats_per_bar=[3,4]`), resampling input to 44100 Hz first, yielding neural beats + downbeats + tempo + librosa onsets. Verified on the HITL track: 288 beats / 72 downbeats, half-time 71.4 BPM vs librosa's 140.6 — same grid an octave down, ideal for bar-line visuals but not for fast pulse. First use downloads the CC BY-NC-SA 4.0 (non-commercial) BLSTM weights (~3 MB) into `~/.cache/madmom_infer/models/`.
- **sonara 0.3.6**: `_analyze_sonara` now feeds `analyze_signal()` on float32 mono 22050 Hz decoded via librosa, because sonara's bundled decoder reads the stereo M4A as 2× duration and hallucinates phantom beats. Verified: correct 246.5 s timeline, 580 beats, 142.6 BPM (conf 0.74) in 2.3 s + loudness/timbre stats (`loudness_lufs`, `dynamic_range_db`, `spectral_centroid_mean`, `onset_density`) carried into metadata. Frame indices convert via `provenance`-reported sr=22050/hop=512 (`_sonara_frames_to_time`).
- **Per-backend selection**: `backend=librosa|madmom|sonara` on `POST /api/audio/analyze`, `POST /api/audio/ensure-analysis`, `POST /api/audio/analyze-all`; `/api/audio/backends` now reports `[sonara, madmom, librosa]`.
- The `pip index versions` "INSTALLED" quirk (both were installed long before the wiring matched) is documented in `requirements-experimental.txt`.

### Added - faster-whisper GPU transcription (2026-09-21)

Installed `faster-whisper 1.2.1` + `ctranslate2 4.8.2` into `nma-studio-cuda`, activating `POST /api/audio/transcribe`.

- **CUDA libs**: `nvidia-cublas-cu12` / `nvidia-cudnn-cu12` pip packages; scripts must `os.add_dll_directory()` their `bin/` dirs before importing faster-whisper (see `tools/scripts/transcribe_hitl_v2.py`).
- **Pascal (sm_61) constraint**: CTranslate2 on GTX 1070 Ti supports only `float32` on GPU — `int8`/`float16` need Turing+. Use `compute_type="float32"`.
- **Verified on HITL-V2 vocals stem**: `large-v3-turbo` (809M params, ~3.2 GB VRAM) transcribed 246.5s in 15.6s (~16× realtime); `base` in 17.8s. Turbo transcript is lyrics-grade (consistent "you glitch", coherent verses) vs base's hallucinated loops.
- **Backend hardening (`app/services/transcription.py`)**: capability-aware CTranslate2 compute type (`_whisper_device_config`: sm_70+ → float16, Pascal → float32, else CPU int8) — the old hardcoded `float16` would have crashed on Pascal; automatic cuBLAS/cuDNN DLL dir registration on Windows; default model changed `medium` → `large-v3-turbo` (better accuracy, faster, same ~3 GB footprint).
- **Frontend**: StemMixer prefers `stems_mp3` URLs (~87% smaller transfers) with WAV fallback.

### Added - MP3 stem encoding and serving (2026-09-21)

- **Auto-encode on separation**: `_separate_demucs`/`_separate_spleeter` now encode MP3 copies (`libmp3lame` VBR ~190kbps, ~13% of WAV size) alongside the WAVs, in parallel and best-effort. `SeparationResult.stems_mp3` and `StemSeparationResponse.stems_mp3` expose the paths.
- **`GET /api/audio/stem-file/{track}/{stem}?format=mp3`**: serves the cached MP3, or lazy-encodes from the WAV on first request (covers stems separated before this feature). WAV remains the default.
- **`GET /api/audio/stems/{filename}`**: new `stems_mp3` map with ready-to-use MP3 URLs for every stem.
- **Verified**: 9/9 checks — cached serve (5.4 MiB vs 41.5 MiB WAV), lazy encode of legacy `take-the-crown` stems, `format` validation (400), and auto-encode in `POST /api/audio/separate`.

### Added - Demucs stem separation activated (2026-09-21)

Installed and wired Demucs for `POST /api/audio/separate` and the Visualizer StemMixer.

- **Install**: `demucs 4.1.0` in `nma-studio-cuda` via `pip install --no-deps` + explicit deps (`julius`, `dora-search`, `diffq`, `lameenc`, `openunmix`, `submitit`, `sphn`) to protect the Pascal/sm_61-safe `torch 2.14.0+cu126` build. CUDA-verified on GTX 1070 Ti (10s track → 4 stems in ~12s).
- **Backend fix (`app/services/source_separation.py`)**: `_find_demucs()` now prefers `sys.executable -m demucs` over PATH, so separation always runs in the studio env instead of the base Python 3.11 install's `demucs.exe` (torch 2.4.0 / NumPy 2.x conflict).
- **Backend fix**: removed `--filename "{stem}.{ext}"` override which flattened output into `output/stems/<model>/` and broke both stem collection and `GET /api/audio/stems/{filename}` (default `{track}/{stem}.{ext}` layout restored).
- **Backend fix**: `_separate_demucs` no longer returns `None` when `asyncio.create_subprocess_exec` succeeds (returncode/stem collection now shared across subprocess paths).
- **Verified end-to-end**: `POST /api/audio/separate` → all 4 stems; `GET /api/audio/stems/{filename}` → `found: true`.

### Changed - Frontend API modularization and integration hardening (2026-09-21)

Split the monolithic `packages/frontend/src/services/api.ts` (2,857 lines) into domain-specific modules under `packages/frontend/src/services/api/`:
`core.ts`, `jobs.ts`, `health.ts`, `settings.ts`, `generation.ts`, `audio.ts`, `logs.ts`, `data.ts`, `gpu-3d.ts`, `vision.ts`, `native.ts`, `media.ts`, `diagnostics.ts`, `ollama.ts`, `integrations.ts`, `mcp-hyperframes.ts`, `video-render.ts`, `docs.ts`, plus a barrel `index.ts`.
All existing `../../services/api` imports remain valid through the barrel re-export.
Verified with `tsc --noEmit` clean and `vite build` success.

- **Frontend integration fixes**: `ArtDirection.tsx`, `StoryboardPage.tsx`, `useBeatTimeline.ts`, `useTrackMetadata.ts`, and `useTrackManager.ts` migrated from stale raw `/api/audio/analysis/{filename}` calls to the typed `getAnalysis()` wrapper (`/api/audio/analysis/by-filename/{filename:path}`).
- **Settings integration fix**: `Settings.tsx` switched from non-existent `/api/integrations/{type}/health` to `getIntegrationStatus()` wrapper; added typed `IntegrationStatus` interface.
- **Health/VRAM wiring**: `healthStore.ts` now uses the typed `getVRAMStatus()` wrapper instead of inline `fetch`, improving error handling and type safety.
- **Backend cleanup**: Removed unused dependencies `pydantic-settings>=2.0.0` and `requests>=2.32.0` from `packages/backend/requirements.txt`.
- **Documentation**: Documented system CUDA Toolkit 12.4 path (`C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4`) in `AGENTS.md`, `docs/setup/python-environments.md`, `docs/setup/SETUP_SUMMARY.md`, and `.python-env`.
- **Git hygiene**: Updated `.gitignore` to exclude `.comfyui-backups/`, `docs/scratch/*.py`, `scripts/list_routes.py`, and root scratch artifacts.

### Changed - PowerShell script modernization (2026-09-19)

Consolidated and modernized all project PowerShell scripts to require PowerShell 7.6+,
using shared utilities and native cmdlets.

- **Removed duplicates**: `scripts/utility/check_status.ps1` (superseded by `manage-servers.ps1 -Action status`) and `scripts/utility/stop_ports.ps1` (superseded by `manage-servers.ps1 -Action stop`).
- **Shared utilities**: Added `scripts/shared-utils.ps1` with `Get-PortsConfig`, `Start-ProcessSafe`, `Wait-ForPort`, `Stop-PortOwner`, `Sync-PortsConfigToFrontend`, `Resolve-Executable`, and console helpers (`Write-Step`, `Write-Ok`, `Write-Warn`, `Write-Err`).
- **Scripts refactored**:
  - `scripts/manage-servers.ps1` — dot-sources `shared-utils.ps1`, uses `Get-PortsConfig` + `Write-*` helpers, replaced `curl.exe` with `Invoke-WebRequest`/`Invoke-RestMethod`.
  - `scripts/start-services.ps1` — reduced to 38-line thin wrapper delegating to `manage-servers.ps1`.
  - `scripts/start-studio.ps1` — fixed duplicate `Stop-PortOwner` function name, added `SupportsShouldProcess`, optional `-ComfyUI`/`-VideoEditor`/`-Clean` params, auto-restart with exponential backoff, uses `Start-ProcessSafe`/`Wait-ForPort`/`Get-LogTail`.
  - `scripts/start_dev.ps1` — added `[CmdletBinding()]` and comment-based help.
  - `scripts/utility/tests/test-3d-gen.ps1` — dynamic backend port, dot-sources shared utils.
- **Documentation**: Replaced `powershell -NoProfile ...` with `pwsh -NoProfile ...` across `README.md`, `Guidelines.md`, `docs/setup/SETUP_SUMMARY.md`, `docs/setup/python-environments.md`.
- **Verification**: All 9 modernized scripts parse cleanly via `System.Management.Automation.Language.Parser`.

### Changed - Dependency upgrades across all stacks (2026-09-18)

Routine dependency sweep across npm, Python, and Go ecosystems.

**npm/pnpm**
| Package | Before | After |
|---------|--------|-------|
| wavesurfer.js | 7.12.11 | 7.12.12 |
| zod | 4.5.4 | 4.6.5 |
| typescript-eslint (catalog) | 8.68.0 | 8.69.0 |

**Python (19 packages)**
| Package | Before | After |
|---------|--------|-------|
| attrs | 25.4.0 | 26.1.0 |
| blessed | 1.49.0 | 1.50.0 |
| coverage | 7.16.0 | 7.16.1 |
| filelock | 3.32.3 | 4.0.0 |
| idna | 3.19 | 3.20 |
| multidict | 6.7.1 | 6.8.0 |
| narwhals | 2.25.0 | 2.26.0 |
| platformdirs | 4.11.7 | 4.11.10 |
| propcache | 0.5.2 | 0.5.4 |
| python-socketio | 5.16.4 | 5.17.0 |
| regex | 2026.9.3 | 2026.9.10 |
| scikit-learn | 1.9.0 | 1.9.1 |
| setuptools | 78.1.0 | 84.0.0 |
| threadpoolctl | 3.6.0 | 3.7.0 |
| tqdm | 4.70.0 | 4.70.1 |
| urllib3 | 2.7.0 | 2.8.0 |
| uvicorn | 0.52.4 | 0.53.0 |
| wcwidth | 0.8.3 | 0.8.4 |
| yarl | 1.24.5 | 1.25.1 |

**Go (all 5 services)**
| Package | Before | After |
|---------|--------|-------|
| gin-gonic/gin | 1.10.0 | 1.12.0 |
| gin-contrib/sse | 0.1.0 | 1.1.2 |
| go-playground/validator | 10.20.0 | 10.30.4 |
| bytedance/sonic | 1.11.6 | 1.15.4 |
| goccy/go-json | 0.10.2 | 0.10.6 |
| klauspost/cpuid/v2 | 2.2.7 | 2.4.0 |
| mattn/go-isatty | 0.0.20 | 0.0.24 |
| pelletier/go-toml/v2 | 2.2.2 | 2.4.3 |
| ugorji/go/codec | 1.2.12 | 1.3.2 |
| golang.org/x/arch | 0.8.0 | 0.31.0 |
| golang.org/x/crypto | 0.23.0 | 0.57.0 |
| golang.org/x/net | 0.25.0 | 0.59.0 |
| golang.org/x/sys | 0.20.0 | 0.48.0 |
| golang.org/x/text | 0.15.0 | 0.42.0 |
| protobuf | 1.34.1 | 1.36.12 |

**Code changes:**
- `packages/backend/app/main.py`: Added `timeout_keep_alive=30` to uvicorn.Config (uvicorn 0.53.0 feature)

**Intentionally skipped:**
- `pydantic_core` — pinned by pydantic 2.13.5 (needs pydantic 2.14+ for upgrade)
- `mpmath` — pinned by sympy 1.14.0 (<1.4)
- `ruff` — locked by editor process (0.16.6→0.16.8; close editor to upgrade)
- `mp4-muxer` — deprecated (Mediabunny replacement requires migration)
- `eslint` (video-editor) — major version 9→10 breaking change

### Fixed - Repo-wide review: broken toolchain, crash bugs, and lint debt (2026-09-15)

A full review of frontend, backend, video-editor, and build tooling. Every gate
(`pnpm -r lint`, `tsc`, `ruff`, `pytest`, `vite build`) now passes.

**Build tooling (was silently broken)**
- **`turbo.json` used the removed `pipeline` key** — turbo 2.x requires `tasks`.
  Root `build` / `lint` / `test` tasks failed outright; renamed to `tasks`
  (verified with `turbo build --dry=json`).
- **`pnpm dev:backend` was unusable on Windows** — it embedded bash-only
  `${BACKEND_PORT:-8000}` syntax that `cmd.exe` passes through literally, so
  uvicorn received an invalid port. It now delegates to
  `scripts\manage-servers.ps1 -Action start -Services backend`, matching
  `dev:comfyui` and honouring `config/ports.json`.
- **`.gitignore`** now covers root scratch/debug artifacts (`out/`,
  `unsloth_compiled_cache/`, `tools/vision/screenshots/`, one-off `check_*` scripts).
- **Ruff config** gained `per-file-ignores` so the intentional test-suite
  `sys.path` bootstrap (`E402`) and the Win32 API constant names in
  `diagnostics/resources.py` (`N806`) are documented exceptions instead of noise.

**Backend crash bugs**
- **`app/main.py` WebSocket handshake raised `NameError`** — the origin check
  referenced a module-level `_local_origins` that no longer exists (the allowlist
  moved to `app.core.cors`). Every origin-bearing WS connection died. Now uses
  `is_local_origin()` for an exact match, which also closes a `startswith()`
  bypass (`http://127.0.0.1:5173.evil.example.com` previously passed).
- **Undefined names (`F821`)** in `api/health.py`, `api/log_analytics.py`
  (`Any` used without import) and
  `tests/integration/run_integration_tests.py` (`AsyncGenerator`).
- **Backend test suite could not collect** — `tests/test_main_cors_origin.py`
  still imported the removed `_local_origins` from `app.main`, aborting all 29
  tests. Rewritten against `app.core.cors`, plus new regression tests for the
  WS origin gate (reject 4001 / accept trusted).
- **Frontend log attribution was dropped** — `api/logs.py` read the `source`
  field from each frontend entry and discarded it, so log analytics could not
  tell which component emitted an entry. It is now prefixed into the message;
  the unused `timestamp` read (the app formatter adds the authoritative one) is gone.
- **`ffmpeg_tools.py`** shadowed `PROJECT_ROOT` via two conflicting imports
  (`F811`), neither used.
- **`services/transcription.py`** chained the missing-dependency `ImportError`
  into the raised `RuntimeError` so the root cause survives in tracebacks.
- Module renamed `services/lyricsParser.py` → `services/lyrics_parser.py`
  (PEP 8; single import site updated).

**Backend lint debt**: `ruff check` went 230 errors → **0**. Removed ~20 unused
imports/variables, sorted imports, stripped trailing whitespace, fixed
ambiguous/misleading names, and added explicit `raise ... from <err>` chaining to
58 exception translations (59 → 0 for `B904`) so tracebacks show the root cause.

**Frontend (32 ESLint errors → 0, `tsc -b` clean, production build green)**
- `services/fetchWithTimeout.ts` now attaches `cause` to the timeout error.
- `visualizer/lyricsParser.ts`: removed a **dead no-op loop** that iterated all
  lyric sections doing nothing, plus an unused counter, useless assignments and
  needless regex escapes.
- `visualizer/perceptualScales.ts`: `case` blocks wrapped in braces (lexical
  declarations were leaking across cases).
- `docs/DocsPage.tsx`: `@ts-ignore` → `@ts-expect-error` (fails loudly if the
  suppression becomes unnecessary).
- Six stale `// eslint-disable-next-line react-hooks/exhaustive-deps` comments
  were **inert** (the `react-hooks` plugin is not installed in this package) and
  were the source of 6 lint errors. Two were removed outright (the deps were
  already correct); the four that encode real intent were replaced with
  explanatory comments. **Recommendation:** add `eslint-plugin-react-hooks` to
  the frontend to actually enforce hook dependency correctness — it was not
  added here because it is not currently a dependency of the workspace.
- `three-js-studio`: unnecessary regex escapes, and GPU-probe `catch` blocks
  that redundantly reassigned the default.

**video-editor (35 ESLint errors → 0, `tsc --noEmit` 17 errors → 0)**
Its `lint` script is `eslint src && tsc`, and ESLint had always failed first —
so **`tsc` had never run** and a set of real bugs was invisible:
- **Rules of Hooks violation** in `components/StudioBackButton.tsx`: an early
  `return null` sat *before* `useState`/`useEffect`. Hooks now run
  unconditionally and the Studio gate is applied afterwards.
- **`Composition.tsx` referenced an undefined `EASE_SMOOTH`** (`TS2304`) — a
  guaranteed `ReferenceError` on every section-transition frame. Defined alongside
  the other compositions' `EASE_ENTER`.
- **Wrong import paths** — `../services/api` from `src/Composition.tsx` resolved
  to `packages/video-editor/services/api` (nonexistent); corrected to
  `./services/api`. `AudioReactiveVisualizer.tsx` pointed at a nonexistent
  `../../../shared/timing`; it now uses the package's `../lib/timing` like the rest.
- **`Section`/`SectionEvent` shape mismatch crashed the analyzed path** —
  `lib/timing` keys sections by `type` while the render layers read `name`, so
  passing an `analysis` prop raised `undefined.includes(...)`. Both mapping sites
  now normalize `type` → uppercase `name`, and the palette/typography tables
  compare case-insensitively so they work whichever case the backend emits.
- `lib/timing.ts` `TimingContract` gained the missing `lyrics?: LyricTiming[]`
  (already present in the canonical `shared/timing.ts`).
- Duplicate `export type { TimingContractState }` removed (`TS2484`).
- All 11 `React.FC<any>` layer components are now properly typed against the
  existing local `Section` / `LyricLine` types.
- Removed 21 unused variables/imports, and a CSS `transition` on a Remotion
  element that broke frame purity (`@remotion/non-pure-animation` → removed).
- Film grain now renders through `<Img>` instead of `background-image`, which
  Remotion cannot guarantee is painted at render time
  (`@remotion/no-background-image`).

### Added - Sidebar Simplification + TypeScript Fixes (2026-09-11)

- **Sidebar nav sections collapsible**: `Start`, `Create`, `Generate`, `Manage`, and `System` sections now have individual toggle controls; `Generate`, `Manage`, and `System` default to collapsed. Addresses progressive disclosure (`docs/ux-audit/audit-report.md` #8).
- **Header/footer cleanup**: Removed redundant subtitle (`Studio • 2026 Pipeline`) and redundant collapsed CTA link; footer now lists all adapters instead of slicing to 3.
- **Mobile hamburger fix**: Hamburger icon now renders only on mobile (`{isMobile && (...)}`) so it no longer appears as a non-functional element on desktop.
- **CSS additions**: `.sidebar-hamburger`, `.sidebar-backdrop`, `.sidebar-mobile`, `.sidebar-mobile.open`, and `.sidebar-toggle` added to `packages/frontend/src/styles/sidebar.css`.
- **System container refined**: status summary with indicator dot + label + adapter count; adapter list with hover states and separators; `View Diagnostics` link; improved collapsed footer touch target.
- **TypeScript fixes**:
  - `packages/frontend/src/features/kinetic-typography/KineticTypographyPage.tsx`: cast `bassEl` to `HTMLElement` before accessing `style`.
  - `packages/frontend/src/features/visualizer/lyricsParser.ts`: removed unused `lastTime` variable.
- **Verification**: `npx tsc --noEmit` passes cleanly; dev server confirmed on port 5174.

### Added - Section Detection Accuracy + Cross-Page Audio Handoff + Audio Analysis UI Overhaul (2026-09-10)

- **Backend section detection** (`packages/backend/app/api/audio.py`): `_generate_sections_from_analysis()` now uses tempo-proportional beat-snap tolerance (`min(0.6, (60/tempo)*0.5)`) instead of fixed 0.6s; genre-aware section counts (24 beats for EDM/hip-hop >150 BPM, 48 for ambient <90 BPM, 32 default); onset-density-aware classification distinguishing `pre-chorus`, `bridge`, `interlude`, and `drop`; per-section confidence scoring (0.6–0.85 base + energy modifiers); robust chronological/non-overlapping enforcement.
- **LLM refinement on all paths**: `ensure-analysis` and `analyze-all` now both run best-effort `_apply_llm_sections()` so cached analyses also get LLM-refined sections.
- **Frontend section types expanded**: `AudioAnalysisPage.tsx` adds colors + labels for `pre-chorus`, `drop`, `interlude`, `solo`; `DisplaySection` interface now includes `confidence`; `coalesceSections()` averages confidence when merging.
- **Audio Analysis UI redesign**: stat cards now use gradient borders + larger numerals; insights bar shows average section confidence; generate dialog redesigned as 2-column card grid (ComfyUI / Visualization) with icons + descriptions; section rows show confidence percentage (`82% conf`); library sidebar items have clearer active/analyzed states; Energy & Beats chart downsampling capped at 40 reference lines / 100 beat-density bars.
- **Cross-page audio handoff**: New `src/utils/pendingTrack.ts` provides a shared `window` + `sessionStorage` handoff slot (`__pendingTrackFilename`). `Visualizer.tsx` and `MusicVideoWizard.tsx` consume it on mount to auto-load the track selected in Media Library.
- **Media Library handoff buttons**: `MediaLibrary.tsx` adds hover actions `Send to Visualizer` and `Send to Music Video Wizard` that set the pending track and navigate.
- **Strict Mode fix**: `MusicVideoWizard.tsx` uses `peekPendingTrack` + `clearPendingTrack` to avoid double-consumption under React Strict Mode.
- **Scripts fix**: `scripts/start-studio.ps1` removed duplicate closing braces at lines 394–396 that caused a PowerShell parse error.
- **Verification**: `npx tsc --noEmit` passes cleanly; Playwright verified empty state, `?file=` auto-analyze (160 BPM / 827 beats / 4 sections / 64% confidence), Energy & Beats chart, Media Library → Visualizer/Music Video Wizard handoffs.

### Added - Media Library Extraction + Typed Inspection + Stem Mixer Resilience (2026-09-10)

- **Audio extraction from video**: `POST /api/audio/extract` now probes the source audio codec first and supports `format="original"` (lossless stream copy into a matching container — `.m4a`/`.mp3`/`.ogg`/`.flac`/`.wav`/`.opus`/etc.) or `format="mp3"` (re-encode at `bitrate`). Powers new `ExtractAudioPanel` in the Media Library video detail view.
- **Expanded audio format support**: Backend `ALLOWED_EXTENSIONS` and frontend upload validation now include `.opus`, `.aac`, `.wma`; `AudioAnalysisPage.tsx` hints updated.
- **Media detail modal extracted**: `MediaLibrary.tsx` detail view moved to `MediaDetailModal.tsx` with strongly-typed payloads (`MediaProbe`, `MediaProbeFormat`, `MediaProbeStream`, `LoudnessResult`, `WaveformResult`, `MediaInfoPayload`). `mediaInfo` state now typed; LRU cache (max 50) added to avoid redundant probe/loudness/waveform fetches.
- **Waveform error handling**: `WaveformDisplay.tsx` accepts optional `onError` prop for WaveSurfer initialization failures.
- **Stem mixer auto-separation**: `StemMixer.tsx` (`useStemMixer`) now calls `getAudioStems` and, if missing, automatically triggers `POST /api/audio/separate-file` (Demucs) instead of dead-ending. Includes elapsed timer, track-switch cleanup, and retry button.
- **Backend stem lookup hardened**: `get_stems` uses `_find_stem_dir` to tolerate renamed/hash-prefixed separation output dirs; removed unused `stems_absolute` from response.
- **Backend new endpoint**: `POST /api/audio/separate-file` separates an existing library file via Demucs (`htdemucs`/`htdemucs_6s`/etc.).
- **FFmpeg renderer audio bitrate**: `ffmpeg_renderer.py` video mux now pins `-b:a 192k` (was bare `-c:a aac` → ffmpeg default ~128k).
- **Outputs type detection**: `outputs.py` recognizes `.m4v`, `.opus`, `.aac`, `.wma` as video/audio.

### Added - Waveform Visualization + Port Centralization (2026-09-10)

- **Media Library waveform**: `packages/frontend/src/features/media-library/WaveformDisplay.tsx` wraps `wavesurfer.js` v7 with pre-computed peaks, duration, and optional audio element binding for interactive seek/play.
- **Backend waveform endpoint**: `GET /api/media/waveform` returns downsampled amplitude envelope via new `packages/backend/app/api/media.py` router.
- **Waveform extraction improved**: `packages/backend/app/services/ffmpeg_tools.py` `extract_waveform` now uses per-bucket max amplitude instead of RMS for more detailed envelope rendering.
- **Frontend integration**: `MediaLibrary.tsx` imports `WaveformDisplay` and replaces basic canvas waveform with wavesurfer.js rendering; `api.ts` adds `duration` to `WaveformResponse`.
- **Port centralization**: `config/ports.json` is now the single source of truth for all ports and service URLs across backend (`config.py`, `port_manager.py`, `integrations_config.py`, `comfyui_manager.py`), PowerShell scripts (`manage-servers.ps1`, `start-studio.ps1`), Node MCP tools (`ollama-tools-mcp.mjs`, `vision-mcp.mjs`), Node scripts, and video editor (`StudioBackButton.tsx`).
- **Config cleanup**: `config/settings.json` stripped of duplicate port fields — only holds non-port settings (models, workers, Ollama URL).
- **Verification**: TypeScript compiles cleanly (`npx tsc --noEmit`); backend builds and tests pass; frontend dev server confirmed on 5173.

### Added - Go Sidecars + CORS/SSE Hardening (2026-09-10)

- **Go sidecars integrated into backend service layer**: `go_gateway_client.py` + `go_worker_client.py` under `packages/backend/app/services/`
- **Unity MCP via go-gateway**: `native_open.py` now routes Unity MCP refresh through `go-gateway` `/proxy/unity/...`; Blender MCP remains on raw TCP socket
- **Async sidecar I/O**: Offloaded JSON sidecar writes from Python job handlers to `go-worker` in `image_generator.py`, `comfyui_workflow_handler.py`, `music_video_handler.py`, `export_matrix.py`, `storyboard_generator.py` with direct-write fallback
- **go-gateway proxy fix**: response body now uses `io.Copy` instead of single `Read` call (was truncating responses)
- **go-worker sidecar endpoint**: `POST /jobs/:id/sidecar` accepts optional `?filename=` query param for custom output filenames
- **Health diagnostics extended**: `GET /api/health/diagnostics/services` now returns `sidecars` block with live status for go-dashboard, go-gateway, go-worker, go-media, go-ports
- **go-dashboard SSE fix**: Added missing `eventServer.CreateStream("events")` in `main()`; `/events` no longer returns 500 "Stream not found!"
- **CORS centralized**: `packages/backend/app/core/cors.py` allowlist reduced to `127.0.0.1` only; removed `localhost` entries
- **URL standardization**: All local service URLs standardized to `127.0.0.1` across backend (`hyperframes.py`, CORS) and frontend (`portConfig.ts`, `sseService.ts`)
- **Playwright test helpers fixed**: `mockGoServiceHealth` and `mockGoServiceHealthDegraded` now allow `/events` requests through to real go-dashboard to preserve `text/event-stream` MIME type
- **SSE fallback**: Frontend `sseService.ts` uses go-dashboard as primary SSE source, backend as fallback
- **Verification**: 28 Playwright smoke tests pass (dashboard, health, queue, SSE, Go sidecars); 0 console errors on frontend reload

### Added - Frontend UX Polish & Build Optimization (2026-09-08)

- **Sidebar** (`packages/frontend/src/components/layout/Sidebar.tsx`): Progressive disclosure — `Generate` collapsible (default open), `System` collapsible (default closed, auto-opens when route active), `External` demoted to subtle footer link. Reduces expanded nav 22→16 rows; addresses `docs/ux-audit/audit-report.md` #8 progressive disclosure.
- **Wizard** (`packages/frontend/src/features/music-video/steps.tsx`): `ConfigureStep` now hides `Steps/CFG/Seed` inside `<details>` (summary `Steps 20 • CFG 7 • Seed random`). Vertical-first checkbox retains safe-zone hint `top 100 / bottom 200`. Defaults tuned for Wan 2.2 5B 8GB.
- **Visualizer** (`packages/frontend/src/features/visualizer/Visualizer.tsx`, `packages/frontend/src/styles/globals.css`): Empty hero overlay when `!audioUrl && libraryFiles.length===0` — 3-step guide (`Dashboard drop → Visualizer pick → Play`), CTA `Browse audio…` + link to Audio Analysis, radial violet backdrop. Adds `viz-empty-*` styles.
- **Remotion** (`packages/video-editor/src/Root.tsx`): Added vertical-first compositions `StillIRiseVertical`, `SiliconDreamsPreviewVertical`, `TakeTheCrownVertical` at `1080×1920` (per `ai-video-trends-2026.md` vertical-first master + `VISUAL_STORYTELLING_2026.md:97`).
- **Build** (`packages/frontend/vite.config.ts`): `resolve.alias: three/addons → three/examples/jsm` + `dedupe: [three, three-stdlib]` to eliminate duplicate `GLTFLoader×2 / OrbitControls×2` (~100KB gz per `frontend-build-pipeline.md:144`).
- **Health** (`packages/frontend/src/features/health/GoServicesCard.tsx`): Poll `5000→15000ms`; removed dead imports `WifiOff`, `getDashboardUrl` (`tsc -b` clean, `vite build` 33.64KB css / 50.77KB Visualizer gz).

### Fixed - Service Management, Port Standardization & Vite Config Shadowing (2026-09-07)

- **Scripts** (`scripts/manage-servers.ps1`): Defined missing `Test-PortInUse` — `Start-Service` crashed with `CommandNotFoundException` under `$ErrorActionPreference = 'Stop'`, making services unstartable through the script
- **Scripts**: `Stop-Service` now kills the full uvicorn `--reload` tree (reloader parents via `app.main:app` cmdline match, then port listeners in up to 3 passes) and verifies the port is actually released — orphaned reload children plus Windows stale-socket entries previously kept port 8000 wedged
- **Scripts**: `Test-ServiceRunning` health timeout 2s → 6s (`/api/health` probes adapters live; ComfyUI-down alone took >2s, causing false "STOPPED" status)
- **Scripts**: Occupied-port error now prints the exact recovery command (`manage-servers.ps1 -Action stop -Services <svc>`)
- **Scripts**: Added root-level `check_ports.ps1` — one-shot LISTENING-port → owning-process map for triaging stale servers
- **Frontend**: Deleted tsc-emitted `vite.config.js`/`vite.config.d.ts` that **shadowed** `vite.config.ts` (Vite resolves `.js` first) — the stale artifact lacked `server.host: "127.0.0.1"`, so the dev server bound IPv6-only (`[::1]:5173`) while scripts, proxy and CORS allowlists expected IPv4
- **Frontend** (`tsconfig.node.json`): composite emit redirected to `node_modules/.tmp/tsc-node` via `outDir`, so `pnpm build`/`type-check` can never regenerate a shadowing `vite.config.js` at the package root
- **Frontend** (`vite.config.ts`): pinned `server.host: "127.0.0.1"` explicitly
- **Backend** (`main.py`, `port_manager.py`): sticky-port guard — if the resolved port already serves *our* backend, startup logs and exits instead of spawning a duplicate instance (prevents duplicate-backend port drift)
- **Backend** (`integrations_generation.py`): restored the 6 `/api/integrations/ollama/(coding-)benchmark/*` endpoints removed during the service-relocation refactor (the Three.js Studio `AISceneGenerator` still calls them) and fixed the `sys.path` root (`PROJECT_ROOT`, not `PROJECT_ROOT.parent`) so `tools.scripts.*` imports resolve
- **Config**: standardized ports to backend **8000** / frontend **5173** across `config/ports.json`, `config/settings.json`, `storage/ports.json`, `AGENTS.md`, `tools/audio_analysis_agent.py`
- **Docs**: README ports + endpoint table, `API_REFERENCE.md` benchmark endpoints, `frontend-build-pipeline.md` §7.6 config-shadowing hazard, `backend-debugging-guide.md` stale-server playbook, `coding-benchmarks.md` CLI path
- **Verification**: backend `200` on 8000; frontend `200` on `127.0.0.1:5173` (IPv4) with working `/api` proxy; 5/5 backend CORS tests; `pnpm type-check` clean; all 6 benchmark routes present in `/openapi.json`

### Refactored - Backend Service Relocation & Dead Code Removal (2026-09-07)

### Refactored - Backend Service Relocation & Dead Code Removal (2026-09-07)

- **Backend**: Moved 7 service files from `packages/backend/app/services/` to `tools/` and `tools/scripts/`:
  - `audio_analysis_agent.py`, `audio_fingerprinting.py`, `structure_analysis.py` → `tools/`
  - `blender/builder.py`, `blender/lyrics_sync.py` → `tools/blender/`
  - `coding_benchmark.py`, `ollama_benchmark.py` → `tools/scripts/`
- **Backend**: Removed dead `/ollama/benchmark/*` and `/ollama/coding-benchmark/*` endpoints from `integrations_generation.py`
- **Backend**: Removed unused `RunBenchmarkRequest` and `RunCodingBenchmarkRequest` models
- **Backend**: Simplified `GET /ollama/models` to drop benchmark enrichment logic
- **Dependencies**: Trimmed unused packages from `requirements.txt` and `requirements-experimental.txt`
- **Tools**: Updated `tools/batch_process.py` imports to use new `tools.` module paths
- **Tests**: All 34 backend tests pass; no regressions from refactor

### Added - Media Library Performance & Presentation Overhaul (2026-09-06)

- **Performance**: Debounced search (350 ms) + `useDeferredValue`, pagination (`ITEMS_PER_PAGE=24` + *Load more*), `React.memo` `MediaCard` with `animationDelay` stagger (40 ms), `SkeletonGrid` shimmer, `useMemo` filtered/sorted + `visibleCount` slice (was rendering all 179 at once), `format*` memoization.
- **Presentation**: Glass-morphism cards (`backdrop-blur-xl`, `bg-black/20`, `border-white/5/10`), hover lift (`-translate-y-1`, `shadow-xl`, `scale-105` on image), gradient badges, refined typography (`tracking-tight`, `Sparkles` header), improved empty state (gradient icon, tip `Press / to search`).
- **Animations**: Entrance `fade-in slide-in-from-bottom-2` with stagger, modal `zoom-in-95` + `backdrop-blur`, hover `scale-110` on action buttons, shimmer skeleton, pulse on duplicate badge, transition `duration-300` throughout.
- **Functionality**: Hover video autoplay (`video` muted loop on hover, “hover to preview” hint), lightbox zoom (`scale 0.5–3`, `+/-` + `%` badge, cursor-zoom), keyboard shortcuts (`/` focus search, `Esc` close, `g` toggle group), `Load more` pagination with remaining count, stacked type legend, `groupByType` preserved with same card component.
- **Code**: Removed duplicated grid/list branches (was 1394 lines → 508), extracted `useDebounce` + `MediaCard` memo + `SkeletonGrid`, fixed `Check` import, removed dead `render*Badge` helpers, kept `selectedPaths` bulk + duplicates panel with backdrop-blur.

### Added - GPU Telemetry Database & Trending Visualizations (2026-09-06)

- **Database** (`packages/backend/app/core/database.py:199`): `SCHEMA_VERSION 8` + new `gpu_telemetry` table (`ts_ms/ts_iso/gpu_name/memory_* /gpu_util/temp/processes_json`, indexes on `ts_ms/ts_iso`, 14-day retention). Helpers: `log_gpu_telemetry()`, `get_gpu_history(since_ms,limit)`, `get_gpu_stats()`, `cleanup_old_gpu_telemetry()`. Survives reloads/reboots — DB at `storage/studio.db` (not `packages/backend/storage`).
- **API** (`packages/backend/app/api/health.py:83`): `GET /api/health/gpu` now auto-logs (`?log=bool`), new `GET /gpu/history?range=5m|15m|1h|6h|12h|24h|7d&limit&include_processes`, `GET /gpu/stats?range`, `DELETE /gpu/history?keep_days`. Frontend also has `getGPUHistory/clearGPUHistory/getGPUStats` in `packages/frontend/src/services/api.ts:952`.
- **Backend logger** (`packages/backend/app/diagnostics/resources.py:760`): `resource_monitoring_loop` now persists a snapshot every 10s + opportunistic prune, so history grows even when `/gpu` page is closed.
- **Frontend GPU Monitor** (`packages/frontend/src/features/gpu/GpuMonitorPage.tsx:1`): complete overhaul — persistent trending (DB + `localStorage v2` fallback, 17k points ≈24h), range pills `5m/15m/1h/6h/12h/24h` with downsample to 300 pts, inline sparkline donuts/bars in 4 metric cards, stacked attribution bar for top-6 processes, `syncId="gpu"` crosshair, `ReferenceLine` throttle 83°C & 75% warn, trend icons + `avg/min-max` stats, pattern text (“VRAM easing…”, “load building…”), `Export CSV` & `Clear` (DB+cache), `Brush` zoom, long-term `LineChart` overview (14-day retention), visibility-aware pause, `DB ✓` badge.
- **Visual polish**: temperature/ VRAM/ util sparklines (opacity 0.33), donut for VRAM %, segmented headroom bar, left-border tint by VRAM share, tip titles with `% of VRAM`.
- **Docs**: `docs/api/API_REFERENCE.md` Health — Extended, `docs/guides/GPU_PIPELINE.md` & `README.md` Service/API tables updated.

### Fixed - Backend Startup & Frontend Connectivity (2026-09-05)

- **Backend**: Fixed WebSocket origin validation `NameError` in `packages/backend/app/main.py:293` — added `origin = websocket.headers.get("origin", "")`
- **Backend**: Added pre-flight port availability check in `packages/backend/app/main.py` — warns if backend port is occupied before uvicorn bind
- **Frontend**: Added direct-backend fallback in `packages/frontend/src/services/api.ts` for `healthCheck`, `getSystemHealth`, and `getServiceStatus` when Vite proxy returns `ECONNREFUSED`
- **Frontend**: Updated `packages/frontend/src/services/sseService.ts` to prefer configured `events_url` from `portConfig.ts`, falling back to Vite proxy `/api/events`
- **Scripts**: Improved `scripts/start-studio.ps1` — added 500ms delay after `Stop-PortOwner`, 2-attempt retry for backend launch with exponential backoff
- **Tests**: Added/updated Playwright browser tests (`packages/frontend/tests/*.spec.ts`) and backend test fixtures
- **Docs**: Added `.python-env` to document preferred CUDA conda environment and fallback venv

## [1.0.0] - 2026-09-05

### Fixed - Async Refactoring & VRAM Management (2026-09-05)

- **Backend**: Fixed asyncio refactoring in `diagnostics/resources.py` — converted synchronous GPU check methods to run via `asyncio.to_thread()` to prevent blocking the event loop
- **Backend**: Fixed `vram_manager.py` — converted `_get_vram_gpustat_sync()` and `_get_vram_nvml_sync()` to synchronous versions wrapped with `asyncio.to_thread()` for proper async execution
- **Backend**: Fixed `integrations_config.py` — corrected VRAM offload function call from `vram_manager._unload_ollama_models()` to direct function import
- **Backend**: Fixed `integrations_generation.py` — corrected VRAM manager function calls to use direct imports instead of instance methods
- **Backend**: Fixed `main.py` — changed `queue_manager.reload_from_db()` to `await queue_manager.reload_from_db()` for proper async execution
- **Backend**: Enhanced `comfyui.py` — added `_get_queue_status()` method to check ComfyUI queue status, improved error handling with timeout and cancellation detection
- **Docs**: Updated knowledge library index — corrected document count (27), tag count (22), and last updated date (2026-09-05)

### Fixed - Vision MCP OOM Prevention (2026-09-03)

- **MCP**: `tools/mcp/vision.mjs` now automatically unloads other running Ollama models via `/api/ps` + `/api/generate keep_alive:0` before loading the target vision model, preventing GPU OOM timeouts on limited-VRAM systems
- **Docs**: Updated `AGENTS.md` vision workflow and `docs/knowledge-library/technical-reference.md` to document automatic model offloading and corrected resize/format behavior

### Added - 2026 2D Visualization + LRC-Driven 3D + Ollama Hardening (2026-09-02)

#### 2D Visualization (2026 Open Source)

- **Canvas2DVisualizer** `packages/frontend/src/features/visualizer/Canvas2DVisualizer.tsx` — 3 modes `bars/waveform/radial` via Canvas2D + Web Audio API (inspired by `visual-flux 2026` Apache-2.0 + `Waviz 2026` MIT), LRC `isPhraseStart/sectionProgress/lineProgress` reactive, HiDPI, palette per-section `INTRO/VERSE/CHORUS/DROP`
- **Shader LRC sync** `ShaderVisualizer.tsx` now `lrcSync` phrase-boosted `beat`/`energy`, `VisualizationFX.tsx` `PostFX` bloom+vignette pulse on phrase
- **Wire** `Visualizer.tsx` `vizMode:"3d"|"shader"|"2d"` toggle `FX/3D/2D`, `Canvas2DVisualizer` branch `640`
- **Tests** `packages/frontend/tests/canvas2d.spec.ts` 1 passed (2D modes cycled, 0 console errors), `lrc-visualizer.spec.ts` now 2 passed (46 LRC lines, `INTRO/VERSE/DROP/FINAL DROP`)
- **Research** `docs/knowledge-library/2d-visualization-2026.md` — 2026 methods: PixiJS 8, p5.js 1.9, I2Djs, Waviz, visual-flux, OpenVJ, Meyda, GSAP free

#### LRC Stack Fix (Critical)

- **Backend** `services/lyricsParser.py:8` — fixed `IndexError`/`SyntaxError` (un-importable), multi-stamp `[00:02.50][00:05.00]`, `offset:+500` drift, `:`/`1-3` digit support, `generate_lrc` `60.00` rollover
- **Frontend** `lyricsParser.ts:84` — `offset`, multi-stamp, `1-3` digit, `INSTRUMENTAL/Hook/Refrain` sections, capped `end` `min(6,gap-0.2)`
- **Sync** `useLrcSync.ts:35` — gap returns `null` not stale lyric, `sectionBounds` map (non-contiguous `CHORUS`), `usePhraseTrigger` `O(log n)` `useMemo`, `Visualizer.tsx:70` `elapsed` reactive `80ms` + `LrcVizController.tsx:65` `lineProgress/sectionProgress` scale/rotation

#### 3D Visualizer LRC Wiring

- `types.ts:109` `VisualizerSceneProps.lrcSync` full `currentLine/nextLine/timeToNextPhrase/currentIndex/totalLines`; `VisualizerScene.tsx:32` `PostFX lrcSync` phrase bloom `+0.25`, `LrcVizController.tsx:65` no `vizParams` mutation, full sync
- Verified `useLrcSync` → `KineticLyricOverlay` + `VisualizerScene` + `ShaderVisualizer` + `Canvas2DVisualizer` all reactive

#### Ollama & API Hardening

- **Startup** `main.py:143` unload Ollama at startup → no auto-load on resume; `vram_manager.py:510` `keep_alive:-1`→`"5m"` + `llama` sanitize `370` (`qwen3.5:4b` default `config.py:34`, `adapters/ollama.py:70`, `config/settings.json:9`)
- **Visualizer** `Visualizer.tsx:338` removed fire-and-forget `generateVisualizerPreset` on track select → manual `Enhance with AI` button `465` with diff toast
- **ComfyUI** `integrations_generation.py:33` `enrich_prompt:bool=False` — was auto on `<120 chars`, now opt-in
- **Search** `integrations_generation.py:640` sequential `200*15s` → `Semaphore(5)` concurrency + cap `limit*5`
- **Misc** `integrations_misc.py:328` bare `@router.get("/ollama-models")` bug split into `get_ollama_models_misc` + `POST /cuda/analyze-audio`, `audio.py:860` path traversal `resolve().is_relative_to` + CORS allowlist

#### Visualizer Preset Persistence & Gallery

- `integrations_generation.py:1313` `POST /ollama/visualizer` now `save_visualization_preset()` + `storage/visualizer_presets/{hash}.json` `1331`, `GET /presets` `1358` + `DELETE /preset/{id}` `1392`
- `AIPresetGallery.tsx:1` browsable gallery `search/style` filter, `Apply/Copy/Download/Delete`, survives restart (`storage/studio.db` WAL)
- `AIVisualizerPrompt.tsx:18` history `refreshKey` + `Settings.tsx:62` `default_model` persistence fix, `tools/mcp/vision.mjs:11` `VISION_MODEL` env

### Fixed - Final Sweep & Documentation (2026-09-02)

- **Backend**: Fixed missing `import asyncio` in `api/outputs.py` — caused runtime crash in FFmpeg operations
- **Backend**: Removed dead code duplicate in `_scan_with_cache` (unreachable after return)
- **Backend**: Fixed `check_and_prevent_oom` indentation in `vram_manager.py` — was unreachable as a nested function
- **Backend**: Refactored `main.py` to use single `asyncio.run()` with async `main()` function
- **Backend**: Made checkpoint name configurable in `comfyui_manager.py` `generate_video`
- **Frontend**: Enhanced AI code sanitization in ThreeJSStudio — strips setInterval, setTimeout, eval, Function, fetch, localStorage, event listeners
- **Frontend**: Removed global `(window).THREE` exposure — AI code uses parameter instead
- **MCP**: Made checkpoint name configurable in `ollama-tools-mcp.mjs` `generateImage`

### Fixed - Security & Reliability Sweep (2026-09-01)

- **Backend**: Added `threading.Lock` to `_output_cache` in `api/outputs.py` to prevent race conditions
- **Backend**: Fixed TOCTOU race in `queue/manager.py` `cancel_job`/`retry_job` — moved status check inside lock
- **Backend**: Fixed `diagnostics/health.py` — errored adapters now reported as OFFLINE instead of silently disappearing
- **Backend**: Fixed `comfyui_manager.py` crash when detecting external ComfyUI (PID access on `None`)
- **Backend**: Added git dirty-check before `git pull` in `comfyui_manager.py`
- **Backend**: Added WebSocket origin validation in `main.py`
- **Backend**: Fixed `_scan_with_cache` from `async def` → `def` (no await calls)
- **Frontend**: Fixed ThreeJSStudio missing `encodeURIComponent` on audio URL
- **Frontend**: Fixed ThreeJSStudio duplicate IDs using monotonic counter
- **Frontend**: Fixed Visualizer object URL leak after download (revoke after 1s)
- **Frontend**: Added throttled UI updates (~10fps) in Visualizer audio analysis loop
- **Frontend**: Reused `Uint8Array` via `freqArrayRef` instead of per-frame allocation
- **Scripts**: Fixed `manage-servers.ps1` undefined `Write-Warn2` and broken `$svc.Name` references
- **Scripts**: Fixed `manage-servers.ps1` backend Args to use `uvicorn` module
- **Scripts**: Fixed `start-studio.ps1` `return` inside frontend block (exits entire script)
- **Scripts**: Fixed `start-studio.ps1` null reference after failed restart (`$s.Process` guard)
- **MCP**: Fixed `ollama-tools-mcp.mjs` typo "chiral" → "chill"
- **Config**: Fixed `pnpm-workspace.yaml` invalid `pmOnFail` and `allowBuilds` settings
- **Config**: Aligned TypeScript version in `pnpm-workspace.yaml` catalog with `package.json` (^5.9.3)

### Fixed - Bug Sweep & Code Quality (2026-09-01)

- **Backend**: Removed duplicate `adapter_registry` import in `main.py` shutdown handler
- **Backend**: Replaced deprecated `asyncio.get_event_loop().time()` with `time.monotonic()` in `vram_manager.py` (removed in Python 3.10+)
- **Backend**: Fixed `save_config()` Path serialization — added `default=str` to `json.dump` so `Path` objects serialize correctly
- **Backend**: Removed debug `print`/`logger.info` statements from `music_video_handler.py`
- **Backend**: Removed dead code (unused `all()` expression) in `diagnostics/health.py`
- **Backend**: Removed dead `_save_jobs` method from `queue/manager.py`
- **Backend**: Fixed `dict[str, any]` type annotation to `dict[str, Any]` in `api/outputs.py`
- **Backend**: Fixed `request.name` reference in `api/jobs.py` (field doesn't exist in `JobCreateRequest`)
- **Frontend**: Removed debug `console.log` statements from `Visualizer.tsx`
- **Frontend**: Added cleanup effect for object URL, AudioContext, and MediaRecorder in `Visualizer.tsx` (memory leak fix)
- **Frontend**: Removed fragile module-level `console.warn`/`console.error` overrides from `Visualizer.tsx` and `main.tsx`
- **Frontend**: Fixed suspicious TypeScript package names in `package.json` (`@typescript/native`, `@typescript/typescript6` removed)
- **Config**: Updated `shared/types.ts` `PortConfig` interface to match actual `ports.json` structure
- **Config**: Standardized `localhost` → `127.0.0.1` in `config/ports.json`
- **Config**: Removed hardcoded Windows path from `config/settings.json` (uses default from `config.py`)
- **Tooling**: Added `@eslint/js` + `typescript-eslint` recommended rules to `eslint.config.js`
- **Tooling**: Fixed invalid `--ws websockets-sansio` → `--ws websockets` in `start-backend.ps1`

### Added - Three.js Studio Modernization (2026-08-27)

- **Three.js Studio**: Compact 2-row header + canvas + bottom drawer (Objects/Inspector/Scene), 6 production templates (Concert Stage, Cosmic Void, Equalizer Wall, Geometric City, Vinyl Spin, Pulse Orb), selective bloom dual-composer + post-FX chain (chromatic aberration, film grain, vignette), real beat timeline via `useBeatTimeline` (`GET /api/audio/analysis/by-filename/{filename}`) + beat-punch shake, image-as-background with 12-cover quick-pick, `audioDriven` bars/pillars for Equalizer Wall/City — see `docs/implementation-summary.md` §2026-08-27
- **3D Gen fix**: `Generation3DPage.tsx` `404 /api/3d/models` → `/api/3d/models`, CORS `getApiBase()` → relative URL, clickable model list + preview, `_repatriate_orphans()` surfaces 4 GLBs (`output/generated_3d/`)
- **Docs**: `docs/guides/MUSIC_VIDEO_GUIDE.md` new Three.js Studio section (§8), `MUSIC_VIDEO_GUIDE.md` now primary over classic `/music-video`

### Fixed - Server Startup & Monitoring (2026-08-31)

- **Startup Script** (`scripts/start-studio.ps1`): Fixed log overwrite on restart (now appends), added exponential backoff (1s/2s/4s) for crashed services, added process validation after start, added crash diagnostics showing last 10 lines of error log, added VideoEditor to auto-restart switch
- **Unity MCP Bridge** (`tools/mcp/unity-mcp-bridge.mjs`): Fixed wrong default project path — was resolving to `tools/unity-project-mcp` instead of repo-root `unity-project-mcp`
- **File Organization**: Moved 30+ loose files into structured directories (`tools/mcp/`, `tools/demos/`, `tools/tests/`, `tools/output/`, `scripts/utility/`, `docs/scratch/`), updated all 64 broken path references across 15+ files

### Fixed - Frontend Stability & Performance (2026-08-31)

- **Error Boundaries**: Added reusable `ErrorBoundary` component, wrapped all 20 routes to prevent single-component crashes from killing the page
- **Memory Leaks**: Fixed ThreeJSStudio resize listener never being removed (cleanup referenced wrong function), fixed healthStore SSE double-subscription leak
- **Performance**: Throttled ThreeJSStudio `animationTime` state updates from 60fps to ~10fps, added `React.memo` to Visualizer sub-components (StylePicker, SpectrumBar), added ref-counted polling to gpuStore
- **Audio**: Added guard against `createMediaElementSource` double-connection crash in ThreeJSStudio
- **Accessibility**: Added `aria-label` to all 8 icon buttons in Visualizer, added keyboard support (Enter/Space) and `role="button"` to Dashboard drop zone
- **Code Quality**: Extracted duplicated `formatElapsed` function to shared `utils/format.ts`, created reusable `usePolling` hook

### Fixed - Visualizer Page (2026-08-31)

- Fixed CSS class mismatch in loading indicator (`.viz-loading` → `.viz-loading-overlay`)
- Added AnimationDemo toggle button to topbar (was unreachable)
- Fixed SVG demo button active state
- Added `sceneFrozen` support to AuroraRibbon and OceanWaves visualizations
- Unified color scheme from blue (#007AFF) to indigo (#6366f1)
- Enhanced all 13 visualizations with better colors, materials, and effects (more particles, higher segment counts, glow shells)

### Fixed - Confidence Score (2026-08-25)

- **Backend**: `audio_analyzer.py:224` windowed onset (`p85`, `±1` frame) + beat regularity (`CV`) + dynamic range → `0.28` → `0.85` on `182s 143BPM` (was `mean(onset/max)`, now `0.55*onset + 0.30*regularity + 0.15*dynamic` + `sqrt` boost)
- **Verified**: `5` library files now `0.86-0.88` (was `0.27-0.35`), `POST /api/audio/analyze` `0.851`

### Fixed - Video Rendering & Queue Preview (2026-08-25)

- **Backend**: `music_video_handler.py:231` `showspectrum … scale=log:rate=30` → `Option not found` (was `772MB` bloat + `timeout`); fixed `scale=log[vid]`, `preset ultrafast` → `crf 23 preset fast maxrate 8M`
- **Frontend**: `QueueList.tsx:109` now renders `<video controls preload=metadata>` via `/output/video/{filename}` + `Download`/`Open` (was text only, `output_path` ignored `result.output_path`)
- **Verified**: `hasVideo true`, `GET /output/video/281baf85_music_video.mp4` `200 video/mp4`

### Fixed - Generate-3D Page UX (2026-08-25)

- **Backend**: `gen3d/service.py:24` `..core.config` → `...core.config` (`500` → `200` `{"available":true,"comfyui_running":true}`)
- **Frontend**: auto-load `status`/`history` on mount, `elapsed` timer, word-count validation (`75` words, `500` chars)
- **Model cards**: `VRAM`/`time` badges (`5GB 2-3min 8GB-safe` vs `9GB+ 6-8min`), selected `border-violet`, `steps` slider `5-50` with `fast/balanced/quality` + `~min` estimate
- **Generate**: `elapsed/~est` + progress bar + `VRAM offload` note, catches `timeout`/`VRAM` → friendly `Retry`/`Dismiss`
- **Result**: `model_path` filename + full path, `Download .glb` via `/output/generated_3d/{file}`, `Use in Music Video`, collapsible `Raw JSON`
- **Sidebar**: live `● Ready`/`Offline` badge, formatted status, `Recent Models` list (`.glb` from `/api/outputs`)

### Fixed - Queue Progress Bar (2026-08-25)

- **Backend**: `music_video_handler.py:316` stream `stderr` via `read(1024)` split on `[\r\n]` for `frame=`/`time=` → `update_job(0.5→1.0, "Rendering frame X/Y (Z%)")`
- **Was**: `communicate()` until FFmpeg exit → `50%` stuck until `100%`; now `50%` → `85% 125/180` → `97% 170/180` → `100%`

### Fixed - Video Rendering Efficient (2026-08-25)

- **Backend**: `crf 23 preset fast maxrate 8M` (was `ultrafast` → `772MB` for `4:24`), add `-t duration` (was full `4:24` for every `5s` → `timeout 60s`)
- **Abstract**: `PALETTES` by `section`/`energy` (`chorus #ff0055|#ffaa00`, `verse`, `bridge`) + `contrast/saturation` driven by `energy_curve`
- **Verified**: `5s 1080p` now `3.16MB 5.00s` (was `20MB` partial, `50MB` minimal, `772MB` bloated)

### Fixed - Audio Analysis & GPU Health (2026-08-25)

#### CUDA Toolkit 12.4 + Nsight Research

- **Research**: Evaluated `https://docs.nvidia.com/cuda/cuda-programming-guide/index.html` (v13.3) for `CUDA 12.4` / `GTX 1070 Ti sm_61` / `torch 2.6.0+cu124` — pinned archive `12.4.0`, documented useful sections (`2.5 Async`, `4.2 Graphs`, `4.3 Stream Alloc`) vs `sm_80+` skip-list
- **Added**: `docs/knowledge-library/technical-reference.md` — `CUDA Toolkit & Programming Guide — 2026-08-25 Research` with Nsight `2026.1.3` install paths, WDDM caveats, `torch.profiler` fallback (451 ms CUDA captured where `nsys` returned 0.05 MB empty)
- **Perf**: `app/services/cuda/processor.py` — cached `hann_window` + `rfftfreq` (saves 32 ms), fused `abs().square()` (127 ms → 89 ms), `CudaVisualizationFFT` same cache; `tools/analyze_and_sync.py` — `torch.cuda.Stream()` overlap CPU `beat_track` (24.0 s → 14.7 s, -39% on 182 s track)

#### GPU Health Fallback (WDDM GeForce fix)

- **Fixed**: `GET /api/health/gpu` returned `{"available":false}` on `System Python311` where `pynvml` hardcodes `NVSMI/nvml.dll` (missing, only `System32` exists) — patched `pynvml.py` + added `torch.cuda` fallback in `app/diagnostics/resources.py:541` and `app/services/vram_manager.py:109` (`mem_get_info`, `get_device_properties`, `fallback: torch.cuda` flag)
- **Fixed**: `GET /api/integrations/cuda/status` 404 from frontend — `api.ts:607` used `/api/health/integrations/cuda/status`; corrected to `/api/integrations/cuda/status` with legacy fallback, banner now shows `CUDA Available` + VRAM badge

#### Audio Analysis UX

- **Upload**: `validateFile` (MP3/WAV/FLAC/OGG/M4A, 500 MB), inline `fileError`, `audio` preview via `URL.createObjectURL`, `Clear` button, drag `border-dashed` states, `role=button` + `Enter`
- **CUDA banner**: always visible `role=status` — green `CUDA Available` / amber `CPU Mode`, VRAM `used/total %` badge, `fallback` badge, `GPU on/off` toggle with `aria-label`
- **Progress**: `aria-live`, `aria-busy`, dismissible error, `10–30 s` hint
- **Charts**: Energy beats sampled to ≤80 `ReferenceLine`s (was 400+ clutter), section bars with `title`/`aria-label`, helper text
- **Sections**: `Select all`, `role=list`, per-checkbox `aria-label`, helper `Tap single Play vs Generate Selected`
- **Library**: computed `filtered/sorted/paged`, `No files match + Clear filter`, `N files` count, fixed `filtered.length` pagination, updated Tips

#### Backend Integration Fix

- **Fixed**: `app/api/integrations_generation.py:74` `NameError: ImageGenerationRequest/VideoGenerationRequest not defined` — defined both `BaseModel`s locally, cleared `__pycache__`, backend now starts via `venv` `uvicorn` (`PID 23524` `available:true 3782/8192 MB`)

### Fixed - Health Page Layout

- **Fixed**: GPU card orphaned in 3-column grid — changed to 2-column layout (CPU+Memory, Disk+GPU)
- **Fixed**: ComfyUI card was heavy full-width before resource metrics — moved to sidebar column
- **Fixed**: Service Checks crammed into 1/3 width — merged into equal 2-column layout with Performance History
- **Fixed**: Action Log conditionally hidden — now always visible with empty state
- **Fixed**: Page title "Diagnostics" didn't match sidebar "Health" — renamed to "System Health"
- **Added**: Reusable `ResourceCard` component for CPU/Memory/Disk

### Added - Per-Process GPU Memory Monitoring

- **Added**: `/api/health/gpu/processes` endpoint using Windows Performance Counters (`win32pdh`) for per-process VRAM tracking
- Works on WDDM (GeForce) without admin privileges — replaces NVML-only approach that returned `N/A` on GTX 1070 Ti
- Human-readable format: process names resolved from PIDs, memory in MB/GB, sorted by usage
- Frontend GPU card now shows top 8 processes by VRAM usage

### Fixed - Vision Analysis Infrastructure

- **Fixed**: `vision-mcp_vision_mcp` tool fails with large images — created `tools/mcp/vision.mjs` standalone analyzer using sharp for resizing
- **Added**: `tools/mcp/vision.mjs` with `analyze`, `compare`, `diff` commands using sharp + Ollama gemma4:e2b-it-qat
- **Added**: `vision-page-analysis` skill in `.kilo/skills/` for screenshot-to-analysis workflow
- **Fixed**: npm arborist bug (`Cannot read properties of null`) blocking pnpm installs — updated npm to v12.0.3+

### Fixed - AI Tools Page Bug Fixes & Improvements

#### Critical: SSE Stream Parsing

- **Fixed**: `parseOllamaStream()` in `services/api.ts` — `event:` and `data:` lines are separate in SSE format but parser tried to extract event from the data line; stream was completely non-functional
- **Fixed**: Visualization tool calls never triggered during streaming — `td.result` was never populated; now extracts config directly from tool call arguments
- **Fixed**: `done` event overwrote accumulated `fullResponse` with only the last turn's text, losing prior turns

#### Generation Control

- **Added**: Cancel button with `AbortController` support — users can now stop ongoing generation
- **Added**: `ollamaChatStream()` accepts `AbortSignal` parameter for proper request cancellation
- **Fixed**: `vizConfig` not cleared on new generation — stale visualizations persisted

#### Tool Editor

- **Added**: JSON validation with visual feedback — red border + "Invalid JSON" message
- **Added**: Save button disabled when JSON is invalid or tool name is empty

#### Files Changed

| Action   | File                                                      |
| -------- | --------------------------------------------------------- |
| Modified | `packages/frontend/src/services/api.ts`                   |
| Modified | `packages/frontend/src/features/ai-tools/AIToolsPage.tsx` |

### Added - Comprehensive Backend Logging

- **Dedicated Ollama log**: `logs/ollama.log` for Ollama adapter requests/responses
- **SSE logging**: Connection/disconnect/broadcast events
- **Health monitor logging**: Health check results with adapter status
- **API endpoint logging**: Jobs, Video, Audio API request tracking
- **Structured format**: Timestamp, level, module, function, message
- **Log rotation**: 10MB per file, 5 backups

**Log Files:**
| File | Contents |
|------|----------|
| `app.log` | All application logs |
| `error.log` | Errors only with tracebacks |
| `ollama.log` | Ollama chat requests/streams/errors |
| `queue.log` | Queue processor events |
| `comfyui.log` | ComfyUI adapter events |

### Fixed - ComfyUI Update & Git Integration

- Fixed ComfyUI update endpoint not working with uvicorn --reload
- Added robust git detection with fallback paths for Windows
- Added detailed error logging with tracebacks for debugging
- Fixed subprocess PATH issues for git execution
- Update action now shows real-time progress in Action Log

### Added - VRAM Management System

- **VRAM Manager**: Coordinates GPU memory between Ollama and ComfyUI
- **Automatic Ollama Offload**: Unloads Ollama models when 3D generation starts
- **Automatic Ollama Reload**: Reloads Ollama models when 3D generation completes
- **OOM Prevention**: Emergency offload when VRAM exceeds critical threshold (92%)
- **API Endpoints**:
  - `GET /api/integrations/vram/status` - Current VRAM status
  - `POST /api/integrations/vram/offload-ollama` - Manual offload
  - `POST /api/integrations/vram/reload-ollama` - Manual reload
- **Thresholds** (for GTX 1070 Ti 8GB):
  - Warning: 85% VRAM usage
  - Critical: 92% VRAM usage
  - Minimum for 3D: 4GB free VRAM

### Added - Ollama Tool Calling & Agent Loop

#### Backend

- **New API endpoint**: `POST /api/integrations/ollama/chat` — Chat with tool calling and agent loop
- **Agent loop pattern**: Automatic tool execution up to `max_tool_calls` iterations
- **Built-in tools**: `get_project_structure`, `search_docs`, `get_system_health`, `list_jobs`, `get_job_status`
- **Streaming support**: SSE streaming with tool call handling
- **Tool details response**: Returns `tool_details` array with name, arguments, and result for each tool call

#### Frontend

- **Updated AI Tools Page**: Connection status, tool registry, tool call display
- **New API functions**: `ollamaChat()`, `ollamaChatStream()`, `parseOllamaStream()`
- **Tool definition types**: `ToolDefinition`, `ChatMessage` interfaces

#### Files Changed

| Action   | File                                                      |
| -------- | --------------------------------------------------------- |
| Modified | `packages/backend/app/adapters/ollama.py`                 |
| Modified | `packages/backend/app/api/integrations.py`                |
| Modified | `packages/frontend/src/features/ai-tools/AIToolsPage.tsx` |
| Modified | `packages/frontend/src/services/api.ts`                   |

### Changed - WebSocket Replaced with SSE (Server-Sent Events)

#### Why SSE over WebSocket

- **Automatic reconnection** — Browser's EventSource API handles reconnection natively; no custom reconnect logic needed
- **Event resumption** — `Last-Event-ID` header automatically replays missed events after reconnection
- **Proxy/firewall friendly** — SSE uses plain HTTP, works through any proxy without special configuration
- **Simpler implementation** — No heartbeats, no sticky sessions, no pub/sub backplane required
- **Vite 8.x compatible** — Eliminates WebSocket proxy bugs present in Vite 8.2.2

#### Backend Changes

- **New SSE endpoint**: `GET /api/events` — streams health updates, job progress, and resource warnings
- **New module**: `packages/backend/app/sse/handler.py` — `SSEManager` class manages client queues
- **Dependency added**: `sse-starlette>=2.0.0` for SSE response handling
- **Removed**: WebSocket endpoint (`/ws`), `websocket/handler.py` `ConnectionManager`, WebSocket-specific imports
- **Updated**: `health_broadcast_loop()` and `resource_monitoring_loop()` now use `sse_manager`

#### Frontend Changes

- **New service**: `packages/frontend/src/services/sseService.ts` — `SSEService` class using native `EventSource` API
- **Removed**: `socketManager.ts`, `createWebSocket()`, `getWebSocketUrl()`
- **Updated stores**:
  - `healthStore.ts` — `wsConnected` → `sseConnected`, `connectWebSocket` → `connectSSE`, `disconnectWebSocket` → `disconnectSSE`
  - `jobStore.ts` — Same naming updates, SSE-based real-time updates
- **Updated components**:
  - `Sidebar.tsx` — Uses SSE for health monitoring
  - `Queue.tsx` — Uses SSE for job progress updates
- **Updated hooks**: `useWebSocket` → `useSSE` in `hooks/index.ts`
- **Removed**: All WebSocket-related code and dependencies

#### Files Changed

| Action   | File                                                  |
| -------- | ----------------------------------------------------- |
| Added    | `packages/backend/app/sse/__init__.py`                |
| Added    | `packages/backend/app/sse/handler.py`                 |
| Added    | `packages/frontend/src/services/sseService.ts`        |
| Modified | `packages/backend/app/main.py`                        |
| Modified | `packages/backend/app/diagnostics/resources.py`       |
| Modified | `packages/backend/app/queue/manager.py`               |
| Modified | `packages/backend/app/queue/processor.py`             |
| Modified | `packages/backend/app/api/jobs.py`                    |
| Modified | `packages/backend/requirements.txt`                   |
| Modified | `packages/frontend/src/state/healthStore.ts`          |
| Modified | `packages/frontend/src/state/jobStore.ts`             |
| Modified | `packages/frontend/src/components/layout/Sidebar.tsx` |
| Modified | `packages/frontend/src/features/queue/Queue.tsx`      |
| Modified | `packages/frontend/src/services/api.ts`               |
| Modified | `packages/frontend/src/services/portConfig.ts`        |
| Modified | `packages/frontend/src/hooks/useWebSocket.ts`         |
| Modified | `packages/frontend/src/hooks/index.ts`                |
| Deleted  | `packages/frontend/src/services/socketManager.ts`     |

#### New Vault Files (docs/knowledge-library/)

- **`codebase.json`** — Machine-readable project structure: packages, tools, config, data flow pipelines. Maps every key file to its purpose so agents can navigate without reading source.
- **`api-registry.json`** — Complete API endpoint registry: 50+ endpoints across 10 routers with full request/response schemas, Pydantic model fields, query parameters, and content types.
- **`mcp-registry.json`** — MCP server tool inventories: 4 servers (Unity, Blender, ComfyUI, Remotion) with 80+ tools, parameter schemas, and usage patterns (full pipeline, quick video, 3D render).
- **`agent.manifest.json`** — Updated with references to all new registries and bootstrap endpoint.
- **`prompts.json`** — Genre prompt templates with weighted examples, negative prompts, and render tips.

#### New Backend Endpoints (packages/backend/app/api/docs.py)

- **`GET /api/docs/bootstrap`** — Single-call agent onboarding: returns manifest + codebase + API registry + MCP registry + prompts + vault doc index + quick start steps. One call gives agents everything needed to operate.
- **`GET /api/docs/search?q=<query>`** — Full-text search with relevance scoring: title matches (10pt), tag matches (8pt), path matches (5pt), content matches (3pt + multi-occurrence bonus). Returns ranked results with snippet context.
- **`GET /api/docs/structure?depth=N`** — Project directory tree scoped to key directories (packages, docs, tools, scripts, config). Skips hidden/node_modules/**pycache**/venv.
- **`GET /api/docs/codebase`** — Shortcut: returns codebase.json directly.
- **`GET /api/docs/api-registry`** — Shortcut: returns api-registry.json directly.
- **`GET /api/docs/mcp-registry`** — Shortcut: returns mcp-registry.json directly.

#### Frontend Documentation Page Improvements

- **Server-side search** — Debounced search using `/api/docs/search` with relevance scores displayed next to results.
- **JSON file badges** — Each JSON file type gets a colored badge: Agent Manifest (amber), Prompts (pink), Codebase Map (cyan), API Registry (emerald), MCP Registry (blue).
- **JSON viewer** — Shows top-level key count, file size, and copy-to-clipboard button.
- **Search snippets** — Search results show content snippets for context.

### Added - File Management & Media Library (Audio Covers, Duplicates, Rename)

- **Audio cover extraction** `packages/backend/app/api/outputs.py:93` — FFmpeg `attached pic` probe → `ffmpeg -y -i audio.mp3 -an -vcodec copy -frames:v 1` → `audio/{stem}.jpg` sidecar; `GET /api/outputs` returns `cover_image: "audio/...jpg"` for `audio` type (skip-list prevents `*.jpg` sidecars from appearing as standalone images); grid `MediaLibrary.tsx:375` and list `MediaLibrary.tsx:490` and modal `MediaLibrary.tsx:615` now show cover above `<audio controls autoplay>`
- **Duplicate detection** `GET /api/outputs/duplicates/groups?quick=true` — SHA256(size + first 1MB + tail) groups, `wasted_bytes`, `hash[:16]`; frontend `MediaLibrary.tsx:161` `Find Duplicates` panel with `Keep oldest, delete N` → `POST /api/outputs/bulk-delete`
- **Rename** `POST /api/outputs/{path}/rename {"new_name"}` — renames file + sidecars (`.json`, cover `.jpg`, `.mp3.json`); frontend pencil `MediaLibrary.tsx:125` inline modal + detail modal `Pencil` button; validates no `/` and `len<200`
- **Bulk delete + enhanced delete** — `POST /api/outputs/bulk-delete {"paths":[]}` and `DELETE /api/outputs/{path}` now also removes cover sidecars (`outputs.py:340`); frontend bulk bar `MediaLibrary.tsx:320` with `CheckSquare` selection on grid/list
- **Docs** — `README.md` Features + API Endpoints table updated, `docs/api/API_REFERENCE.md` new Outputs covers/rename/bulk/duplicate sections, new `docs/guides/FILE_MANAGEMENT.md` guide

### Added - Unity MCP Integration

- **Unity MCP Bridge**: `tools/mcp/unity-mcp-bridge.mjs` — local MCP server wrapping Unity REST API
- **Unity MCP Skill**: `.kilo/skills/unity-mcp/SKILL.md` — full documentation for AI-driven Unity workflows
- **Audio-to-Unity Sync**: `tools/analyze_and_sync.py` — analyze audio and generate beat-synced animation data
- **Available Unity tools**: `create_scene`, `create_gameobject`, `add_component`, `capture_scene_view`, `capture_game_view`, `editor_status`, `create_animation_clip`, `create_animator_controller`, `add_animator_state`, `add_animator_transition`, `bake_lighting`, `build`, and 100+ more via `unity_command`
- **Connection**: Unity Editor Pipeline server (port 7800) → MCP Bridge → Kilo Code

### Added - GPU Music Video Pipeline & 3D Generation

- **3D generation service**: `app.services.gen3d` — text-to-3D and image-to-3D via Hunyuan3D-2mini (optimized for 8GB VRAM)
- **Blender scene builder**: `tools/blender/builder` — generates bpy scripts for stages (concert, abstract, nature, urban, space), characters, cameras, beat-synced animation
- **Lyrics sync mapper**: `tools/blender/lyrics_sync` — maps timed lyrics to animation events, aligns to beats, supports WhisperX output
- **CUDA audio analysis**: `app.services.cuda.processor` — torch.stft() GPU FFT, spectral features, onset detection; image preprocessing (resize/normalize); visualization FFT
- **Hunyuan3D-2mini model**: Downloaded to `ComfyUI/models/diffusion_models/hunyuan3d-2mini` (~2.5GB)
- **ComfyUI-Hunyuan3DWrapper**: Custom node installed for ComfyUI integration
- **API endpoints**: `/api/health/gpu` (GPU snapshot), `/api/3d/status`, `/api/3d/generate`
- **Research docs**: `docs/notes/GPU_UTILIZATION_RESEARCH.md` and `docs/notes/3D_MODELS_8GB_VRAM.md`
- **GPU Pipeline Guide**: `docs/guides/GPU_PIPELINE.md` — full documentation for the 3D/GPU workflow

### Changed - Real-Time Communication (SSE replaces WebSocket)

- **Replaced WebSocket with SSE**: Server-Sent Events provide more reliable real-time updates with automatic reconnection and event resumption (see top of changelog for full details)
- **Removed WebSocket dependencies**: `websockets` package no longer required; using `sse-starlette` instead
- **GPU monitoring fix**: VRAM warning no longer falsely reports "critical" when GPU is idle. Now requires high VRAM **AND** high compute utilization (≥70%) **OR** high temperature (≥85°C) for critical level. Added `nvidia-ml-py` dependency for `pynvml`-based GPU stats (utilization + temperature)

### Added - Server Management & Data Persistence (Session 6)

#### Server Management

- **Unified server management**: `manage-servers.ps1` script for start/stop/restart/status of all services
- **ComfyUI integration**: `start-studio.ps1` now manages ComfyUI alongside backend/frontend/video editor
- **ComfyUI start script**: Fixed paths in `start_comfyui.ps1` for ComfyUI location and Python environment
- **NPM scripts**: Added `pnpm start`, `pnpm start:all`, `pnpm servers status` commands

#### Data Persistence

- **Database upgrade**: New tables for tracks, prompts, audio_files, ai_visuals, generation_sessions, user_preferences
- **Track Manager UI**: Table view for pairing prompts and lyrics to tracks with inline editing
- **CSV import**: Import tracks from HappyShrimp CSV with prompts and lyrics
- **Prompt storage**: Save and reuse generation prompts with tags and categories
- **Generation history**: Track AI visual generation parameters and results
- **User preferences**: Key-value store for UI defaults and settings

#### AI Visual Generation

- **ComfyUI service**: Full API client for image generation, model listing, system stats
- **AI Visuals Panel**: UI for generating AI visuals with prompt input and style presets
- **Style previews**: Low-res (256x256) thumbnails for all 8 styles before full generation
- **Music-to-Visual prompt transformer**: Converts music generation prompts (Suno/Udio) to visual prompts
- **Generation estimator**: Frame counts, time, VRAM, and output size estimates for GTX 1070 Ti

#### Audio Visualization

- **AudioReactiveVisualizer**: Real-time audio visualization using Remotion's APIs
- **Multiple styles**: Bars, waveform, circular, particles
- **Color schemes**: Neon, fire, ocean, monochrome
- **Composition upgrade**: Layered rendering with AI visual background + audio visualizer overlay

#### Repository Organization

- **Removed old directories**: Deleted `backend/`, `frontend/` (superseded by `packages/`)
- **Moved media files**: Large video files moved to `output/videos/`, test audio to `tests/audio/`
- **Updated .gitignore**: Added model directories, Happy Shrimp cache, and other clutter
- **Updated README**: Reflects current project structure and features
- **Scripts organization**: Only essential server management scripts tracked in git

### Changed - Codebase Cleanup & Type System Alignment

#### Type System

- **Shared types aligned with backend Pydantic models**:
  - Added missing `MUSIC_VIDEO_PREVIEW` to `JobType` enum in `shared/types.ts`
  - Added `queued` and `retrying` fields to `QueueStats` interface
  - Added `modified_at` and `cover_image` fields to `OutputFile` interface
- **Frontend services refactored to use shared types**:
  - `packages/frontend/src/services/api.ts` now imports `Job` and `QueueStats` from `@shared/types`
  - `packages/frontend/src/state/outputStore.ts` now imports `OutputFile` from `@shared/types`
  - Eliminates duplicate type definitions, ensuring single source of truth

#### Configuration

- **Workspace structure**: Python backend removed from pnpm workspace (it uses pip/conda, not npm)
  - `pnpm-workspace.yaml` now explicitly lists `packages/frontend`, `packages/video-editor`, and `shared`
  - Root `package.json` workspaces updated to match
  - Backend scripts changed from `pnpm --filter=backend` to direct `python` commands
- **Port configuration**: `video_editor_port` changed from `8080` to `3000` in `config/ports.json` to match Remotion default and README
- **Path aliases**: Added `@shared` alias to `tsconfig.json` and `vite.config.ts` for cleaner imports

#### Code Quality

- **Backend logging**: Replaced all `print()` calls with `logger.warning()`/`logger.info()` in:
  - `packages/backend/app/adapters/base.py`
  - `packages/backend/app/core/port_manager.py`
  - `packages/backend/app/services/image_generator.py`
- **Removed dead code**:
  - Removed duplicate `AudioAnalyzerError` class from `audio_analysis_handler.py` (already in `audio_analyzer.py`)
  - Removed redundant WebSocket endpoint from `packages/backend/app/api/jobs.py` (canonical one in `main.py`)
  - Removed unused imports across multiple backend files
  - Removed empty `apps/shared/` directory and `StillIRise.tsx.bak` backup file
- **Import organization**: Moved inline imports to module-level in `outputs.py`, `logs.py`, `integrations.py`, `processor.py`
- **Frontend**: Added missing `lint` and `test` scripts to `packages/frontend/package.json`
- **TypeScript**: Removed unused `useMemo` import from `ArtDirection.tsx`

### Added - Remotion Video Editor Improvements (Session 4)

#### Modular Components

- **Reusable component library** (`src/components/index.ts`):
  - `useAudioAnalysis()` — Hook for real-time audio spectrum/waveform data
  - `LyricDisplay` — Animated lyrics with verse/chorus/bridge styles
  - `AudioWaveform` — SVG waveform visualization
  - `SpectrumBars` — Frequency spectrum bar visualizer
  - `SceneTransition` — Flash/transition effects at specified times
  - `TrackInfo` — Track metadata display with progress bar

#### Template System

- **Template composition** (`src/compositions/Template.tsx`):
  - Configuration-driven approach (edit CONFIG object)
  - Easy lyric timing format
  - Copy-paste starting point for new videos
  - All reusable components wired up

#### Documentation

- **Comprehensive README** (`packages/video-editor/README.md`):
  - Quick start guide
  - Project structure overview
  - Step-by-step video creation workflow
  - All reusable components documented with examples
  - Configuration options reference
  - Rendering and troubleshooting guides

---

### Added - Design System & UX Overhaul (Session 4)

#### CSS & Visual Design

- **Enhanced color palette** — Added accent (pink), cyan, and emerald colors for more vibrant UI
- **Depth & layering** — Cards now have multi-layered shadows, gradient backgrounds, and top highlight lines
- **Micro-animations** — Added 12+ new animations (pulse-glow, shimmer, float, slide-in-up, ripple, etc.)
- **Button enhancements** — Radial gradient hover effects, active scale transforms, disabled state styling
- **Progress bars** — Triple-color gradient with animated stripe overlay and glow effects
- **Focus states** — Double shadow ring on focus, active glow effects
- **Neumorphic effects** — New `.neumorphic` and `.neumorphic-inset` utility classes
- **Status badges** — Color-coded badges with backgrounds for each status type

#### Responsive Design

- **5 breakpoints** — Large desktop (1920+), medium (1400), small (1100), portrait (900), narrow (600)
- **Vertical display support** — Sidebar collapses to horizontal top bar on portrait orientations
- **Adaptive grids** — 4→2→1 column degradation based on screen width
- **Mobile-friendly** — Compact padding, smaller fonts, touch-friendly targets

#### Component Improvements

- **StatusBadge** — Now includes background colors and borders per status type
- **Card** — New `glow` prop for gradient border effect on hover
- **ProgressBar** — New `showPercentage` and `size` props
- **EmptyState** — Animated icon with float effect

#### Beat Detection

- **Real audio analysis** — Replaced placeholder BPM assumption with actual audio energy analysis
- **Multi-band detection** — Analyzes low, mid, and high frequency bands
- **Adaptive thresholding** — Uses local median for dynamic onset detection
- **Tempo estimation** — Histogram-based BPM detection from inter-onset intervals
- **Beat classification** — Downbeats, backbeats, and energy-based intensity classification

#### ComfyUI Integration

- **Process manager** — Start/stop ComfyUI headlessly from the app
- **CUDA detection** — Checks for NVIDIA GPU compatibility before starting
- **Auto-restart** — Stops, updates, and restarts ComfyUI seamlessly
- **API endpoints** — Full REST API for ComfyUI management
- **Health monitoring** — Real-time status with uptime tracking

#### Logging System

- **Centralized logging** — Structured logging to 4 rotating log files
- **Per-module logs** — Separate files for app, errors, queue, and ComfyUI
- **Frontend log viewer** — Tabbed interface with search, filter, and auto-refresh
- **stdout capture** — print() calls are now logged via app.stdout

#### Security

- **Fixed vulnerabilities** — Updated brace-expansion, nanoid, postcss (0 remaining)

---

### Added - Art Direction Page Redesign (Session 3)

- **Live Style Tile** — Top panel shows combined effect of all active modules:
  - Gradient background using selected palette colors
  - Typography preview with selected font style and size
  - Color swatch strip with labeled roles (Primary, Secondary, Accent, Highlight)
  - Motion intensity bar showing animation budget
  - Texture overlay preview (scanlines, grain)
- **Module tooltips** — Info icons with hover explanations for each module:
  - Audio: "Tempo, key, and loudness data that drives visual reactivity"
  - Palette: "Color scheme applied to backgrounds, accents, and overlays"
  - Typography: "Font style, size animation, and text placement rules"
  - Motion: "Animation speed, easing, and transition intensity"
  - etc.
- **Variant previews** — Each expanded module now shows a visual preview:
  - Palette: Color swatches with labeled roles + description
  - Typography: Live text preview with selected font size
  - Texture: Visual texture pattern preview
  - Motion: Animated intensity bar + preview box
  - Layout: Grid structure mockup
  - Storyboard: Sequence list with shot descriptions
- **Progressive disclosure** — Modules collapsed by default, expand for details
- **Collapsible docs** — Documentation viewer hidden behind Docs button
- **Clearer labels** — Variant labels show human-readable names (e.g., "2-Card Layout" instead of "2-card")

---

#### Art Direction Page — Complete Redesign (v1 with Progressive Disclosure)

---

### Added - Page-by-Page UX Audit & Improvements (Session 3)

#### CSS & Component Improvements

- **Card styling** — Added `.card` with shadow, `.metric-card` with hover effects, `.section-header` for consistent section labeling
- **Button hierarchy** — `.btn-primary` now uses gradient + shadow + hover lift; `.btn-ghost` for secondary actions; `.btn-lg` for prominent CTAs
- **EmptyState component** — Enhanced with optional `icon` and `action` (CTA button) props for actionable empty states
- **Grid layouts** — Added `.grid-4` for 4-column layouts with responsive breakpoints

#### Page Improvements

**Dashboard**

- Added Quick Actions grid (Create Music Video, Generate Image, Visualizer, View Queue) with hover animations
- Converted Status Overview cards to centered metric cards with icons and hover effects
- Improved empty states with icons and actionable CTAs ("Generate Your First Image" button)
- Enhanced System Resources with bolder labels and improved progress bars

**Music Video Studio**

- Fixed waveform visualization (normalized amplitude data, added glow effects)
- Fixed AudioContext suspended state (resume on user gesture before play)
- Added ghost-style "Change Audio" button (replaces prominent "Change Audio File")
- Added gradient + shadow to primary "Generate Music Video" button
- Improved Quick Settings with 2x2 grid, uppercase tracking labels, consistent spacing
- Added "Recent Music Video Jobs" panel showing live job status
- Added Session Stats with improved empty state ("No activity yet")
- Fixed FFmpeg rendering (simplified command using testsrc for reliability)

**Image Generation**

- Enhanced empty state with icon and contextual CTA (shows "Generate" button when prompt exists)

**Global**

- Reduced information density across all pages with better spacing
- Standardized button styles (primary = gradient, secondary = outline, ghost = transparent)
- Improved typography with uppercase tracking labels for settings

#### Bug Fixes

- CORS: Added port 3000 to backend allowed origins
- Dashboard: Fixed missing `</div>` tag causing syntax error
- Dashboard: Fixed `stats.total` → `stats.pending` type error
- MusicVideo: Fixed `disabled` attribute on `<label>` element (invalid HTML)

---

### Added - Backend Audio Upload & Music Video Rendering (Session 2)

#### New Files

- **`packages/backend/app/api/audio.py`** — Audio upload and analysis API router
  - `POST /api/audio/upload` — Multipart file upload (max 500 MB, chunked)
  - `GET /api/audio/files` — List uploaded audio files
  - `GET /api/audio/analysis/{job_id}` — Retrieve analysis results
- **`packages/backend/app/services/music_video_handler.py`** — Music video generation handler
  - FFmpeg-based video rendering with 4 visualization styles
  - 5 color schemes (auto, warm, cool, neon, monochrome)
  - Audio analysis integration (librosa beat/tempo/waveform)
  - Progress tracking during rendering
  - Preview mode (5s 720p draft)
- **`config/ports.json`** — Shared port configuration for monorepo
- **`docs/api/API_REFERENCE.md`** — Complete API documentation
- **`docs/guides/MUSIC_VIDEO_GUIDE.md`** — Music video workflow guide
- **`docs/architecture/ARCHITECTURE.md`** — System architecture documentation

#### Modified Files

- **`packages/backend/app/main.py`** — Added audio router registration
- **`packages/backend/app/queue/processor.py`** — Registered music video handlers
- **`packages/frontend/src/services/api.ts`** — Added `uploadAudioFile()` function
- **`packages/frontend/src/features/music-video/MusicVideo.tsx`** — Complete rewrite:
  - Real audio upload to backend with progress indicator
  - Server-side beat detection via audio analysis job
  - Real job submission with stored audio path
  - Error handling with dismissible error messages
  - Success confirmation on job submission
  - Session stats panel (beat markers, batch jobs, total, completed)
  - Recent Music Video Jobs panel with live status
  - Disabled submit until upload completes
  - Batch processing with proper audio file references
- **`README.md`** — Updated features list, API endpoints, job types
- **`Guidelines.md`** — Added music video workflow section, updated status
- **`CHANGELOG.md`** — This update

### Fixed

- Missing `config/ports.json` — Created with correct monorepo port settings
- MusicVideo.tsx duplicate closing `</div>` tag
- Job submission now requires successful upload before enabling

---

## [Previous Sessions]

### Added - Music Video Studio (Complete Rewrite)

#### Frontend Components

- **AudioVisualizer** (`frontend/src/components/audio/AudioVisualizer.tsx`)
  - Real-time waveform visualization using Web Audio API
  - Beat detection with bass frequency analysis
  - Canvas-based rendering with gradient effects
  - Interactive playhead and beat markers
  - Play/pause controls with time display

- **BeatTimeline** (`frontend/src/components/audio/BeatTimeline.tsx`)
  - Interactive timeline editor for beat markers
  - 4 marker types: Beat, Drop, Break, Transition
  - 3 intensity levels: Low, Medium, High
  - Auto-detect beats feature
  - Drag-and-drop marker editing
  - Color-coded markers with legend

- **StyleTemplateGallery** (`frontend/src/components/audio/StyleTemplateGallery.tsx`)
  - 7 pre-built visual style templates:
    - Cyberpunk Neon (synthwave aesthetics)
    - Organic Flow (nature-inspired movements)
    - Geometric Pulse (shapes pulsing to beat)
    - Particle Dance (swirling particles)
    - Vinyl Retro (vintage record style)
    - Waveform Classic (oscilloscope look)
    - Fire Energy (dynamic flames)
  - Category filtering (Abstract, Organic, Geometric, Energetic, Atmospheric)
  - Visual previews with gradient backgrounds
  - Motion strength, complexity, and reactivity indicators

- **VideoPreview** (`frontend/src/components/audio/VideoPreview.tsx`)
  - Frame scrubbing with thumbnail strip
  - Time slider for precise navigation
  - Playback controls (play/pause/skip)
  - Generate/Regenerate preview buttons

- **Audio Components Index** (`frontend/src/components/audio/index.ts`)
  - Centralized exports for all audio-related components

#### Enhanced MusicVideo Page

- Complete rewrite of `frontend/src/features/music-video/MusicVideo.tsx`
- **Tabbed Interface** with 4 sections:
  - **Audio Tab**: File upload + waveform visualizer + quick settings
  - **Visual Style Tab**: Full style template gallery
  - **Beat Timeline Tab**: Beat marker editor (when audio loaded)
  - **Batch Queue Tab**: Queue management for multiple tracks
- **Right Panel Features**:
  - Video preview area
  - Selected style summary with motion/reactivity indicators
  - Submit buttons (single job + batch queue)
  - Recent jobs list
- **Batch Processing**: Add multiple files to queue, process all at once
- **Quality Settings**: Draft/Standard/High quality options

#### Backend API Endpoints

- **Music Video Models** (`backend/app/api/integrations.py`)
  - `BeatMarker` - Beat marker for music video synchronization
  - `MusicVideoStyle` - Visual style configuration
  - `MusicVideoRequest` - Full generation request
  - `PreviewGenerationRequest` - 5-second draft preview

- **New Endpoints** (`backend/app/api/integrations.py`):
  - `GET /api/integrations/music-video/styles`
    - Returns 7 pre-built visual style templates
  - `POST /api/integrations/music-video/generate`
    - Queues full music video generation job
    - Supports beat markers, style templates, quality settings
  - `POST /api/integrations/music-video/preview`
    - Queues 5-second 240p draft preview
    - Fast generation with reduced steps
  - `GET /api/integrations/music-video/templates`
    - Returns available ComfyUI workflow templates

#### Job Types

- Added `MUSIC_VIDEO_PREVIEW` to `JobType` enum (`backend/app/models/job.py`)

### Fixed

#### Backend API Routes

- Added `/api/services/status` route to `backend/app/main.py`
  - Returns adapter status and WebSocket connection count
- Added `/api/render/health` route to `backend/app/main.py`
  - Returns system health for rendering services
- Fixed 404 errors on health check endpoints

#### Frontend Configuration

- Updated `frontend/src/services/portConfig.ts`
  - Changed default URLs from `localhost` to `127.0.0.1`
  - Fixed WebSocket port to use same port as backend HTTP API (8000)
  - Updated `VITE_WS_PORT` default from 8001 to 8000
  - Added `ws_url` to PortConfig interface

### Changed

#### Port Configuration

- Backend now serves WebSocket on same port as HTTP API (port 8000)
- WebSocket path changed to `/ws` instead of separate port
- Frontend dynamically reads WebSocket URL from `config/ports.json`

---

## [Previous Sessions]

### Infrastructure Improvements (Session 2)

#### Backend

- Implemented backend health API routes
  - `/api/health` - Basic health check
  - `/api/diagnostics/system` - System diagnostics
  - `/api/services/{service}/check` - Service-specific checks
- Fixed WebSocket connection to use same port as HTTP API (port 8000)
- Unified port configuration in `port_manager.py`
- Added health broadcast background task
- Added resource monitoring task

#### Frontend

- Fixed Media Library route integration
- Added Media Library to sidebar navigation
- Implemented ComfyUI adapter configuration in Settings page
- Replaced Stable Diffusion references with ComfyUI
- Added light theme toggle with CSS variable support
- Updated API calls to default to ComfyUI backend

---

## Git Commit Timeline

### Commit [PENDING] - feat(music-video): Complete music video studio implementation

**Date:** 2026-04-24  
**Changes:**

- All Music Video Studio components and backend endpoints
- AudioVisualizer, BeatTimeline, StyleTemplateGallery, VideoPreview
- Enhanced MusicVideo.tsx with tabbed interface
- 4 new backend API endpoints for music video generation
- MUSIC_VIDEO_PREVIEW job type

### Commit [PENDING] - fix(api): Add missing health and service routes

**Date:** 2026-04-24  
**Changes:**

- Added `/api/services/status` endpoint
- Added `/api/render/health` endpoint
- Fixed WebSocket port configuration

### Commit [PENDING] - refactor(frontend): ComfyUI integration and theme support

**Date:** 2026-04-24  
**Changes:**

- Updated Settings page for ComfyUI configuration
- Added light theme toggle
- Fixed port configuration (localhost → 127.0.0.1)

---

## Migration Notes

### For Users Upgrading

#### Music Video Studio

1. Upload audio file in the **Audio** tab
2. Select visual style in the **Visual Style** tab
3. Edit beat markers in the **Beat Timeline** tab
4. Generate preview (5s draft) before full render
5. Submit job or add to batch queue

#### Configuration Changes

- WebSocket now connects on same port as backend (8000)
- No separate WebSocket port configuration needed

---

## Future Roadmap

### Planned Features

- [ ] Real-time preview during audio playback
- [ ] Export to multiple platforms (YouTube, Vimeo)
- [ ] Lyrics synchronization for karaoke-style videos
- [ ] Advanced beat detection algorithms
- [ ] Custom style template creation UI
- [ ] Video stitching for long tracks

### Known Issues

- Git index.lock blocking commits (requires manual removal)
- Some lint warnings in new components (non-blocking)

---

## Contributors

- Development assisted by Cascade AI (Windsurf)

---

_Last updated: 2026-10-01_
