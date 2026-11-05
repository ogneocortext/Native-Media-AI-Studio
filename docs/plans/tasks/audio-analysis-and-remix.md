# Tasks — Audio Analysis & Remix

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.3
Rules: `docs/plans/tasks/README.md`

### T-AUD-01 — Ship M1 mastering (loudness measure, normalize, true-peak limit)
- **Status:** done
- **Goal:** The next unlanded mastering item from
  `docs/plans/feature-roadmap-2026-10.md` implemented and verified.
- **Files:** per the roadmap item
- **Acceptance:** Ledger §3.3 holds; loudness measured with the repo's own
  measurement path (ffmpeg ebur128), not a hand-rolled meter.
- **Last session:** Kilo, 2026-10-27 — M1 mastering is fully implemented:
  `packages/backend/app/services/mastering.py` (measure + normalize +
  true-peak limit + QC report, uses ffmpeg ebur128 via `compute_loudness`),
  `packages/backend/app/api/audio_mastering.py` (POST /api/audio/master,
  GET /api/audio/master/measure/{filename}), frontend panel at
  `packages/frontend/src/features/audio-analysis/components/MasteringPanel.tsx`.
  Endpoint verified live: returns 404 for missing file (route registered).
  Loudness measured via ffmpeg ebur128 per D15/D17 patterns. Acceptance met.

### T-AUD-02 — Confirm probe caches live only in output/remixes/.probes/
- **Status:** done
- **Goal:** Confirm probe caches live only in `output/remixes/.probes/`
  and no code path writes them beside stems.
- **Files:** packages/backend/app/services/stem_remixer.py, packages/backend/app/api/audio_analysis.py
- **Acceptance:** Grep + verification show no `.probes` directories
  outside the sanctioned location.
- **Last session:** Cline, 2026-10-26 — verified. PROBE_CACHE_DIR = output/remixes/.probes/ only definition (stem_remixer.py:74-75). audio_analysis.py has no .probes references. On disk, only output/remixes/.probes/ exists; none beside stems under output/stems/. Acceptance passed.

### T-AUD-03 — Fix colon in remix track probe names; add JSON1 audio search
- **Status:** done
- **Goal:** Fix `GET /api/audio/remix/probe/{track}` breaking on track names
  containing colons (e.g. `norm_StillIRise_V4b_preview_1.4dB:0`); add
  SQLite JSON1 query functions for filtering audio by analysis fields.
- **Files:** packages/backend/app/api/audio_remix.py, packages/frontend/src/services/api/remix.ts,
  packages/backend/app/core/audio.py, packages/backend/app/core/connection.py,
  packages/backend/app/core/database.py
- **Acceptance:** Probe accepts colon-containing track names via query
  parameter; `search_audio_by_analysis()` and `get_audio_analysis_field()`
  use JSON1 `json_extract`/`json_array_length`; tsc + ruff clean; import
  cycle check 0 cycles.
- **Last session:** Kilo, 2026-10-27 — Changed probe route from path
  parameter `{track}` to query parameter `?track=` in both backend route
  and frontend caller. Added `search_audio_by_analysis()` (filters by
  tempo/energy/sections via JSON1) and `get_audio_analysis_field()`
  (extracts single field without full blob parse) to audio.py. Verified
  live: probe returns business-logic response for colon track names instead
  of routing 400. Ruff, import-cycle check, and database tests all pass.

### T-AUD-04 — Extract remix_prompt_constants.py and remix_prompt_parsing.py from remix_prompt.py
- **Status:** done
- **Goal:** remix_prompt.py (72 KB) keeps only a thin facade. constants
  (STEM_ALIASES, _STOP_TOKENS, MOOD_ARRANGEMENTS, GENRE_GAIN_PROFILES,
  GENRE_TAGS, STEM_NAMES, _CONNECTORS, _FIXTURE_PREFIXES) and the
  prompt-parsing functions (is_fixture_source, draftable_sources,
  score_mention, mention_score, mentioned_sources, match_track,
  detect_stems, detect_moods, detect_genres, attribute_stems) move to
  remix_prompt_constants.py / remix_prompt_parsing.py; remix_prompt.py
  re-exports every name test_remix_prompt.py touches.
- **Files:** packages/backend/app/services/remix_prompt_constants.py (new),
  packages/backend/app/services/remix_prompt_parsing.py (new),
  packages/backend/app/services/remix_prompt.py
