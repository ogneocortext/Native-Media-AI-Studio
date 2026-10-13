# Remix / Mashup Plan — Oct 2026

**Status:** Complete (2026-10-13) — B1–B7 (Parts A and B) all landed; A3/A4/
A6/A7 finished the frontend. Both stated follow-ups are closed: the route
baseline was refreshed alongside A3 (it also caught up B2's `/from-prompt`),
and the Windows e2e pass landed as `packages/frontend/tests/remix-panel.spec.ts`
(4 tests, full suite 90/90 green).
**Owner:** repo owner (implementation: local coding agent)
**Evaluation:** read-only audit of `RemixPanel.tsx`, `remixRecipe.ts`,
`services/api/remix.ts`, `app/api/audio_remix.py`, `services/stem_remixer.py`,
`mcp-contracts-2026.md` (2026-10-06)

> Architecture facts this plan inherits (AGENTS.md — do not re-litigate):
> remixes are ordinary stem sets (`output/remixes/<name>/{vocals,drums,bass,
> other}.wav` + `remix.json`), so enhance/playback/visualize need no
> special-casing. Source **tempo** is auto-detected and time-stretched; source
> **key** is never auto-shifted (chroma flatness 0.978–0.998 — untrustworthy),
> `key_shift_semitones` stays explicit per layer. Master via
> `POST /api/audio/remix/{name}/enhance` (not `/api/audio/enhance-stems`);
> serve via `GET /api/audio/remix/{name}/file/{which}`.

## What already works (don't rebuild)

- REST surface: plain JSON, precise `RemixRecipeRequest` validation
  (1–64 slots), `_safe_track_name` path guards.
- Manifests round-trip losslessly into rebuildable recipes — the Media Library
  "reopen & rearrange" path.
- `preview_recipe` warnings are genuinely useful (near-silence below −50 dBFS
  with the `source_start_bar` hint); `preview_recipe` warns on quiet layers.
- `by-track` lineage gives provenance per track.

## Part A — Frontend ease-of-use

### A1. Entry point from the Media Library — DONE 2026-10-13

`RemixPanel.tsx` is buried two levels deep (Visualizer → Stem Mixer → collapsed
"Remix / Mashup" toggle, `RemixPanel.tsx:340-348`); `LineagePanel.tsx:189-196`
lists mashups already made but offers no way to *start* one. Add a "Mashup this
track" button on the track detail that navigates to `/visualizer` with the
track preselected and the Remix panel auto-expanded — mirror the existing
`setPendingRemixRecipe`/`setPendingTrack` handoff (`utils/pendingTrack.ts:37`).

- **Accept:** from a library track, one click lands in the visualizer with the
  Remix panel open and the track loaded. **Verified in-browser** (below).

Landed: `setPendingRemixOpen` / `consumePendingRemixOpen` in `pendingTrack.ts`
(a third handoff slot, same window+sessionStorage shape as the others), a
"Mashup this track" button in `LineagePanel`'s header, and `setOpen` added to
`usePanelCollapsed` so a handoff can expand the panel — the panel ships
collapsed by default, so loading the track alone still left the user hunting
for the control they just asked for. Browser-verified from the library detail:
one click lands on `/visualizer` with the track loaded and the panel expanded.

### A2. Inline stem separation in the empty state — DONE 2026-10-13 (code-complete)

With no separated stems the panel shows a text instruction
(`RemixPanel.tsx:355-359`), not an action — the user must leave, separate, and
return. Add an inline "Separate stems" button that triggers separation for the
current track and refreshes `getRemixSources()` on completion.

Landed: the empty state now renders a "Separate stems for the current track"
button (via `separateAudioFile`, the existing `/api/audio/separate-file` call)
that refreshes the source list and re-seeds on completion, with a busy state
and the friendly error path; with no track loaded it says so instead of
offering a button that cannot work. Browser-verifying *this* branch needs a
stem-free state this machine does not have (every candidate track already has
stems), so it is code-complete and guard-tested rather than click-verified;
the non-empty branch was verified live (7 stems ready, panel interactive).

### A3. Audible preview — DONE 2026-10-13

`runPreview` (`RemixPanel.tsx:248-258`) returns JSON only (duration, stretch
ratios, per-layer RMS, warnings) — the user can't hear anything until paying
for a full build. Add `POST /api/audio/remix/preview-audio` rendering a
~30 s low-bitrate mixdown excerpt as a playable URL (or mix the excerpt
client-side via WebAudio — the source stems are already addressable).

- **Accept:** user hears a recognizable excerpt before committing to a build.

Landed as its own endpoint rather than a client-side WebAudio mix. The plan
offered both; the mix core is the thing worth previewing, and a browser-side
mix would have needed its own copy of the tempo/key/tone/crossfade maths — a
second implementation to keep in sync with the one being previewed. So
`stem_remixer._mix_recipe` is now the shared core for `/build` and the
preview, and the preview truncates *before* mixing.

Design points the implementation forced:

- **Truncate whole slots first, then one boundary.** `truncate_recipe` keeps
  whole slots up to ~30 s and trims only the slot that crosses the cap,
  clamping its crossfade with it so `plan_timeline` cannot reject the result.
  An audition of the first three slots says more than a hard cut mid-slot.
- **One stereo mixdown, peak-normalised.** The build writes four stems; the
  audition is a single file, normalised to its own peak so it is not quieter
  than the build would be.
- **Cached by recipe hash** (`output/remixes/.previews/`, 12 newest kept, plus
  a `.json` sidecar). Re-clicking Audition after a tweak replays only the
  changed part: measured 0.017 s replay against a 10.57 s render for a
  4-bar one-stem recipe. The sidecar exists because the written file is
  normalised, so a cache hit's `warnings` could not otherwise be recovered.
- **Warnings survive the cache.** A second call returns the same facts as the
  first (`test_render_preview_audio_replays_from_cache_without_remixing`
  asserts the mix runs once and the two results are equal).

One defect this work found and fixed on the way, recorded here because it was
not the new code: the shared-core refactor returned
`{k: int(v) for k, v in plan.items()}`, and `seg_ns`/`xf_ns` are **lists**, so
`int()` raised `TypeError` — `/build` and `/preview-audio` both 500'd until it
was corrected to a per-element cast. Measured: `POST /preview-audio` → 500
`TypeError`, then 200 with a playable 6.687 s excerpt after the fix; `/build`
re-verified end-to-end (8-bar two-slot recipe → 10.031 s manifest). The
regression test is `test_mix_recipe_plan_values_are_plain_ints`, and it was
mutation-checked — with the old line restored the suite fails, so the test
sees the bug. 10 new tests (69 in the file).

**Verified live:** render 10.57 s → `GET /api/audio/remix/preview-file/<hash>`
200 `audio/wav`, 589,868 bytes (6.687 s × 22050 × 2ch × 2B); replay 0.017 s;
a 24-bar arrangement truncated at 23.406 s with `truncated: true`; bad keys
(`..`, unknown) return 404 rather than 500. **Browser-verified:** clicking
Audition on the seeded arrangement renders and mounts a native `<audio>`
(13.3 s, `src=/api/audio/remix/preview-file/…`) — the length the A6 caption
predicts.

### A4. Legible per-layer controls — DONE 2026-10-13

Layer rows expose `dB`, `st`, `@bar` micro-inputs (`RemixPanel.tsx:430-445`) —
gain, key-shift, source-start-bar abbreviated past decoding. Replace with
labeled sliders + value readouts, and add a per-layer audition button for the
source stem excerpt.

Landed: each layer row carries three labelled range inputs with live readouts
(gain −24…+12 dB step 0.5; key ±12 st step 1; start bar 0…32) and a per-layer
audition button that plays that layer's **source** stem, resolved through the
`library_file` join B6 added to `/sources` (a source with no unambiguous
library file gets a message rather than a dead button). Every control keeps
its `aria-label`, so the existing specs and screen readers still address them.

**Verified in-browser** on Ad Nauseam: four seeded layer rows each render the
three sliders, and the vocals audition issued
`/api/audio/stems/SunoV6Mini-Ad-Nauseam.m4a` → 200 `found: true`, playing
`/api/audio/stem-file/SunoV6Mini-Ad-Nauseam/vocals`.

### A5. No silent overwrite — DONE 2026-10-13

`recipe()` hardcodes `overwrite: true` (`RemixPanel.tsx:243`); the name
defaults to `"mashup-1"`. On build, auto-suggest the next free name and make
overwrite an explicit checkbox, default off.

Landed: `nextFreeName` (pure, in `remixRecipe.ts`, 5 tests) keeps an untouched
name one step ahead of what exists; anything typed is never rewritten.
Overwrite is a visible checkbox defaulting to off, `recipe()` passes it
instead of hardcoding `true`, and `runBuild` refuses a colliding name with
overwrite off — the case that used to replace the previous remix without
asking. A live hint names the collision and clears on rename.
**Browser-verified:** the name auto-suggested collision-free, typing an
existing name showed the hint and Build refused with the expected message
while nothing rendered, and the hint cleared on rename.

### A6. Timeline view of the arrangement — DONE 2026-10-13

Slots are stacked form sections with `bars`/`xfade` numbers
(`RemixPanel.tsx:398-428`) — a 4-bar and a 32-bar slot look identical. Render
a proportional horizontal bar timeline above the forms, one segment per slot,
colored chips per stem.

Landed: `timelineSegments` in `remixRecipe.ts` (pure — slot width = bars /
total bars, crossfade share, distinct stems in canonical order) renders as one
bar with per-stem coloured chips and a caption (`8 bars · 13.3s at 144 BPM`).
5 unit tests, including the plan's own accept case: a 4-bar and a 32-bar slot
now measure 11.1% and 88.9%.

A first caption computed seconds as `bars * bpm / 60 / 4`, which reports 4.8 s
for an arrangement the audition renders as 13.3 s. Corrected to
`bars * 4 * 60 / bpm` and re-verified against the rendered excerpt — they now
agree to one decimal.

### A7. Fix the key-advisory doc/code drift

The panel docstring claims the probe's advisory key is shown "labelled as
unreliable", but `key_advisory`/`key_confident` appear nowhere in
`RemixPanel.tsx` (only the type in `remix.ts:28-32`). Either render the
advisory with its label or correct the docstring.

Landed: the docstring is now true. The seeding probe's result feeds a
`keyAdvisory` state rendered beside the arrangement header — it is a fact
about the seeded source track, not about a built remix — with the
unreliability attached only when the probe itself is not confident.
**Verified in-browser** on Ad Nauseam: `advisory key F — unreliable (chroma
is flat on these stems); key shifts stay explicit per layer`, matching the
probe's `key_advisory: "F"`, `chroma_flatness: 0.9979`,
`key_confident: false`. (An earlier draft of this hunk nested the advisory
inside the `{built && …}` block, where it only appeared after a render; the
browser check caught that and it moved.)

## Part B — Agent-drivability

Target scenario: *"make a darker version of track X using its drums and bass
plus the vocals from track Y"* — from that sentence to a rendered track.

### B1. MCP contract for remix — DONE 2026-10-13

`mcp-contracts-2026.md` documents Unity, Ollama Tools, Vision, HyperFrames —
zero audio/remix tools. Add `remix_*` tools to the Ollama Tools MCP server (or
a new audio MCP): `remix_list_sources`, `remix_probe`, `remix_preview`,
`remix_build`, `remix_enhance`, `remix_list`, `remix_get_file`, with
JSON-Schema contracts recorded in `mcp-contracts-2026.md`.

Landed: nine `remix_*` tools on the Ollama Tools bridge
(`tools/mcp/ollama-tools-mcp.mjs`) — the plan's seven plus
`remix_job_status` (B5 made `/build` and `/enhance` asynchronous, so a
job id without a poller is unusable) and `remix_from_prompt` (B2, the
target scenario's entry point). Every handler is a thin bridge to
`/api/audio/remix/*`; `remix_build` and `remix_enhance` submit then poll
to a terminal job state (build measured 8–23 s, enhance ~60 s).
Schemas registered in `_TOOL_SCHEMAS` (`services/mcp_validator.py`) so
the pre-call validator covers them, and the JSON-Schema contracts
recorded in `docs/knowledge-library/mcp-contracts-2026.md` §3.11.

Verified live over stdio: `tools/list` returns 19 tools (9 remix), and a
full agent path — from-prompt draft → preview of the returned recipe
(62.787 s / 32 bars) → get_file locator — plus both error paths
(`Missing required arg: track`, `Unknown tool: …`) returning readable
errors rather than crashing. **Phase 1 (agent backbone) is now complete:
B5, B3, B2, B1 all landed.**

### B2. Natural-language entry point — DONE 2026-10-13

No endpoint accepts a prompt today; the caller must hand-build the full
`RemixRecipeRequest` (name, target_bpm, 1–64 slots, per-layer
track/stem/gain/key-shift/start-bar) — a 5+ call chain with all musical
judgment on the agent. Add `POST /api/audio/remix/from-prompt {prompt}`:
local Ollama (repo already uses `qwen3.5:9b` in `music_prompt_generator.py`)
maps NL → `RemixRecipeSpec` — fuzzy-match track references against the
library, resolve stem names, map mood adjectives (see B4) to arrangement
choices. Return `{recipe, explanation}` for agent review; the existing
`/build` renders it. **Two-step (draft → confirm)** — never prompt → audio in
one shot.

Landed: new `services/remix_prompt.py` (pure core, 36 tests) +
`POST /api/audio/remix/from-prompt` → `{recipe, explanation, warnings,
model_used, source}`. `recipe` is the exact `/build` request shape, and
`overwrite` defaults **False** on a draft (A5 starts here). Design
points that the first live run forced:

- **Draft-only**, per the plan's non-goals; `/preview` or `/build` (B5's
  job-tracked render) does the rest.
- **The model never invents sources.** Its system prompt carries the real
  source table (names, available stems, cached probe BPM) and every
  returned layer is re-resolved against it; an unresolvable track or
  missing stem is dropped with a warning rather than a 400.
- **Per-source stem attribution** — the plan's own target sentence
  ("drums and bass from X, vocals from Y") cannot be answered by a
  global stem scan, so `attribute_stems` assigns by corridor plus a
  from/of handoff ("the vocals *from* Ad Nauseam").
- **B6's fixture guard.** The first live test drafted from
  `demucs_test_input` — the ~10-second test fixture the plan warns about —
  because `list_stem_sources` lists every stem directory. Drafts now
  exclude test-fixture names and *name the exclusion* in the warnings.
- **Substitution honesty.** When the model uses a track the prompt never
  named (an unfulfillable request substituted), the warning says so and
  lists the tracks.
- **Deterministic fallback.** With no model answering, the same prompt
  parses deterministically into a valid recipe with `source: heuristic`
  and a warning naming the fallback, so an agent always gets something
  reviewable. A prompt naming no library track is a 400.

Verified live against the real model (`source: ollama`, `qwen3.5:9b`):
the target sentence drafted a 2-slot recipe with drums+bass under
borrowed vocals at the source track's probed BPM; an unavailable-track
prompt produced the substitution warning naming the stand-in; a prompt
naming nothing produced all three honesty warnings.

### B3. Richer source discovery — DONE 2026-10-06

`GET /api/audio/remix/sources` returns track names + per-stem booleans only
(`stem_remixer.py: list_stem_sources`) — no BPM, duration, energy. Extend it
with the cached probe data (bpm, duration_sec, first_audible_sec); the probes
already live on disk (`output/remixes/.probes/`), so this is a join, not new
analysis.

Landed: `list_stem_sources` joins `_probe_summary(track)` — a pure file read
of the probe cache — so a probed source lists `bpm`/`duration_sec`/
`first_audible_sec` and an unprobed one omits them (verified live: 7/7
sources carry the join). Frontend `RemixSource` gained the three optional
fields.

### B4. Mood adjectives need parameters to land on — DONE 2026-10-13

"Darker" is inexpressible: `RemixLayer` supports only `gain_db`,
`key_shift_semitones`, `source_start_bar`. Add optional per-layer tone shaping
(`lowpass_hz` and/or a `brightness_db` tilt) plus a documented
adjective→parameter map for the NL endpoint's system prompt (`dark` → lowpass
+ reduced highs; `punchier` → drums +3 dB, …).

