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
