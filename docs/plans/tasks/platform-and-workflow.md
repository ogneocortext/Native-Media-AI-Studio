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

### T-PLT-08 — Adopt programmatic batch execution as a harness convention
- **Status:** todo
- **Goal:** Executors default to one scripted pass for mechanical
  batch work — summary into context, raw output to disk — and a pilot
  script prints the cross-area task ledger in a single run.
- **Plan:** Patterns and evidence: `docs/knowledge-library/programmatic-tool-calling-2026.md`
  (owner decision 2026-11-01: take Factory Droid 1.0's patterns, not
  the product). Steps: (1) Add a "Batched execution" section to
  `docs/plans/tasks/README.md` stating the three rules — script the
  batch (one Python script per batch job, keepers under `tools/`,
  one-offs outside the repo); summary in / raw out (default output is
  a compact summary, full logs to `output/` or `docs/scratch/` with
  the path named in the summary); stable prefix (AGENTS.md, task
  files, roster are amended in place or appended to, never reshuffled
  as a side effect of task work). (2) Build the pilot,
  `tools/task-ledger-summary.py`: parse every task block in
  `docs/plans/tasks/*.md` (excluding `template.md` and `README.md`),
  print per-area counts by status plus the open items (todo / doing /
  blocked) with IDs and titles; a `--json` flag emits the full parse
  instead of the summary. Python, stdlib only, all file reads with
  explicit `encoding="utf-8"` (see the subprocess-encoding rule in
  AGENTS.md). (3) Verify the printed totals against a hand count of
  the nine task files and record both numbers in Last session.
- **Files:** docs/plans/tasks/README.md, tools/task-ledger-summary.py,
  docs/plans/tasks/platform-and-workflow.md
- **Acceptance:** The task-file rules carry the batched-execution
  section; `python tools/task-ledger-summary.py` prints per-area and
  total counts matching a hand count of the nine task files; the
  script's default output is a summary, not file dumps.
- **Last session:** Orion, 2026-11-01 — Item created with the
  knowledge doc; not started.

- **Session packet (2026-11-01, Orion → executor; tuned for
  Nemotron 3.5 Super VL via Kilo):**

  > You are executing task T-PLT-08 in the Native Media AI Studio
  > repo. Work only on this item. Repo state you should find after
  > pulling: main at or past 686d8c1; T-PLT-08 is `todo` in this
  > file; `tools/task-ledger-summary.py` does not exist yet;
  > `docs/plans/tasks/README.md` has no "Batched execution"
  > section. If any of that does not match, stop and report the
  > mismatch instead of improvising.
  >
  > Environment: Windows, PowerShell 7 (`pwsh`) for shell
  > commands — `bash` here is the WSL launcher, do not use it for
  > project commands. Write helper code in Python, not PowerShell.
  > Never restart a service that is already running.
  > Before step 2, set this item's Status to `doing` (repo
  > convention); step 6 sets it to `done`.
  >
  > Steps:
  > 1. Pull origin/main. Read this item in full, the Plan's source
  >    doc `docs/knowledge-library/programmatic-tool-calling-2026.md`
  >    ("What this project adopts" section), and
  >    `docs/plans/tasks/README.md` end to end.
  >    Done when: you can state the three batching rules from the
  >    doc without re-reading them.
  > 2. Add a `## Batched execution` section to
  >    `docs/plans/tasks/README.md`, immediately after the
  >    `## The four rules` section, stating the three rules exactly
  >    as the Plan above words them (script the batch; summary in /
  >    raw out; stable prefix), in the README's existing voice.
  >    Done when: the section exists, no other README section was
  >    reordered or reworded.
  > 3. Write `tools/task-ledger-summary.py` per the Plan: Python,
  >    stdlib only, every file read with explicit
  >    `encoding="utf-8"`. It parses every task block in
  >    `docs/plans/tasks/*.md` except `template.md` and
  >    `README.md` (an item starts at a `### T-…` heading; its
  >    status is the `- **Status:**` line). Default output:
  >    per-file counts by status, then the open items (todo /
  >    doing / blocked) with IDs and titles. `--json` emits the
  >    full parse instead.
  >    Done when: `python tools/task-ledger-summary.py` exits 0
  >    and prints all nine task files.
  > 4. Verify: hand-count one file (this one,
  >    `platform-and-workflow.md`) from the raw text and compare
  >    against the script's line for it; then hand-count the grand
  >    totals across all nine files and compare. Record both
  >    hand counts and the script's numbers — they must match
  >    exactly; if they do not, fix the parser, not the counts.
  > 5. Run the gates: `python tools/run-gates.py`. All checks must
  >    pass; fix what your changes broke, report anything that was
  >    already failing before your changes (check against a clean
  >    checkout state before claiming it pre-existing).
  > 6. Update this item: Status → done, and a Last session entry
  >    with your agent name, the date, what landed, and the step-4
  >    numbers. Do not edit any other task item.
  > 7. Commit everything for this item in one commit, subject
  >    style `### <Type> - <description>`, with the
  >    `Co-authored-by:` trailer for the agent configuration
  >    actually used, per the attribution table in the repo
  >    AGENTS.md. Push with your normal git route.
  >
  > Report back, in this shape: commit hash; gate result (pass /
  > which checks failed); the script's printed totals and your
  > hand counts side by side; anything you found that contradicts
  > this packet.

### T-PLT-09 — Evaluate CoplayDev/unity-mcp against the in-repo Unity bridge
- **Status:** todo
- **Goal:** A recorded verdict — adopt, replace, or keep — for the
  Unity editor bridge, based on a fixed task battery run through
  both bridges.
- **Plan:** Evidence: `docs/knowledge-library/3d-viz-code-harnesses-2026.md`
  Lane B. Steps: (1) Inventory the in-repo bridge under `tools/mcp/`:
  tool list, current state, why it ships disabled. (2) Install
  CoplayDev/unity-mcp pinned at v10.3.0 into the `unity-visualizer/`
  project per its README; configure Kilo as the MCP client.
  (3) Run the same battery through both bridges: create a scene;
  add three primitives and a material; add a light and move the
  camera; create and edit a C# script (Roslyn validation on the
  CoplayDev side); capture a frame through the existing AutoCapture
  path; run a five-command sequence (CoplayDev `batch_execute` vs
  individual calls on the in-repo bridge). Record success/failure
  and wall time per task in a results table in the knowledge doc.
  (4) Write the verdict into the knowledge doc's Lane B section; if
  the verdict is replace, open a decision-log entry. Do not delete
  the in-repo bridge in this item.
- **Files:** tools/mcp/ (inventory only), unity-visualizer/,
  docs/knowledge-library/3d-viz-code-harnesses-2026.md,
  docs/architecture/decision-log.md (only if verdict is replace)
- **Acceptance:** The results table covers every battery task for
  both bridges with timings; the verdict is recorded in the
  knowledge doc; no in-repo code removed.
- **Last session:** Orion, 2026-11-01 — Item created with the
  knowledge doc; not started.
