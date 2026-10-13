# Remix / Mashup Plan — Oct 2026

**Status:** Phase 2 complete (2026-10-13) — B1–B7 all landed; Phase 3
(frontend ease-of-use) next
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

### A1. Entry point from the Media Library

`RemixPanel.tsx` is buried two levels deep (Visualizer → Stem Mixer → collapsed
"Remix / Mashup" toggle, `RemixPanel.tsx:340-348`); `LineagePanel.tsx:189-196`
lists mashups already made but offers no way to *start* one. Add a "Mashup this
track" button on the track detail that navigates to `/visualizer` with the
track preselected and the Remix panel auto-expanded — mirror the existing
`setPendingRemixRecipe`/`setPendingTrack` handoff (`utils/pendingTrack.ts:37`).

- **Accept:** from a library track, one click lands in the visualizer with the
  Remix panel open and the track loaded.

### A2. Inline stem separation in the empty state

With no separated stems the panel shows a text instruction
(`RemixPanel.tsx:355-359`), not an action — the user must leave, separate, and
return. Add an inline "Separate stems" button that triggers separation for the
current track and refreshes `getRemixSources()` on completion.

### A3. Audible preview

`runPreview` (`RemixPanel.tsx:248-258`) returns JSON only (duration, stretch
ratios, per-layer RMS, warnings) — the user can't hear anything until paying
for a full build. Add `POST /api/audio/remix/preview-audio` rendering a
~30 s low-bitrate mixdown excerpt as a playable URL (or mix the excerpt
client-side via WebAudio — the source stems are already addressable).

- **Accept:** user hears a recognizable excerpt before committing to a build.

### A4. Legible per-layer controls

Layer rows expose `dB`, `st`, `@bar` micro-inputs (`RemixPanel.tsx:430-445`) —
gain, key-shift, source-start-bar abbreviated past decoding. Replace with
labeled sliders + value readouts, and add a per-layer audition button for the
source stem excerpt.

### A5. No silent overwrite

`recipe()` hardcodes `overwrite: true` (`RemixPanel.tsx:243`); the name
defaults to `"mashup-1"`. On build, auto-suggest the next free name and make
overwrite an explicit checkbox, default off.

### A6. Timeline view of the arrangement

Slots are stacked form sections with `bars`/`xfade` numbers
(`RemixPanel.tsx:398-428`) — a 4-bar and a 32-bar slot look identical. Render
a proportional horizontal bar timeline above the forms, one segment per slot,
colored chips per stem.

### A7. Fix the key-advisory doc/code drift

The panel docstring claims the probe's advisory key is shown "labelled as
unreliable", but `key_advisory`/`key_confident` appear nowhere in
`RemixPanel.tsx` (only the type in `remix.ts:28-32`). Either render the
advisory with its label or correct the docstring.

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

## Non-goals

- Rebuilding the DSP or data model — the audit found them agent-ready.
- Trusting detected key for auto-shifting (AGENTS.md: chroma flatness says no).
- Prompt → audio in one shot (B2 is draft → confirm, always).
