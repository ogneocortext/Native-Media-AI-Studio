# Tasks — Audio Analysis & Remix

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.3
Rules: `docs/plans/tasks/README.md`

### T-AUD-01 — Mastering follow-through (roadmap M-series)
- **Status:** todo
- **Goal:** The next unlanded mastering item from
  `docs/plans/feature-roadmap-2026-10.md` implemented and verified.
- **Files:** per the roadmap item
- **Acceptance:** Ledger §3.3 holds; loudness measured with the repo's own
  measurement path (ffmpeg ebur128), not a hand-rolled meter.
- **Last session:** —

### T-AUD-02 — Probe-cache hygiene check
- **Status:** todo
- **Goal:** Confirm probe caches live only in `output/remixes/.probes/`
  and no code path writes them beside stems.
- **Files:** packages/backend/app/services/stem_remixer.py, packages/backend/app/api/audio_analysis.py
- **Acceptance:** Grep + one live remix build show no `.probes` directories
  outside the sanctioned location.
- **Last session:** —