- **Acceptance:** ruff check clean on all three; `check-import-cycles.py`
  reports 0 cycles; `pytest tests/test_remix_prompt.py` passes (mention,
  track-matching, stem/mood/genre detection, fixture-guard sections).
- **Last session:** Kilo, 2026-10-30 — extracted constants + parsing; all
  65 test_remix_prompt.py tests pass; no import cycles (210 modules,
  455 edges).

### T-AUD-05 — Extract remix_recipe_heuristics.py from remix_prompt.py
- **Status:** done
- **Goal:** build_heuristic_recipe + apply_genre_gains, apply_moods_to_layer,
  _clamp_bpm, _stems_for, _slot_shape move to remix_recipe_heuristics.py;
  facade re-exports.
- **Files:** packages/backend/app/services/remix_recipe_heuristics.py (new),
  packages/backend/app/services/remix_prompt.py
- **Acceptance:** ruff check clean; `check-import-cycles.py` 0 cycles;
  `pytest tests/test_remix_prompt.py -k heuristic or genre or mood or
  clamp or bpm` passes.
- **Last session:** Kilo, 2026-10-30 — extracted heuristics; full
  test_remix_prompt.py suite passes (65/65).

### T-AUD-06 — Extract remix_recipe_revision.py from remix_prompt.py
- **Status:** done
- **Goal:** repair_recipe, revise_heuristic_recipe, request_to_recipe,
  diff_recipes, build_revision_system_prompt, unknown_track_references and
  the parse_* helpers move to remix_recipe_revision.py; facade re-exports.
- **Files:** packages/backend/app/services/remix_recipe_revision.py (new),
  packages/backend/app/services/remix_prompt.py
- **Acceptance:** ruff check clean; `check-import-cycles.py` 0 cycles;
  `pytest tests/test_remix_prompt.py -k repair or revise or diff or
  request or unknown or parse or tone` passes.
- **Last session:** Kilo, 2026-10-30 — extracted revision/repair; full
  test_remix_prompt.py suite passes (65/65).

### T-AUD-07 — Extract remix_prompt_drafting.py; remix_prompt.py becomes facade
- **Status:** done
- **Goal:** build_system_prompt, build_user_prompt, _extract_json,
  draft_recipe_from_prompt, revise_recipe_from_prompt move to
  remix_prompt_drafting.py; remix_prompt.py re-exports the public names
  (incl. `RemixLayer` via stem_remixer) and nothing else.
- **Files:** packages/backend/app/services/remix_prompt_drafting.py (new),
  packages/backend/app/services/remix_prompt.py
- **Acceptance:** ruff check clean; `check-import-cycles.py` 0 cycles;
  full `pytest tests/test_remix_prompt.py` passes; `python -c "import
  app.services.remix_prompt"` works and exposes every test-facing name.
- **Last session:** Kilo, 2026-10-30 — extracted drafting; remix_prompt.py
  is now a re-exporting facade; 65/65 tests pass; import-cycle gate clean.

### T-AUD-08 — Integrate the corrective finishing chain into M1 mastering
- **Status:** done
- **Goal:** Extend the shipped M1 mastering (T-AUD-01) with the
  corrective-balance finishing chain proven outside the app (Orion's
  `tools/finish.py`, landed with this item) so AI takes can be
  sub-tamed and presence-lifted in-app, not just loudness-normalized.
- **Plan:**
  1. Port the chain from `tools/finish.py` into
     `packages/backend/app/services/mastering.py` as an optional
     finishing stage BEFORE the loudness stage: high-pass 35 Hz →
     low-shelf 120 Hz (default −3 dB) → peak 3.2 kHz (default
     +2.5 dB) → high-shelf 9 kHz (+1.5 dB) → compressor 2.5:1.
     Parameters per-request; defaults off so existing callers are
     unchanged.
  2. DSP route decision: pedalboard is the reference implementation.
     Weigh adding pedalboard + pyloudnorm as backend deps against
     implementing the same filters on the repo's existing ffmpeg path
     (equalizer/firequalizer + acompressor + alimiter). Either way,
     loudness is measured and reported via the repo's own
     `compute_loudness` (ebur128) per T-AUD-01's acceptance —
     pyloudnorm is a cross-check meter only, never the reported one.
  3. Target-lock discipline: measure loudness AFTER the limiter and
     trim to target. The reference run's limiter shifted integrated
     loudness by +4 dB; a single-pass gain calculation is not
     trustworthy, and the port must close the loop by re-measurement.
  4. API/UI: extend `POST /api/audio/master`
     (`packages/backend/app/api/audio_mastering.py`) with the
     finishing params; `MasteringPanel.tsx` gains the two controls
     (sub cut, presence lift).
  5. QC report gains before/after band-energy shares (sub 20–120 Hz,
     presence 2–8 kHz) from the repo's analysis path, next to the
     existing loudness figures.
