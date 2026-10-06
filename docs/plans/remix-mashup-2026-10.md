# Remix / Mashup Plan — Oct 2026

**Status:** Proposed 2026-10-06 — not yet approved or started
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

### B1. MCP contract for remix

`mcp-contracts-2026.md` documents Unity, Ollama Tools, Vision, HyperFrames —
zero audio/remix tools. Add `remix_*` tools to the Ollama Tools MCP server (or
a new audio MCP): `remix_list_sources`, `remix_probe`, `remix_preview`,
`remix_build`, `remix_enhance`, `remix_list`, `remix_get_file`, with
JSON-Schema contracts recorded in `mcp-contracts-2026.md`.

### B2. Natural-language entry point

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

### B3. Richer source discovery

`GET /api/audio/remix/sources` returns track names + per-stem booleans only
(`stem_remixer.py: list_stem_sources`) — no BPM, duration, energy. Extend it
with the cached probe data (bpm, duration_sec, first_audible_sec); the probes
already live on disk (`output/remixes/.probes/`), so this is a join, not new
analysis.

### B4. Mood adjectives need parameters to land on

"Darker" is inexpressible: `RemixLayer` supports only `gain_db`,
`key_shift_semitones`, `source_start_bar`. Add optional per-layer tone shaping
(`lowpass_hz` and/or a `brightness_db` tilt) plus a documented
adjective→parameter map for the NL endpoint's system prompt (`dark` → lowpass
+ reduced highs; `punchier` → drums +3 dB, …).

### B5. Job tracking on build/enhance

`/build` and `/enhance` are synchronous (`asyncio.to_thread` awaited inline —
enhance is "deliberately not backgrounded", ~60 s). No job IDs, no progress,
no cancellation. Only `/tempo/refresh` has the job-id + `/tempo/status`
pattern. Give `/build` and `/enhance` the same treatment: return `{job_id}`
immediately, `GET /api/audio/remix/jobs/{id}` → queued/running/done/failed +
progress + result manifest. This also fixes A8 (frontend long-op UX) — one
fix serves both.

### B6. Accept either track key

Sources are keyed by bare stem-directory names (`SunoV6Mini-Ad-Nauseam`) while
the library reports paths; the frontend needs a `matchSource` normalizer with
fixture guards because naive matching once built mashups from a 10-second
demucs test fixture. Return the resolved library filename alongside the stem
key in `/sources` wherever the join is unambiguous, and accept either key on
all remix endpoints.

### B7. Structured warnings

`preview_recipe` warnings are free-text strings an agent must parse. Return
them as `{code, layer_ref, field, suggestion}` — e.g.
`{code: "near_silent", layer: 2, field: "source_start_bar", suggestion:
"first_audible_sec is 7.06; try source_start_bar ≥ 4"}`. The probe data to
generate these already exists.

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
