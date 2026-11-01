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

### T-PLT-05 — Improve agent source-file discovery
- **Status:** done
- **Goal:** Give agents a reliable route from task descriptions to current implementation and test files, and prevent docs search or the legacy codebase map from being mistaken for source search.
- **Files:** docs/agent-code-navigation.md, docs/README.md, AGENTS.md
- **Acceptance:** Bootstrap points to the discovery route; it explains docs search scope, validates paths against the tree, and demonstrates source searches across frontend/backend ownership boundaries.
- **Last session:** GPT-6, 2026-11-01 — Simulated discovery for audio selector ownership, remix probe routing, and visualizer rendering. Found that docs search only covers `docs/` and codebase.json contains stale paths; added the current source-discovery guide and bootstrap links. Confirmed examples against tracked source paths with `rg`.

### T-PLT-06 — Make parallel discovery handoffs evidence-based
- **Status:** done
- **Goal:** Let a lead agent delegate bounded file-discovery questions and combine findings without duplicate searches or unverified path guesses.
- **Files:** docs/agent-code-navigation.md, docs/plans/tasks/platform-and-workflow.md, docs/plans/focus-areas-and-behavior-ledgers-2026-10.md
- **Plan:** Add a concise parallel-discovery protocol and copyable handoff fields; specify bounded independent questions, source evidence, candidate owners/tests, ruled-out paths, and a clear stop condition. Update the platform ledger after checking the guide against representative source paths.
- **Acceptance:** An agent can hand a subagent a non-overlapping discovery question and receive a result with path/symbol evidence, consumers, nearest tests, confidence/unknowns, and no implementation edits.
- **Last session:** GPT-6, 2026-11-01 — Added bounded, read-only discovery delegation and a copyable evidence handoff. Confirmed sample owners and nearby tests; the remix route trace has service/cache tests but no direct route test found.

### T-PLT-07 — Correct package and tools README navigation
- **Status:** done
- **Goal:** Ensure the staged package/tool READMEs identify real package locations, current setup commands, active integrations, and existing test files.
- **Files:** packages/README.md, tools/README.md, tools/mcp/README.md, AGENTS.md, tools/agent-contribution-report.py, docs/plans/tasks/platform-and-workflow.md, docs/plans/focus-areas-and-behavior-ledgers-2026-10.md
- **Plan:** Check each README claim against the live tree, workspace manifests, decision log, routes, and hook scripts. Correct stale paths, unsupported schema ownership, outdated Remotion MCP and install guidance, missing bridge coverage, and test references. Register the GPT-6 trailer in the attribution table and normalizer because earlier local navigation commits are in the push range. Run the docs gate and attribution check; stage intended files and commit before pushing.
- **Acceptance:** All mentioned paths exist or are explicitly described as absent/local; install and integration guidance matches the current workspace/configuration; test references point to existing files; docs gate and attribution check pass.
- **Last session:** GPT-6, 2026-11-01 — Corrected root `shared/` location and endpoint-specific Pydantic model ownership; repaired relative paths and Windows workspace commands; removed obsolete Remotion MCP setup and generated-file lists absent from this checkout; fixed smoke-test paths/fixture caveats and documented actual hooks. Registered the GPT-6 trailer because two prior local commits are included in this push range. Docs gate passed.
