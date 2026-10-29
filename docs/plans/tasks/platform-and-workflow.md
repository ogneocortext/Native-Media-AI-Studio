# Tasks — Platform & Workflow

Area map + behavior ledger: `docs/plans/focus-areas-and-behavior-ledgers-2026-10.md` §3.9
Rules: `docs/plans/tasks/README.md`

### T-PLT-01 — Adopt the task-file system for session state
- **Status:** done
- **Goal:** `docs/plans/tasks/` exists with template, per-area files,
  and the AGENTS.md bootstrap pointer.
- **Files:** docs/plans/tasks/, AGENTS.md
- **Acceptance:** Files on main; AGENTS.md points every session at them.
- **Last session:** Orion, 2026-10-25 — system created and seeded from
  the focus map's Next Moves.

### T-PLT-02 — Install git hooks on the Windows clone (trailer / move / orphan guards)
- **Status:** blocked
- **Goal:** `bash scripts/install-git-hooks.sh` run once on the owner's
  Windows clone so trailer/move/orphan guards are live at commit time.
- **Files:** scripts/install-git-hooks.sh
- **Acceptance:** A test commit without a trailer is rejected by the
  commit-msg hook.
- **Last session:** Blocked on owner (one local run; pending since
  2026-09).

### T-PLT-03 — Spot-check focus-map freshness against the tree
- **Status:** done
- **Goal:** Monthly: compare each area's State entry against the tree;
  fix drift in the same session.
- **Files:** docs/plans/focus-areas-and-behavior-ledgers-2026-10.md
- **Acceptance:** Every area entry either confirmed current or updated
  with a dated note.
- **Last session:** Kilo, 2026-10-27 — Spot-check complete. Drift found
  and fixed in 7 of 9 areas:
  - 3.1 Library & Org: search/tag filter + vision polish done (T-LIB-01/02)
  - 3.2 Music Gen: ACE-Step agent-drive A1–A4 complete (T-MUS-01–03)
  - 3.4 Visualizer: Canvas2DVisualizer.tsx fully decomposed (T-VIZ-04–09)
  - 3.5 Video: intro recipe schema done (T-VID-01), S1 spec done (T-VID-03)
  - 3.6 Local Models: atomic_chat_enabled set to true (T-MOD-02), A/B done (T-MOD-01)
  - 3.7 Agent: LLM loop spec + skeleton implemented (T-AGT-01/02)
  - 3.8 Integrations: nav reorganized by job (T-INT-01/02)
  Areas 3.3 (Audio/Remix) and 3.9 (Platform) confirmed current — no drift.
  All entries updated with 2026-10-27 dates and status notes.

### T-PLT-04 — Make studio.db relocatable with bounded WAL/cache growth
- **Status:** done
- **Goal:** Make `studio.db` relocatable, bound WAL/cache/mmap growth,
  checkpoint WAL on shutdown, add JSON1 query functions for analysis results.
- **Files:** packages/backend/app/core/connection.py, packages/backend/app/core/database.py,
  packages/backend/app/main.py, packages/backend/tests/test_database_connections.py
- **Acceptance:** `NMA_DB_PATH` env var overrides default path; every
  connection gets temp_store/ cache_size/mmap_size/journal_size_limit;
  `checkpoint_wal()` + `close_pooled_connections()` run on shutdown;
  `search_audio_by_analysis()` and `get_audio_analysis_field()` use JSON1;
  import cycle check 0 cycles; database tests pass.
- **Last session:** Kilo, 2026-10-27 — Rewrote connection.py with configurable
  DB_PATH (env var), performance PRAGMAs, checkpoint_wal(), close_pooled_connections().
  Added WAL checkpoint + connection close to shutdown in main.py. Added
  search_audio_by_analysis() and get_audio_analysis_field() to audio.py using
  SQLite JSON1. Eliminated circular import between connection.py and database.py.
  Verified: ruff clean, import-cycle check 0 cycles, database tests pass.