Landed. `RemixLayer` carries `lowpass_hz` (200–20000 Hz, STFT-domain zeroing
above the cutoff, the same construction as the enhancer's `_high_pass`) and
`brightness_db` (±12 dB/octave, a **shelf above a 1 kHz pivot** — a true
constant slope would also boost the lows by 6 dB under a "darker" command,
which fights the layer's own bass gain). Both default to none, so every
existing recipe and manifest renders bit-identically; the manifest round-trip
carries them so "reopen & rearrange" preserves tone. The API request gained
the two optional fields (Pydantic-validated, same ranges), and the MCP recipe
shape documents them.

`MOOD_ARRANGEMENTS` in `remix_prompt.py` now lands the adjectives on tone as
well as gain — "dark" is a 900 Hz lowpass plus −4 dB/oct, "darker" 600 Hz /
−6 dB/oct — and the B2 system prompt tells the model that dark means lowpass
plus a negative tilt, never just quieter. One composition rule: gains and
tilts **add** across adjectives, the lowpass is the **strongest** mood's
(filtering 900 then 600 is the 600 filter, so summing cutoffs would silently
pick the lower one).

Verified on real audio, not just synthetics: a build of Ad Nauseam's bass at
`lowpass_hz=800` measured against the source stem — sub-bass ratio 1.001,
bass band 1.02, 800 Hz–3 kHz **0.043 (−27 dB)**, 3–10 kHz 0.087; a
tilt-only build (`brightness_db=-6`) held sub-pivot energy flat (−0.0 /
+0.1 dB) while cutting the top band −7.3 dB, which is the shelf signature.
Live through the NL endpoint, the model now asks for tone when told "darker"
(lowpass 200–3200 Hz with negative tilts), and two out-of-range requests
(180/150 Hz) came back clamped to 200 with warnings. 6 new drafter tests + 6
new DSP/validation tests; 102 backend remix tests green.

### B5. Job tracking on build/enhance — DONE 2026-10-06

`/build` and `/enhance` are synchronous (`asyncio.to_thread` awaited inline —
enhance is "deliberately not backgrounded", ~60 s). No job IDs, no progress,
no cancellation. Only `/tempo/refresh` has the job-id + `/tempo/status`
pattern. Give `/build` and `/enhance` the same treatment: return `{job_id}`
immediately, `GET /api/audio/remix/jobs/{id}` → queued/running/done/failed +
progress + result manifest. This also fixes A8 (frontend long-op UX) — one
fix serves both.

Landed: new `services/remix_jobs.py` registry (mirrors
`essentia_tempo_store`'s `_Job`: in-memory, lock-guarded, 900 s timeout
reported as failed+timed_out, last 16 retained). Both endpoints validate
synchronously (404 missing stem / 409 collision / 404+409 for enhance) then
return `{job_id}` in ~10–15 ms; `GET /jobs/{id}` and `GET /jobs` serve
status + result. The enhance coroutine runs under `asyncio.run` in the job
thread. Frontend keeps `buildRemix`/`enhanceRemix` as start+poll wrappers
(RemixPanel unchanged) and exports the raw job calls. Decision log D34.
Verified live: build acknowledged 0.010 s → done 8.2 s with full payload;
enhance acknowledged 0.015 s → done with 16 steps + wav path.

### B6. Accept either track key — DONE 2026-10-13

Sources are keyed by bare stem-directory names (`SunoV6Mini-Ad-Nauseam`) while
the library reports paths; the frontend needs a `matchSource` normalizer with
fixture guards because naive matching once built mashups from a 10-second
demucs test fixture. Return the resolved library filename alongside the stem
key in `/sources` wherever the join is unambiguous, and accept either key on
all remix endpoints.

Landed. `stem_remixer.resolve_track_key` accepts a stem key, a library
filename (`SunoV6Mini-Ad-Nauseam.m4a`), a relative path
(`Suno-V6-Mini/…m4a`), or a hash-prefixed variant (`2f9a5ced_…m4a`) and maps
it to the canonical stem key; ambiguity is reported, never guessed (a suffix
match is used only when it is the unique candidate). Every remix endpoint
resolves through it — `/build` and `/preview` normalise at
`_to_recipe`, so the manifest records provenance in the stem service's own
vocabulary, and `/probe`, `/build` and `/by-track` all accept library names.
`/sources` now carries `library_file` wherever the join is unambiguous, and
omits it when it is not. The frontend's `matchSource` moved into the testable
`remixRecipe.ts` module with the fixture guard: a preselect never lands on
`demucs_test_input`, and returns undefined rather than picking a fixture.

Verified live: `/sources` joined 5 of 7 sources (refusing the fixture and the
suffix-only match); `/probe/SunoV6Mini-Ad-Nauseam.m4a` returned
bpm 143.555; `/build` with a library filename rendered and its manifest
recorded the canonical `SunoV6Mini-Ad-Nauseam`; an unknown library name got a
400 naming the endpoint to check. 8 new backend tests + 4 new frontend tests
(11 in the file).

One regression this wiring caught and fixed along the way: `_pick_analysis_stem`'s
per-stem probe loop caught only `FileNotFoundError`, so a reference that
resolved to no source at all escaped as a `ValueError` from a function
documented to raise `FileNotFoundError`. Both now mean "next stem".

### B7. Structured warnings — DONE 2026-10-06

`preview_recipe` warnings are free-text strings an agent must parse. Return
them as `{code, layer_ref, field, suggestion}` — e.g.
`{code: "near_silent", layer: 2, field: "source_start_bar", suggestion:
"first_audible_sec is 7.06; try source_start_bar ≥ 4"}`. The probe data to
generate these already exists.

Landed: `preview_recipe` now reports `warnings_detail` alongside the
original `warnings` (backward compatible). Each detail is
`{code: "near_silent", layer_ref: "track/stem", field: "source_start_bar",
measured_rms_db, suggestion}` where the suggestion derives from the probe's
cached `first_audible_sec` and the recipe's bar length (e.g.
"first_audible_sec is 7.06; try source_start_bar >= 4"); without a probe
it falls back to "check source_start_bar". Frontend `RemixPreview` gained
the optional `warnings_detail` array.

## Suggested order

**Phase 1 — agent backbone:** B5 (job tracking; unblocks reliable agent *and*
frontend long ops) → B3 (richer sources) → B2 (NL endpoint) → B1 (MCP contract).
**Phase 2 — expressiveness + robustness:** B4 (tone shaping) → B6/B7.
**Phase 3 — frontend:** A1 → A2 → A5 (cheap wins) → A3/A4/A6 (preview, controls,
timeline) → A7 (docstring).

### Windows e2e pass over the Phase 3 controls (2026-10-13)

`packages/frontend/tests/remix-panel.spec.ts`, 4 tests, in the same style as
`canvas2d.spec.ts`:

1. **A1** — seeds `__pendingRemixOpen` on the origin (the panel only mounts once
   a track is loaded, so a flag set after navigation arrives too late), selects a
   track the panel can actually source, and asserts both that the stems resolved
   and that the panel is *expanded*. "N stems ready" appears in both panel
   states, so the expansion claim rests on the timeline, which only the expanded
   body renders.
2. **A6 + A7** — parses the timeline caption's own numbers and checks its
   seconds are the bars it claims at the tempo it claims, then compares the key
   advisory against what `/probe` actually returned (key *and* confidence), so
   the test cannot pass by asserting the text alone.
3. **A4** — counts the three labelled sliders per seeded layer and moves two of
   them, reading the values back so a control that renders but does nothing fails.
4. **A3** — clicks Audition, waits for the excerpt player, checks its src is a
   `/preview-file/` URL and that the element has no media error (a 404 there
   surfaces on the element, not as a failed request).

Machine-independent by construction: instead of hardcoding a library track, the
spec asks `/api/audio/remix/sources` which track the panel can source, using the
same normalization and fixture guard `matchSource` uses. A hardcoded name would
pass here and silently select nothing elsewhere. Track whose analysis is not
cached 404s on load (the visualizer then falls back to live audio), so those
console lines are filtered by name rather than by dropping the console assertion.

The caption assertion is mutation-checked: reverting the seconds formula to the
bug A6 fixed makes it fail.

## Non-goals

- Rebuilding the DSP or data model — the audit found them agent-ready.
- Trusting detected key for auto-shifting (AGENTS.md: chroma flatness says no).
- Prompt → audio in one shot (B2 is draft → confirm, always).