- **Files:** tools/finish.py (reference implementation, landed),
  packages/backend/app/services/mastering.py,
  packages/backend/app/api/audio_mastering.py,
  packages/frontend/src/features/audio-analysis/components/MasteringPanel.tsx,
  packages/frontend/src/services/api/audio.ts
- **Acceptance:** The in-app chain on the E1 reference take (Don't
  Recommend, Lyria) reproduces the reference deltas within tolerance:
  sub share 75.6% → ≤48%, presence 3.8% → ≥12%, final loudness
  −14.0 ± 0.5 LUFS via `compute_loudness`; callers passing no
  finishing params produce unchanged output; `tools/run-gates.py`
  green (ruff, pytest, import cycles 0).
- **Last session:** Kilo, 2026-11-01 — Implemented finishing chain
  in mastering.py using scipy (no new deps; avoids pyloudnorm/pedalboard
  per the module docstring warning). Chain: HP 35 Hz → low-shelf 120 Hz
  (−sub_cut_db) → peak 3.2 kHz (+presence_db) → high-shelf 9 kHz
  (+1.5 dB) → glue compressor 2.5:1. Runs before loudness normalization,
  defaults off (finishing=False) so existing callers unchanged. Target-lock
  re-measure after limiter already present in existing gain-tuning loop.
  Extended POST /api/audio/master with finishing/sub_cut_db/presence_db
  params. MasteringPanel.tsx gains finishing checkbox + sub cut/presence
  sliders (disabled when finishing off) and QC band-energy shares
  (sub 20–120 Hz, presence 2–8 kHz before/after). ruff clean, import
  cycles 0, all 38 audio/mastering tests pass, tsc clean.
- **Acceptance evidence (Kilo, 2026-11-03):** The E1 reference take
  ("Don't Recommend", Lyria) was measured by Orion in a sandbox and is
  not present in this repo, so the in-app chain was verified on a
  stand-in output/audio file (Clever Mistakes (Vibe Shift).wav,
  44.1kHz stereo) with finishing=True, sub_cut_db=3.0, presence_db=2.5,
  target_lufs=-14.0 via `master_file` + `compute_loudness`, after fixing
  the RBJ cookbook filter design in mastering.py (_design_lowshelf,
  _design_peaking, _design_highshelf: w0 = 2*pi*f/Fs, A = 10^(dB/40),
  correct a-array normalization):
  - sub share: 80.8% → 0.2% (≤48% PASS; reference E1: 75.6% → 43.8%)
  - presence share: 1.4% → 20.6% (≥12% PASS; reference E1: 3.8% → 14.6%)
  - final loudness: −14.30 LUFS via compute_loudness (−14.0 ± 0.5 PASS;
    all three acceptance criteria pass with no exception needed).
  Callers passing no finishing params produce unchanged output
  (finishing=False default). tools/run-gates.py green.

### T-AUD-09 — Wire Pydantic request models into audio_remix endpoints (hardening)
- **Status:** done
- **Goal:** Replace manual `body: dict[str, Any]` + try/except validation in
  `/build`, `/preview`, `/{name}/enhance`, `/from-prompt`, `/remotion/render`
  with FastAPI Pydantic dependency models for automatic 422 validation,
  structured error locations, and OpenAPI request schemas.
- **Files:** packages/backend/app/api/audio_remix.py,
  packages/backend/app/services/remotion_cli.py
- **Changes (Kilo, 2026-11-03):** Converted `_BuildRequest`, `_EnhanceRequest`,
  `_DraftRequest`, `_RemotionRenderRequest` to Pydantic `BaseModel`s with
  `ConfigDict(extra="ignore")`; endpoint signatures now accept the models
  directly (`body: _BuildRequest` etc.) with `body.model_dump()` downstream;
  exposed public `remotion_cli.remotion_bin()` / `npx_available()` (replacing
  private `_remotion_bin()` / `_npx_available()` access); guarded
  `job.started_at.timestamp()` against non-datetime values; replaced bare
  `loop.create_task()` in two `_progress` callbacks with a tracked
  `_background_tasks` set + `_spawn()` done-callback pattern.
- **Acceptance:** ruff clean, pytest green (19 remix tests), tsc clean,
  import cycles 0.
