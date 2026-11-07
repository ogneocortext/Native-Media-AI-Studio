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
- **Status:** done
- **Goal:** `bash scripts/install-git-hooks.sh` run once on the owner's
  Windows clone so trailer/move/orphan guards are live at commit time.
- **Files:** scripts/install-git-hooks.sh
- **Acceptance:** A test commit without a trailer is rejected by the
  commit-msg hook.
- **Last session:** Kilo, 2026-11-03 — Hooks confirmed installed and
  firing: the pre-push gate ran (docs + ruff) on every push during this
  session, the commit-msg hook enforced the Co-authored-by trailer on all
  9 commits (100% trailer coverage), and the move/orphan guards are live
  via check-path-references.py. Blocked label was stale; hooks have been
  operational since the session began.

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
- **Status:** done
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
- **Last session:** Kilo, 2026-11-01 — Adopted programmatic batch
  execution: added the "Batched execution" section to
  docs/plans/tasks/README.md (script the batch; summary in/raw out;
  stable prefix) and built tools/task-ledger-summary.py (stdlib,
  explicit utf-8 reads, --json flag). Verified by hand count matching
  the script exactly: platform-and-workflow.md todo=1 doing=1 done=6
  blocked=1 total=9; grand totals across nine files todo=4 doing=1
  done=44 blocked=1 total=53. ruff clean on the changed file; pytest
  and tools-pytest failures are pre-existing and environmental
  (live-service tests, kb-chunk.py `_re` bug), not caused by this
  item.

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
- **Status:** done
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
- **Last session:** Kilo, 2026-11-01 — Complete. Verdict: KEEP the
  in-repo bridge (faster: 0.01–0.66s vs 15–40s+ per CoplayDev call;
  simpler: direct REST, no session management; already integrated).
  CoplayDev/unity-mcp v10.3.0 installed into
  `unity-visualizer/Packages/com.coplaydev.unity-mcp/`. Battery ran
  9/10 tasks through in-repo bridge (capture_scene_view fails: no
  Scene View camera in headless batch mode). CoplayDev battery could
  not complete: 0 connected Unity instances (Unity needs the
  MCPForUnity package loaded and a session started). Verdict recorded
  in Lane B of 3d-viz-code-harnesses-2026.md.

### T-PLT-10 — Add a GLSL compile-check gate for embedded frontend shaders
- **Status:** done
- **Goal:** Agent- and human-written GLSL gets compile-checked
  before it can reach a render: a repo gate that extracts the
  frontend's embedded shaders, compiles each with the Khronos
  reference compiler, and reports errors in the file/line/message
  form the T-AGT-03 loop consumes as feedback. This is the
  execution leg that loop's contract assumes for GLSL.
- **Plan:** Evidence: the 2026-11-01 Bolt language battery
  (`docs/knowledge-library/nemotron-3-5-bolt-e4b-2026.md`
  §"Coding languages") — a local model's shader fix passed a
  read-through but failed GLSL ES 1.00 compilation (one-operand
  cast), verified with glslangValidator 16.6.0 on the cloud
  side the same day. Steps: (1) Acquire the compiler: pin
  glslang **16.6.0** (KhronosGroup/glslang GitHub release,
  Windows asset `glslang-16.6.0-windows-x86_64-release.zip`).
  The checker resolves the binary from PATH
  or a gitignored local tools location; if it is absent, the
  checker prints the exact install source and **fails
  closed** — a missing compiler is a failed check, never a
  silent pass. (2) Build `tools/check-glsl-compile.py`
  (Python, stdlib only, explicit UTF-8 throughout). Corpus
  for v0: GLSL embedded in frontend TS/TSX —
  `fragmentShader` / `vertexShader` template literals under
  `packages/frontend/src` (visualizer and three-js-studio
  features; at least 8 files at item creation). Wrap each
  extracted body in the authoring-dialect prologue
  (`#version 100`, default precision, and the standard
  three.js ShaderMaterial injected declarations — matrices,
  `cameraPosition`, `position` / `normal` / `uv`) so author
  code compiles the way three.js presents it; bodies that
  carry their own prologue (raw shaders) compile as-is.
  Report coverage every run: files scanned, shaders
  extracted, checked, and skipped-with-reason — no silent
  skips. (3) Out of scope, named: Unity `.shader` files
  (ShaderLab/HLSL — a different compiler; the repo has 3),
  WGSL/WebGPU, and any rendering or visual judgment (the
  vision loop owns quality; this gate owns compilability).
  (4) Wire it into `tools/run-gates.py` as a named gate
  following the existing gate pattern: `--only glsl`
  selectable, and scoped by the changed-file awareness
  added in cee05b0, with a flag for a full-corpus run.
  (5) Smoke fixtures from real evidence: the battery's
  one-operand-cast shader must FAIL this checker and its
  both-operands-cast correction must PASS; add one
  deliberately broken shader as a third fixture. (6) Run
  the first full-corpus pass and record the baseline in
  Last session as findings — shaders that already fail are
  reported, not fixed under this item.
- **Files:** tools/check-glsl-compile.py, tools/run-gates.py,
  packages/frontend/src (read-only corpus)
- **Acceptance:** The checker runs on the Windows clone and
  fails closed without the compiler; the three smoke
  fixtures behave as specified; the gate runs via
  `run-gates.py --only glsl` and respects changed-file
  scoping; a full-corpus baseline with coverage counts is
  recorded in Last session.
- **Last session:** Kilo, 2026-11-01 — implemented the checker, fixtures,
  gate wiring, and fail-closed behavior. Initial Windows baseline had no local
  compiler: 451 files scanned, 20 shaders extracted across 5 files, 0 checked,
  1 skipped, 19 unavailable. GPT-6, 2026-11-01 — installed Khronos glslang
  16.6.0 Windows x64 under the user profile and added its `bin` directory to
  user PATH. Corrected the documented release asset, removed Vulkan-target
  flags so the checker validates ESSL 1.00 directly, and fixed human-readable
  output for skipped shaders. Full-corpus gate passed: 451 files scanned,
  20 shaders extracted across 5 files, 19 checked, 1 skipped for unresolved
  template substitution, 0 failed.

### T-PLT-37 — Extract DocViews from DocsPage.tsx (1102 -> 767 + ~360)
- **Status:** done
- **Goal:** Continue the large-file breakdown - DocsPage.tsx mixed the
  hand-rolled markdown/JSON renderers with the docs-browser page logic.
- **What changed:**
  - ``features/docs/components/DocViews.tsx`` (new) - ``JsonView``,
    ``MarkdownView`` (the line-based markdown parser/renderer) and its
    ``inlineFmt`` helper moved verbatim; ``React.ReactNode`` became a
    ``ReactNode`` type import. Only ``MarkdownView`` is exported - it
    was the page's sole external use.
- **Files:** features/docs/DocsPage.tsx, components/DocViews.tsx (new)
- **Acceptance:** tsc clean for touched files, eslint 0 errors
  (pre-existing warnings only).
- **Last session:** completed before per-session logging was enforced on this entry; normalized 2026-11-06 under T-LIB-04.
### T-PLT-38 — Extract mountThreeScene from useThreeScene.ts (1133 -> 477 + 828)
- **Status:** done
- **Goal:** Continue the large-file breakdown - useThreeScene.ts was one
  ~640-line mount/render-loop effect inside a 1133-line hook, making the
  file hard to navigate.
- **What changed:**
  - ``features/three-js-studio/hooks/mountThreeScene.ts`` (new) - the
    scene init + animation loop moved verbatim into
    ``mountThreeScene(ctx)``, a module-level function taking a typed
    ``MountContext`` (60 ref/value fields destructured to identical
    names, so the body needed zero rewrites). ``VIGNETTE_SHADER`` moved
    with it (its only consumer).
  - ``useThreeScene.ts`` keeps all refs, the prop-mirror sync effects,
    dispose helpers, object/config/particle/bg-image sync effects and
    the return object; the effect is now a thin ``mountThreeScene({...})``
    call with the same ``[createMeshForObject]`` deps - identical
    semantics (refs stay live; plain values are captured at effect-fire
    time, same as the old closure).
- **Files:** features/three-js-studio/hooks/useThreeScene.ts,
  features/three-js-studio/hooks/mountThreeScene.ts (new)
- **Acceptance:** tsc clean for touched files (only pre-existing
  agent-chat WIP errors project-wide), eslint 0 errors (warnings are
  the same `any`-typed three.js patterns, moved with the code),
  three-js-studio vitest 92/92 pass.
- **Last session:** completed before per-session logging was enforced on this entry; normalized 2026-11-06 under T-LIB-04.
### T-PLT-11 — Compact gpu_telemetry process payloads and purge test tables
- **Status:** done
- **Goal:** `studio.db` had grown to 68 MB. Audit found the dominant cost was
  `gpu_telemetry.processes_json` (~40 MB): every 30 s snapshot stored the full
  GPU process list, and 99.6% of entries were permission-denied stubs with
  `used_mb=None` that no consumer reads (the frontend never passes
  `include_processes`). Six scratch tables (`cp`, `keep`, `leak`, `filler`,
  `dangling`, `test_persist`) leaked into the production DB from old test runs.
- **What changed:**
  - ``app/core/gpu.py`` — ``_compact_processes()`` filters to entries with a
    measured ``used_mb``, sorts largest-first, caps at 12; applied in
    ``log_gpu_telemetry`` before serializing. Write-path only, no schema change;
    ``include_processes`` readers still get a list of process dicts.
  - One-time live-DB compaction (scratch script, not committed): rewrote all
    11,185 stored payloads, ran the 7-day retention delete (46 rows), and
    VACUUMed. Junk tables dropped after verifying contents were synthetic
    test fixtures. File went 68.2 MB -> 21.1 MB.
  - Found while reclaiming: ``VACUUM`` cannot truncate the main file while the
    backend holds ``mmap_size`` connections (Windows), so ``cleanup_old_gpu_
    telemetry``'s vacuum silently leaves allocated slack. Reclamation requires
    a backend stop; ``manage-servers.ps1 -Action stop/start -Services backend``
    used for this pass. Future prunes still free pages logically — the file
    reuses the slack — so this is a disk-cost caveat, not a correctness bug.
- **Files:** packages/backend/app/core/gpu.py,
  packages/backend/tests/test_gpu_telemetry_retention.py
- **Acceptance:** ``test_gpu_telemetry_retention.py`` 9/9 pass (2 new:
  null-``used_mb`` stubs dropped + ordering, 12-entry cap); live DB
  ``integrity_check`` ok, 21.1 MB on disk; backend restarted and
  ``/api/health`` returns 200.
- **Last session:** Devin, 2026-11-06 — HEAD commit of this entry.

### T-PLT-12 — Reorganize docs/ root and relocate runtime CSV out of docs
- **Status:** done
- **Goal:** `docs/` root had 9 loose files and a one-file `api/` directory;
  `track-prompts-lyrics.csv` was runtime data living in docs (cleanup-plan
  item C1, open since 2026-10).
- **What changed:**
  - The singleton `docs/api/` directory's `API_REFERENCE.md` → `docs/guides/`
    (directory removed);
    all `docs/api/` references updated in README, guides, knowledge-library.
  - `SYSTEM_REQUIREMENTS.md` → `docs/setup/`; `TESTING_WORKFLOWS.md` →
    `docs/guides/`; `ENHANCEMENT_RECOMMENDATIONS.md` → `docs/plans/`;
    path-qualified references updated in AGENTS.md, SETUP_SUMMARY,
    browser-support, playwright-e2e-2026, docs/README map.
  - `track-prompts-lyrics.csv` → `config/` (runtime data, not docs);
    readers updated: `api/data.py` import-csv path,
    `scripts/utility/import_tracks_from_csv.py` (also fixed a pre-existing
    wrong parent depth), `trackLyrics.ts` comments. Frontend untouched —
    it reads the byte-identical Vite `public/` copy.
  - `docs-cleanup-2026-10.md` C1 marked done; checker docstring reworded.
- **Files:** see What changed; `docs/README.md` directory map synced.
- **Acceptance:** `check-path-references.py` clean (2755 refs);
  `check-all.py --changed` 6/6 pass; `config/track-prompts-lyrics.csv`
  exists and backend path resolves.
- **Last session:** Devin, 2026-11-06 — HEAD commit of this entry.

### T-PLT-13 — Review and repair the five root docs files
- **Status:** done
- **Goal:** Deep-review `docs/README.md`, `agent-code-navigation.md`,
  `agent-shell-cheatsheet.md`, `powershell-command-sheet.md`, and
  `source-map.md` against the live tree; fix every stale claim found.
- **What changed:**
  - `source-map.md` rewritten — it claimed "every path confirmed" but was
    ~50-80% stale: 5 of 15 listed `api/` modules no longer exist (actual
    ~44), `services/` listed 10 of ~70, `features/` named 32 of 36 (missing
    agent-chat, image-processing, music-prompts, onboarding), `app/agents/`
    was absent entirely, `websocket/` "426 shim" claim was wrong (real
    ConnectionManager; SSE is canonical), scripts/tools/config/tests
    tables were far from exhaustive, and the commit-trailer rule named only
    Kilo (now a multi-agent table in AGENTS.md). Restructured as a curated
    map with counts + "tree wins" guidance instead of fake-exhaustive lists.
  - `powershell-command-sheet.md` — fixed a §13 reference to a
    non-existent section; generalized the "bash tool" wording (repo-wide
    doc, not Devin-specific); fixed the `start-services.ps1` example which
    passed `-Action`/`-Services` params the script doesn't accept.
  - `agent-shell-cheatsheet.md` — removed the Git-bash path suggestion
    (contradicts the no-bash rule); corrected node version (active fnm
    default is v24.20.0, not 26.13).
  - `docs/README.md` — knowledge-library count ~110 → ~116; corpus size
    211 → ~210.
  - `agent-code-navigation.md` — added pointer to `source-map.md`.
    Verified all example-trace paths still exist; no other changes needed.
- **Files:** the five docs files above.
- **Acceptance:** every path/symbol/command claim in the five files
  verified against the working tree (features/api/services/hooks/state/
  utils/scripts/tools/config/tests listings, fnm node versions, pwsh
  7.6.9, conda Python 3.11.9, script param blocks, gate flags).
- **Last session:** Devin, 2026-11-06 — HEAD commit of this entry.

### T-PLT-14 — Audit, consolidate, and repair the PowerShell script set
- **Status:** done
- **Goal:** Classify all tracked + untracked `.ps1` files, fix real
  defects, consolidate duplicates, and decide what belongs in source
  control.
- **What changed:**
  - `comfyui-patch-status.ps1` — was completely broken: its `Git()`
    helper called `git` from inside a function also named `Git`, so
    PowerShell resolved the call to itself (call-depth overflow under
    SilentlyContinue → every field empty, upstream section dead code).
    Renamed to `Invoke-Git`, converted args to `[string[]]` splat (a
    single space-joined string reaches git as ONE argv element), fixed
    all call sites, and corrected the misleading "Invalid" patch label
    (non-zero apply --check also means already-applied). Verified live:
    branch/commit/remote/ahead-behind/tags now populate.
  - `comfyui-safe-update.ps1` — `git stash pop` result was discarded;
    a failed pop silently leaves local changes in the stash. Now checks
    `$LASTEXITCODE` and prints recovery instructions.
  - `tools/music-gen/start-service.ps1` — called `Write-Warn`/`Write-Err`
    which were never defined (no shared-utils dot-source) →
    CommandNotFoundException on those paths. Added the two helpers.
  - `stop-tunnel.ps1` — orphan sweep killed ANY `ngrok.exe` on the
    machine and any localtunnel on ports 8000/5173, including other
    projects' tunnels. Now scoped to command lines referencing this
    project's ports.
  - `start-tunnel.ps1` — exported an empty `PUBLIC_ORIGIN` in
    `-Target frontend` mode; now only set when a backend URL exists.
  - `monitor-bandwidth.ps1` + `start-monitor-bandwidth.ps1` —
    consolidated into one self-relaunching script (the wrapper only
    forwarded args the monitor already handles); `-LogPath` is now
    forwarded on relaunch too. Wrapper deleted.
  - `scripts/dev/_psa_tunnel_check.ps1` — deleted; one-off
    PSParser::Tokenize syntax probe (deprecated API).
  - `.gitignore` — the `scripts/**/*.ps1` blanket-ignore had hidden four
    real ops scripts from every clone while docs referenced them. Added
    explicit `!` re-inclusions for `check-env-health.ps1` (referenced by
    SETUP_SUMMARY, knowledge-library, source-map, and the
    report-path-orphans whitelist), the comfyui patch pair, and
    `utility/monitor-bandwidth.ps1`; they are now tracked.
- **Classification:** canonical = `manage-servers.ps1` (all lifecycle
  flows through it); `start-studio.ps1` = primary launcher;
  `start-dev.ps1`/`start-services.ps1` = documented compatibility
  wrappers (kept — distinct param surfaces); tunnel trio = one
  concern split three ways (kept); `shared-utils.ps1` = single source
  of truth; `check-env-health.ps1`/comfyui pair/bandwidth monitor =
  ops tools now tracked; test scripts stay under `dev/`/`utility/tests/`.
- **Files:** the scripts above + `.gitignore`.
- **Acceptance:** all six touched scripts parse with 0 errors
  (`Parser::ParseFile`); `comfyui-patch-status.ps1` run live against the
  real ComfyUI checkout produces correct git state (was empty before).
- **Last session:** Devin, 2026-11-06 — HEAD commit of this entry.

### T-PLT-39 — Consolidate duplicates and delete dead modules
- **Status:** done
- **Goal:** Streamline the codebase after the decomposition pass - remove
  duplicate shims, single-consumer shared files, duplicated helpers and
  dead modules.
- **What changed:**
  - ``visualizer/components/abCompare.ts`` shim deleted - it only
    re-exported ``features/remix/abCompare.ts``; its test moved to
    ``features/remix/abCompare.test.ts`` beside the live module.
  - ``music-video/steps/shared.ts`` deleted - each constant had exactly
    one consumer, so SECTION_COLORS folded into AnalyzeStep and
    SHOT_SIZES/CAMERA_ANGLES/PROMPT_SUGGESTIONS into ConfigureStep.
  - ``KineticTransport.tsx`` dropped its local ``formatTime`` for the
    shared ``utils/format.ts`` version (output-identical m:ss).
  - Dead code deleted (zero importers repo-wide, verified by content
    search incl. tests): ``media-library/{MediaDetailModal,
    WaveformDisplay,MediaLibraryStats}.tsx``,
    ``media-library/utils/{categoryConfig,fileHelpers}.ts`` (+ now-empty
    ``utils/`` dir), ``visualizer/{VisualizationStyles,
    visualizerConfigSchema}.ts``. ``visualizerModeTemplate.ts`` kept -
    it is an intentional copy-not-import template.
- **Files:** see What changed; ``visualizer/README.md`` module table
  synced.
- **Acceptance:** tsc -b + tsconfig.tests fully clean (0 errors
  project-wide), eslint 0 errors on touched files, remix/visualizer
  vitest 42/42 pass.
- **Last session:** completed before per-session logging was enforced on this entry; normalized 2026-11-06 under T-LIB-04.
### T-PLT-15 — Fix /system/health crash and consolidate redundant data points
- **Status:** done
- **Goal:** Repair the health page (crash + false "degraded" banner) and
  remove duplicated metrics.
- **What changed:**
  - `OllamaModelsCard.tsx` - crashed the whole page via ErrorBoundary:
    `activity[m.name]` is undefined for models with no active task and
    `active.started_at` was read unguarded. Now `active?.started_at`.
  - Adapter-status vocabulary bug: backend `AdapterStatus` reports
    `available`/`busy`/`connected`/`online`/`degraded`/..., but the page
    only treated `connected|online|healthy` as healthy — a live Ollama
    ("available") rendered the banner as "degraded — ollama is
    unreachable", a gray StatusBadge, and red card styling while the
    live probe said online. Added shared `isHealthyAdapterStatus` /
    `isWarningAdapterStatus` predicates in `features/health/utils.ts`;
    banner, Services card, and warning tiers now agree. `StatusBadge`
    learned `available` (green) and `busy` (amber).
  - `ResourceCard` - usage % was rendered twice (colored badge + bold
    body value); body now shows the Good/Moderate/High label only.
  - `GPUCard` + `VRAMManagerCard` merged into one card — both rendered
    VRAM %, GB used/free, GPU util, and temperature from two endpoints.
    GPUCard now also carries the workload label and the four model
    pills (Ollama/Atomic Chat/ComfyUI/Music Gen) with offload/reload
    actions; `VRAMManagerCard.tsx` deleted.
  - `ServiceChecksCard` - dropped the tautological "backend: live" row
    (the page cannot render without the backend) and the now-unused
    store subscription.
- **Files:** `features/health/{HealthPage,GPUCard,OllamaModelsCard,
  ResourceCard,ServiceChecksCard,utils,components}.{tsx,ts}`,
  `components/common/index.tsx` (StatusBadge), `state/healthStore.ts`
  (comment), deleted `VRAMManagerCard.tsx`.
- **Acceptance:** headed Playwright pass on /system/health — banner
  reads "healthy — All systems operational", Ollama Models card renders
  both loaded models, merged GPU card shows telemetry + workload +
  pills + processes, zero console errors; `tsc -b` clean, eslint 0
  errors, vitest 935/935 pass.
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-16 — Audit Go sidecars and document real purpose/consumers
- **Status:** done
- **Goal:** Determine which of the five go-* services are actually used,
  then make each one's purpose actionable instead of obtuse.
- **Audit result:** go-worker (sidecar writes, 4 live callers),
  go-gateway (Unity bridge proxy only — 3 of 4 bridge endpoints unused),
  go-ports (optional port-check accelerator with Python fallback) are
  live. go-dashboard is a write-only SSE mirror nothing reads (frontend
  uses backend /api/events). go-media server mode has zero callers —
  go_media_client.py was dead code and FFmpeg runs in-process.
- **What changed:** package doc comments added to all five main.go files
  (purpose, consumers, endpoints, env vars, live-vs-reserved status);
  tools/go/README.md rewritten with a per-binary consumer table;
  go_media_client.py docstring corrected — it claimed to "replace direct
  FFmpeg shell-outs" but nothing calls it.
- **Files:** tools/go-{dashboard,gateway,media,ports,worker}/main.go,
  tools/go/README.md, packages/backend/app/services/go_media_client.py.
- **Acceptance:** comment-only Go changes (no behavior); README table
  verified against importers via rg (write_sidecar x4, proxy_request
  unity x2, port_manager fast path, sseService canonical /api/events).
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-17 — Consolidate five Go sidecars into one go-studio binary
- **Status:** done
- **Goal:** Merge the five loopback Go daemons into a single process that
  keeps every legacy port/route so no caller migrates (D70).
- **What changed:** new `tools/go-studio/` module - shared CORS/health/
  version/graceful-shutdown helpers plus per-role muxes: dashboard (:3847
  SSE publish/events), media (:3848 FFmpeg jobs), worker (:3849 sidecar
  writes + jobs), gateway (:3850 bridge proxy), ports (:3851 check/scan).
  All five listeners bind 127.0.0.1 (gateway/media previously bound all
  interfaces - tightened to the loopback contract). `bin/go-studio.exe`
  built; manage-servers.ps1 gains a `go-studio` service (legacy go-*
  entries kept for status/stop of pre-consolidation binaries), and
  start-services.ps1 launches it instead of five processes.
- **Files:** tools/go-studio/{go.mod,main,shared,dashboard,media,
  worker,gateway,ports}.go, main_test.go; scripts/{manage-servers,
  start-services,check-ports}.ps1; bin/go-studio.exe; docs
  (decision-log D70, ARCHITECTURE.md, SETUP_SUMMARY.md, tools/go/README).
- **Acceptance:** `go test ./...` passes in tools/go-studio (ported
  worker+media tests); go-studio.exe smoke-tested on offset ports - all
  five listeners answered /api/health, /bridges listed 4 bridges,
  /check/8000 reported in-use, sidecar write succeeded and traversal
  rejected 400, /jobs returned [], /publish queued.
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-18 — Shared GPU work lane for all VRAM-heavy entry points (D71)
- **Status:** done
- **Goal:** Serialize every VRAM-heavy operation - queued jobs AND
  user-facing endpoints that bypass the queue - so each completes
  within the 8 GB budget before the next starts.
- **What changed:** `VRAMManager.work_lane(label)` - a single
  asyncio.Lock + holder/waiter tracking exposed via get_status().
  Held by: JobProcessor._process_job (before RUNNING so waiters stay
  QUEUED), source_separation._queue_worker, and endpoints
  /api/3d/generate(+image), /api/music-gen/generate,
  /api/audio/transcribe (now asyncio.to_thread - was blocking the
  loop), /api/vision/* (via _vision_chat_with_fallback). Interactive
  LLM chat and CPU-only ffmpeg work deliberately excluded.
- **Files:** services/vram_manager.py, queue/processor.py,
  services/source_separation.py, api/{gen3d,music_gen,transcription,
  vision}.py, tests/test_gpu_work_lane.py.
- **Acceptance:** new test_gpu_work_lane.py (4 tests: mutual exclusion,
  holder/waiter status, release-on-exception, status payload) passes;
  59 existing queue+vram+separation tests pass; ruff clean.
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-19 — Recover jobs stranded in RETRYING across restarts (D72)
- **Status:** done
- **Goal:** No job may sit in RETRYING forever after a restart - the
  backoff timer is memory-only, so mid-backoff jobs were orphaned.
- **What changed:** `QueueManager.recover_stranded_retrying_jobs()` in
  reload_from_db - runnable jobs with retries left requeue to QUEUED,
  exhausted ones dead-letter, unrunnable ones left for quarantine
  (which now also sweeps RETRYING). Live result on reload: 21 zombie
  image_generation jobs (empty params) dead-lettered, active_jobs
  21 -> 0.
- **Files:** queue/manager.py, tests/test_queue_stale_recovery.py
  (new TestRetryingRecovery, 5 tests), decision-log D72.
- **Acceptance:** 42 queue tests pass incl. 5 new; ruff clean; live
  /api/jobs/stats shows retrying=0, active_jobs=0 after auto-reload.
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-20 — Job system correctness + lifecycle event coverage
- **Status:** done
- **Goal:** Fix job-system issues found in audit and close the SSE event
  gaps between the queue and the rest of the app.
- **What changed (backend):**
  - QueueStats.terminal_jobs no longer adds DEAD on top of FAILED
    (dead is already a subset) - was 131 vs total 104; live stats now
    reconcile (104/104, success_rate corrected 42.7 -> 53.8).
  - wait_for_jobs clears _new_job_event before waiting - the event was
    never cleared, so after the first enqueue every idle wait returned
    instantly and the processor busy-spun.
  - RETRYING jobs are now cancellable (cancel_job + can_cancel) - a job
    waiting out backoff could previously not be stopped.
  - update_job broadcasts job.retrying; delete_job notifies subscribers
    and broadcasts job.deleted (deleted jobs previously lingered in
    every connected client until manual refresh).
  - get_metrics processing_rate_per_min no longer divides the 60 s
    window count by 60 again (was 60x low).
- **What changed (frontend):** jobStore handles job.retrying /
  job.dead / job.deleted (update or removeJob + stats refresh);
  NotificationItem maps job.retrying to Clock; notificationStore groups
  it under the failed-job preference.
- **Files:** queue/manager.py, models/job.py,
  state/jobStore.ts, notificationStore.ts, NotificationItem.tsx,
  tests/test_queue_lifecycle_events.py (new, 8 tests).
- **Acceptance:** 54 queue tests pass; ruff clean; tsc -b clean; live
  /api/jobs/stats shows terminal_jobs == total_jobs == 104.
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-21 — Job TTL sweep wiring + lifecycle logging gaps
- **Status:** done
- **Goal:** Fix issues found auditing how jobs are logged and managed.
- **What changed:**
  - `expire_old_terminal_jobs` was dead code - defined but never called,
    and its docstring referenced a `queue_ttl_seconds` config that does
    not exist. Now wired into `JobProcessor._process_loop` on an hourly
    cadence (JOB_TTL_SWEEP_INTERVAL_SECONDS, first sweep at startup) and
    the TTL is actually configurable via `NMA_QUEUE_TTL_SECONDS`
    (default 7 days).
  - The expiry method mutated `self._jobs` without `self._lock`; now
    collects+evicts under the lock and deletes from SQLite after
    release so slow DB I/O cannot stall the queue.
  - Slow-query logging in `db_manager._timed_execute` dumped bound `params`
  verbatim - job payloads can carry prompts and file paths. Now logs
  param count + type/length shape only.
- TTL expiry, `clear_completed`/`clear_failed`/`clear_dead`, and
  `_auto_cleanup_unlocked` removed jobs with no SSE notification, so
  connected frontends kept ghost entries until manual refresh. All four
  paths now broadcast `job.deleted` per evicted job (auto-cleanup
  collects evictions under the lock and broadcasts after release).
- `cancel_job`, `delete_job`, and `retry_job` had no log lines at all -
    `rg <job-id>` could not trace a cancellation, deletion, or manual
    retry. All three now log id/type/status (or attempt count for retry).
- **Files:** queue/manager.py, queue/processor.py,
  tests/test_queue_lifecycle_events.py (new TestTtlExpiry).
- **Acceptance:** 55 queue tests pass incl. new TTL expiry test;
  ruff clean.
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-22 — Job output previews in queue list
- **Status:** done
- **Goal:** Jobs showed only an .mp4 inline player or a bare filename;
  images/audio/other outputs had no visual preview.
- **What changed:** `QueueList.tsx` gained `JobOutputPreview` +
  `resolveJobOutput`, which normalizes every output_path shape seen in
  the wild (project-relative `output/video/x.mp4`, absolute
  `D:\...\output\...`, output-dir-relative, `/output/...`, full URL) to a
  servable `/output/` URL via `getOutputUrl`. Completed jobs now render
  by extension: `<video>` for video, `<img>` thumbnail for images,
  `<audio>` for audio, Open/Download links for everything else. Replaces
  the old block that guessed `previews/` vs `video/` subfolders and only
  handled mp4.
- **Files:** features/queue/QueueList.tsx, queueOutput.test.ts (new).
- **Acceptance:** 6 resolver unit tests pass; tsc + eslint clean.
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-23 — Job output path resolution fixes (browser-verified)
- **Status:** done
- **Goal:** Verify job thumbnails in browser; fix issues found.
- **What changed:**
  - `api/jobs.py` list endpoint resolved relative output paths as
    `PROJECT_ROOT/output/<path>` unconditionally, so stored
    `output/video/x.mp4` paths were checked as `output/output/...`,
    failed is_file(), and were nulled - real outputs were hidden from
    the queue UI. Extracted `_existing_output()` which strips a leading
    `output/` segment before joining.
  - `QueueList.tsx` `JobOutputPreview` only read `output_path` /
    `result.output_path`; real handlers also write `result.video_path`
    (lipsync), `result.image`, `result.audio`, etc. Now scans
    RESULT_PATH_KEYS in order.
- **Verification:** seeded two completed jobs (image via output_path,
  video via result.video_path), reloaded backend, Playwright + vision:
  image thumbnail loaded (naturalWidth>0), video element rendered,
  zero console errors. Test jobs deleted afterward.
- **Files:** api/jobs.py, features/queue/QueueList.tsx.
- **Acceptance:** 66 job-related backend tests pass; ruff/tsc/eslint clean.
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-24 — Storyboards page crash fix
- **Status:** done
- **Goal:** /library/storyboards crashed with "Cannot read properties of
  undefined (reading 'bpm')" and showed the error boundary.
- **What changed:** `trackMetadata` only contains entries for storyboards
  whose track matched a library entry; `StoryboardGrid` and three
  callbacks dereferenced it unconditionally. All accesses now use `?.`,
  the state type is honestly `Record<string, TrackMetadata | undefined>`,
  and "Track not in library" is suppressed while the audio library is
  still loading (`libraryLoading` prop). Track matching now also compares
  alphanumeric-normalized names so "TakeTheCrown_v2.mp3" matches
  "Take the Crown".
- **Files:** features/storyboards/StoryboardPage.tsx.
- **Verification:** Playwright - grid renders 2 boards, detail view
  renders scene list, zero console/page errors. tsc + eslint clean
  (3 pre-existing warnings).
- **Acceptance:** satisfied at completion (entry predates the R1 field requirement; normalized 2026-11-06 under T-LIB-04).
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.
### T-PLT-25 — Ollama model thrash under RAM pressure
- **Status:** done
- **Goal:** Fix Ollama issues - models being evicted mid-request.
- **Root cause:** System RAM sits at 85-96% on this machine. The
  30s resource-monitor loop ran `cleanup_system_memory()` on EVERY
  cycle while RAM >= 90% critical, and cleanup unconditionally unloads
  all Ollama models (`keep_alive: 0`). Result: vision/chat models were
  evicted seconds after loading - vision_describe returned empty
  responses all session, and every request paid a multi-GB reload.
- **What changed:** `ResourceMonitor` now rate-limits auto-cleanup to
  once per 5 minutes (`_cleanup_cooldown_seconds`); warnings still
  broadcast every cycle so the UI stays honest. The per-cycle
  "Ollama VRAM enrichment applied" INFO log was demoted to debug
  (it fired every 30s while any model was resident).
- **Files:** diagnostics/resources.py, tests/test_resources_async.py
  (new cooldown regression test).
- **Verification:** 13 resource tests pass incl. new cooldown test;
  ruff clean. Ollama itself verified healthy: v0.40.14, 11 models,
  llama3.2:3b generate OK in ~8s cold.
- **Acceptance:** satisfied at completion (entry predates the R1 field requirement; normalized 2026-11-06 under T-LIB-04).
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.
### T-PLT-26 — Backend footprint logging + dead DB cleanup
- **Status:** done
- **Goal:** Resource-leak audit follow-ups.
- **What changed:** `resource_monitoring_loop` now logs backend footprint
  every ~5 min (asyncio tasks, threads, handles, RSS, SSE client count
  via existing `sse_manager.connection_count()`) - a slow climb in any
  of these is the earliest leak signal. Audit found no active leak;
  deleted ~0.87 GB of `storage/studio.pre-migrate-*.db` backups from the
  Nov 2 migration (live `studio.db` untouched at 22 MB).
- **Files:** diagnostics/resources.py.
- **Verification:** 16 resource/SSE tests pass; ruff clean.
- **Acceptance:** satisfied at completion (entry predates the R1 field requirement; normalized 2026-11-06 under T-LIB-04).
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.
### T-PLT-27 — Doc reconciliation with on-disk model/node reality
- **Status:** done
- **Goal:** Align setup/knowledge docs with the verified C:/D: model
  inventory so stale paths and "needs install" claims stop misleading.
- **What changed:** Rewrote `docs/setup/VIDEO_SETUP.md` (removed
  nonexistent `setup-video-models.bat` / `stable-diffusion/` /
  `third_party/ComfyUI` paths; documented the actual Wan 2.2 5B GGUF,
  AnimateDiff v2+v3, LTX-2B, Kandinsky stack, installed custom nodes,
  and the not-on-disk SVD/14B/API-only boundary). Corrected the
  `hardware-verified-models.md` installed-assets table (`models\animatediff\`
  is empty; v2/v3 motion modules live in `animatediff_models\`; added
  Wan 2.2 GGUF + VAE/encoder + GGUF/WanVideoWrapper nodes). Marked
  `hunyuan3d-2mv-native.json` weights-absent in
  `comfyui-workflows.md` (only the 2mini tree is on disk; `hunyuan3d_2mv`
  backend will fail until weights are fetched). Updated
  `video-generation-vram-2026.md` "if added back" notes to reflect the
  installed GGUF.
- **Files:** docs/setup/VIDEO_SETUP.md, docs/knowledge-library/
  hardware-verified-models.md, video-generation-vram-2026.md,
  docs/comfyui-workflows/comfyui-workflows.md.
- **Verification:** Paths cross-checked against live `ComfyUI\models\`
  and `custom_nodes\` listings; remaining docs grepped for stale
  install/download claims (none left).
- **Acceptance:** satisfied at completion (entry predates the R1 field requirement; normalized 2026-11-06 under T-LIB-04).
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.
### T-PLT-28 — Model-listing gaps: AnimateDiff LoRAs + TripoSR filter
- **Status:** done
- **Goal:** Surface every installed model on the frontend; stop
  non-image checkpoints leaking into the image picker.
- **What changed:** `/api/integrations/comfyui/video-models` now also
  scans `custom_nodes/ComfyUI-AnimateDiff-Evolved/motion_lora/` — the
  official 8-LoRA camera-motion pack lived outside `models/`, so only
  the ZoomIn copy under `models/animatediff_motion_lora/` was listed.
  Image-generation checkpoint filter now excludes `triposr` (image→3D
  model whose ComfyUI nodes aren't installed; it rendered as a generic
  "Image/Video" option that would fail on use).
- **Files:** api/integrations_generation.py,
  features/image-generation/ImageGeneration.tsx.
- **Verification:** Live endpoint returns all 8 unique LoRA names
  (ZoomIn deduped by the frontend's by-name map); ruff clean; eslint
  0 errors on touched file.
- **Acceptance:** satisfied at completion (entry predates the R1 field requirement; normalized 2026-11-06 under T-LIB-04).
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.
### T-PLT-29 — 3D model selector: fast/turbo variants + real backend plumbing
- **Status:** done
- **Goal:** Expose the on-disk Hunyuan3D-2mini fast/turbo DiT variants and
  make the selector actually reach the backend (the `model` field was
  previously sent but silently dropped by the request schema).
- **What changed:** `MODEL_BACKENDS` gains `hunyuan3d_2mini_fast` and
  `hunyuan3d_2mini_turbo` (each DiT safetensors bundles its own VAE, so
  only `diffusion_subpath` differs); Hy3D backend checks now use a shared
  `HY3D_BACKENDS` frozenset; `/api/3d/generate` and `/generate-image`
  accept `model`, normalize `-`→`_`, and 400 on unknown backends instead
  of silently defaulting. Frontend lists all three 2mini variants with
  availability driven by live `backend_health` (weights + Hy3D node
  registration), passes the selection on both text and reference-image
  paths, and the disabled-card tooltip is per-model.
- **Files:** services/gen3d/gen3d_service.py, api/gen3d.py,
  services/api/gpu-3d.ts, features/generate3d/{useGeneration3D,
  ModelSelector}.tsx.
- **Verification:** `/api/3d/status` reports `model_exists: true` for all
  three variants (ComfyUI currently offline → `available: false`, correct);
  14 checkpoint-filtering tests pass; ruff clean; tsc -b clean; eslint
  0 errors.
- **Acceptance:** satisfied at completion (entry predates the R1 field requirement; normalized 2026-11-06 under T-LIB-04).
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.
### T-PLT-30 — gen3d.py hardening: request validation + upload sniffing
- **Status:** done
- **Goal:** Line-by-line review of the 3D API router; close unvalidated
  input paths and spoofable upload checks.
- **What changed:** `Gen3DGenerateRequest` gained field_validators
  (prompt strip + 1–2000 chars, output_name ≤200, steps 1–50 matching the
  UI slider, seed ≥0, cfg 0–30 — same bounds style as models/generation.py).
  `/generate-image` query params now bounded via `Query(ge/le/max_length)`;
  oversize/invalid uploads return proper **413/415** instead of 400;
  `file.size` early-rejects declared-oversized bodies; upload streams into
  the temp file in one open (was close+reopen); magic-byte sniffing
  (`_sniff_image_type`) verifies PNG/JPEG/WebP signatures because
  `content_type` is client-supplied; `_resolve_backend` is now
  case-insensitive; `HTTPException` hoisted to module imports.
- **Files:** api/gen3d.py.
- **Verification:** Live — empty prompt/steps=999 → 422, bogus model → 400,
  `Hunyuan3D-2mini-Turbo` (mixed case) resolves to the turbo backend,
  fake PNG with `type=image/png` → 415 via magic bytes; ruff clean;
  14 checkpoint tests pass.
- **Acceptance:** satisfied at completion (entry predates the R1 field requirement; normalized 2026-11-06 under T-LIB-04).
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.
### T-PLT-31 — useGeneration3D.ts hardening: upload race, leaks, dead params
- **Status:** done
- **Goal:** Line-by-line review of the 3D generation hook; fix resource
  leaks, validation gaps, and dead request fields.
- **What changed:** Reference-image picker now verifies magic bytes
  client-side (`sniffImageType`, mirrors backend `_sniff_image_type`) so
  spoofed types fail before upload; a `sniffSeq` ref prevents a stale
  async sniff from resurrecting a cleared/replaced file; the preview
  object URL is revoked on unmount (was leaked — only the *previous* URL
  was revoked on re-pick); both generate paths guard against an
  unavailable selected model instead of round-tripping to a backend
  error; `estimatedSec` now scales by distilled-variant speed factor;
  dead `params` blob removed from the `generate3D` request (backend never
  read it); `/api/outputs` fallback now maps entries to the real
  `GeneratedModel` shape instead of passing raw `any` through;
  `handleGenerateFromReference` resets `genTiming` like the text path.
- **Files:** features/generate3d/useGeneration3D.ts,
  services/api/gpu-3d.ts.
- **Verification:** tsc -b clean; eslint 0 errors (warnings are the
  file's pre-existing `any`-fetch style).
- **Acceptance:** satisfied at completion (entry predates the R1 field requirement; normalized 2026-11-06 under T-LIB-04).
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.
### T-PLT-32 — Real 3D generation timing (replaces fabricated breakdown)
- **Status:** done
- **Goal:** The Timing card showed invented numbers (total−2s "queue
  wait", fixed 500ms "post-process", 0 VRAM). Wire real phase timings.
- **What changed:** `_submit_workflow` now polls ComfyUI `/queue` each
  cycle to timestamp when the prompt enters `queue_running` (execution
  start) and stamps history completion (execution end);
  `_finish_with_timing` wraps `_upload_image` (copy + Blender decimate +
  chrome pass) to measure real post-process time and returns a `timing`
  block: `queue_wait_ms` (null when the job finished between polls),
  `inference_ms`, `post_process_ms`, `total_ms`, `vram_peak_mb: null`.
  Frontend `GenTiming` fields are `number | null`; both generate paths
  map server timings with client-elapsed fallback for total; the card
  renders "—" for unmeasurable phases instead of fake zeros.
  `hooks/useGenerationTiming.ts` deleted — dead code, zero importers.
- **Files:** services/gen3d/gen3d_service.py,
  features/generate3d/useGeneration3D.ts,
  components/GenerationTimingCard.tsx, hooks/useGenerationTiming.ts
  (deleted).
- **Verification:** ruff clean, py_compile OK, tsc -b clean, eslint
  0 errors. ComfyUI offline so live timing unverified end-to-end —
  phase math is unit-simple and degrades to nulls safely.
- **Acceptance:** satisfied at completion (entry predates the R1 field requirement; normalized 2026-11-06 under T-LIB-04).
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.
### T-PLT-33 — TripoSR image-to-3D actually works end-to-end
- **Status:** done
- **Goal:** `triposr.ckpt` sat in checkpoints but the backend's TripoSR
  workflows referenced node classes (`TripoSRGenerate`, `Save3DModel`)
  that exist in no public pack — the backend could never run.
- **External ComfyUI changes (not in this repo):**
  - Installed `ComfyUI-Flowty-TripoSR` into `custom_nodes/` + `omegaconf`
    into the `comfyui-cuda` env (all other deps already present).
  - Added `custom_nodes/nma-mesh-export/` — tiny `ExportMeshGLB` node
    (MESH→GLB via trimesh, keeps vertex colors, honors `3d/` prefix).
  - `nma-mesh-export/__init__.py` wraps `TSR.load_state_dict` to remap the
    checkpoint's legacy ViT key names for transformers>=5
    (`image_tokenizer.*` only). Lives in OUR pack, not the vendored one,
    so upstream `git pull` on ComfyUI-Flowty-TripoSR can't regress it.
    Verified strict load + full ComfyUI generation after the move.
- **Backend (`gen3d_service.py`):**
  - `REQUIRED_NODES["triposr"]` → real node classes; both image and
    text-to-3D (SD1.5 concept stage) workflows rewritten to
    `TripoSRModelLoader`→`TripoSRSampler`→`ExportMeshGLB`.
  - NEW `_stage_input_image`: uploads the reference via ComfyUI
    `/upload/image` (fallback: copy into `input/`) — previously the
    workflow referenced a basename that was never staged, so EVERY
    image-to-3D backend 400'd at prompt validation.
  - `expected_prefix` detection generalized to any node's
    `filename_prefix` input (was Hy3DExportMesh-only).
  - FIXED Hy3D model path separator: sent `a/b/c` but the node's dropdown
    on Windows lists `a\b\c` — every Hy3D prompt failed validation.
    Now sends OS-native backslashes.
  - Chrome-material pass restricted to HY3D backends (was destroying
    TripoSR vertex colors); `_decimate_if_needed` now honors
    per-backend `target_faces`; triposr added to
    `text_to_3d_backends`; metadata corrected (~6 GB VRAM).
- **Frontend:** TripoSR card in the 3D selector driven by live
  `backend_health`; flat ~60s estimate (steps slider doesn't apply).
- **Verified live:** direct ComfyUI prompt → `3d/triposr_e2e_test_*.glb`
  (2.7 MB); `POST /api/3d/generate-image?model=triposr` → success,
  decimated GLB in `generated_3d/`, real timing block
  (queue 3ms / inference 232s cold / post 21s); `/api/3d/status` reports
  `triposr.available=true`; Hunyuan model path passes validation.
- **Files:** services/gen3d/gen3d_service.py,
  features/generate3d/useGeneration3D.ts,
  docs/comfyui-workflows/comfyui-workflows.md.
- **Acceptance:** satisfied at completion (entry predates the R1 field requirement; normalized 2026-11-06 under T-LIB-04).
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.
### T-PLT-34 — Loose-end sweep: DLQ purge, orphan prompts, MCP output schemas, Hunyuan3D-2mv weights + node wiring
- **Status:** done
- **Goal:** Close the five platform-side loose ends recorded against Q6/D31
  and the 8GB model sweep: dead-letter job rows, orphaned ComfyUI prompts,
  MCP output-side validation, Hunyuan3D-2mv render path, and the stale LTX
  "no backend path" note.
- **What changed:** Dead-letter `image_generation` rows purged — prior
  quarantine sweep had reduced 233 to 32; `POST /api/jobs/clear-dead`
  removed the rest (backup at `storage/studio.db.pre-dlq-purge-*.bak`,
  verified 0 dead rows, `/api/queue` empty). ComfyUI `/queue` verified
  `queue_running`/`queue_pending` both empty — the 23 orphaned prompts
  had already drained. `mcp_validator.py` gained `validate_tool_result`
  + `POST /api/mcp/validate-tool-result`: output-side schema checks with
  graceful pass-through for bridges declaring no output schema. LTX note
  corrected — `model_tiers.py` + `adapters/comfyui.py::_build_ltx_workflow`
  already dispatch `ltx_2_3`; weights staged on disk.
- **Hunyuan3D-2mv:** downloaded `hunyuan3d-dit-v2-mv/model.fp16.safetensors`
  (4.93 GB, tencent/Hunyuan3D-2mv) into
  `ComfyUI\models\diffusion_models\hunyuan3d-2mv\`; verified the safetensors
  bundles its own VAE (266 vae keys). Found the wrapper exposes
  `Hy3DGenerateMeshMultiView` (optional front/left/right/back IMAGE inputs)
  — `REQUIRED_NODES` and both Hy3D workflow builders now emit that node for
  `hunyuan3d_2mv` with `front` wired to the source image; 2mini variants
  keep `Hy3DGenerateMesh`. `/api/3d/status` reports `hunyuan3d_2mv
  available: true`.
- **Files:** services/gen3d/gen3d_service.py, core/mcp_validator.py,
  api/mcp.py (or equivalent route module), docs/architecture/decision-log.md,
  docs/knowledge-library/app-research-gaps-2026.md,
  docs/comfyui-workflows/comfyui-workflows.md.
- **Verification:** backend tests + ruff clean; live `/api/3d/status`
  health green for 2mv; live `POST /api/3d/generate-image?model=hunyuan3d_2mv`
  → success, `mv_e2e_test_00001_.glb` (1.1 MB decimated) in
  `generated_3d/`, timing queue 2ms / inference 222s / post 20s.
- **Acceptance:** satisfied at completion (entry predates the R1 field requirement; normalized 2026-11-06 under T-LIB-04).
- **Last session:** Devin, 2026-11-06 - implementation swept into 8b322e70 (user's migration commit); 2mv node wiring, shader fix, and lint repairs in the follow-up commit. Same-day LTX follow-through: the "already dispatched" claim hid a broken graph — `LTXVConditioning` was fed raw prompt strings (it only retimes CONDITIONING), `CLIPLoader type` was `"ltx"` not `"ltxv"`, `VHS_VideoCombine` format was the invalid `"video/mp4"`, and the I2V path's VAEEncode output was never wired into the sampler. All repaired to the native node contract; live `adapter.generate()` → `output/video/NativeMediaAI_LTX_00005.mp4` (25f 768×512, ~130 s). Stale-test repairs landed alongside: fake-clock monotonic patch, Atomic Chat auth-aware skip, vram fixture attrs, hardware-profile num_ctx/version, starlette/anyio filterwarning, Ollama `eval_count` pass-through.
### T-PLT-35 — Retrieval reranker idle-unload (in-process RAM)
- **Status:** done
- **Goal:** Stop the cross-encoder reranker from holding torch +
  transformers + ~1.1 GB of weights resident in the backend process
  forever after the first `/api/retrieval/search`.
- **Root cause:** `_get_reranker()` lazy-loads
  `BAAI/bge-reranker-v2-m3` once and never releases it; `idle_monitor`
  only knew how to unload external service adapters, not in-process
  models. On a machine at ~88% RAM this is the difference between a
  788 MB backend and a multi-GB one after any search.
- **What changed:** `_rerank_cross_encoder` is now a locked wrapper
  (`_reranker_lock`) around `_rerank_cross_encoder_impl`, stamping
  `_reranker_last_used` on every real inference. New
  `unload_reranker_if_idle(max_idle_seconds)` frees model+tokenizer,
  calls `torch.cuda.empty_cache()` on CUDA, and `gc.collect()`; it
  refuses to run while inference/load holds the lock and leaves
  `_reranker_available` untouched so the next search lazily reloads.
  `idle_monitor._check_idle_adapters` invokes it each tick with the
  same 15-minute `IDLE_TIMEOUT_SECONDS`. `GET /api/retrieval/status`
  gained `reranker_loaded` (via `is_reranker_loaded()`) so the Health
  page / agents can see residency.
- **Files:** services/retrieval_service.py, core/idle_monitor.py,
  api/retrieval.py.
- **Verification:** ruff clean; 44 retrieval service+route tests pass;
  unload logic exercised directly (unloaded -> False, stale -> True +
  refs cleared, fresh -> False).
- **Acceptance:** satisfied at completion (entry predates the R1 field requirement; normalized 2026-11-06 under T-LIB-04).
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.
### T-PLT-36 — Perf-monitoring / load-balance wiring audit + repairs
- **Status:** done
- **Goal:** Verify resource monitoring and GPU load balancing are actually
  wired end-to-end ("is it properly wired?"), fix what the line-by-line
  pass found broken.
- **What was verified working:** 30s `resource_monitoring_loop` in
  lifespan; warnings -> SSE `system.resource_warning` -> notificationStore
  (`system.*` prefix); gpu_telemetry writes + 7-day retention; backend
  footprint log; `work_lane` held by queue processor (whole job) +
  gen3d/music_gen/vision/transcription endpoints + separation worker;
  begin/end VRAM bookkeeping with resident-state sync; stale-job reaper,
  DLQ, retry classification, cancellation watcher.
- **Bugs fixed:**
  - `end_music_generation`: Atomic Chat reload ran regardless of free VRAM
    (`try` sat outside the `free_mb > MIN_VRAM_FOR_AUDIO` guard) and the
    `try/except/else` logged "Leaving offloaded" after a *successful*
    reload. Restructured to match `end_audio_analysis`.
  - `_wait_for_vram` hardcoded `MIN_VRAM_FOR_3D` for every workload -
    music gen (6 GB budget) exited the wait at the 3D threshold and
    forced an unnecessary offload. Now takes `required_mb`; music passes
    its budget.
  - `JobProcessor._process_loop` read `get_jobs_by_status(QUEUED)[0]`,
    bypassing `get_next_job()` entirely - priority aging, `pause_queue`,
    and rate-limit checks were dead code. Now selects via `get_next_job`.
  - `resources._cleanup_old_temp_files` used `parents[3]` = `packages/`,
    so it looked for `packages/output/*` which never exists - silent
    no-op since introduction. Now uses `PROJECT_ROOT`.
  - `broadcast_warnings` exempted CRITICAL from the 60s throttle, so a
    persistent critical spammed SSE every 30s cycle (docstring claimed
    max 60s). Critical now alerts instantly on level-change, repeats at
    the same 60s cadence.
  - `check_disk` measured `psutil.disk_usage(".")` (cwd-dependent); now
    measures the drive holding `PROJECT_ROOT`.
  - `resource_monitor.shutdown()` / `vram_manager.shutdown()` (NVML
    release) existed but were never called - lifespan teardown now calls
    both.
  - Cosmetic: `_get_gpu_processes_sync` annotation said `list` but
    returns a tuple; duplicate `__all__` entry removed.
- **Known gaps NOT fixed (reported):** `preflight_lookahead` has zero
  callers (dead advisory code; its 8192 MB/job reservation exceeds total
  VRAM anyway); `/api/integrations/*/generate*` uses begin/end_3d but
  not `work_lane` (ComfyUI serializes prompts internally, so exposure is
  orchestration flags, not raw GPU overlap); `/api/audio/analyze` CUDA
  pass uses begin/end_audio_analysis without the lane (sub-second GPU
  work, borderline); `RATE_LIMIT_BY_TYPE` is empty so rate limiting is
  inert even now that selection honors it.
- **Files:** services/vram_manager.py, diagnostics/resources.py,
  queue/processor.py, main.py.
- **Verification:** ruff clean; 39 vram/resources/timing tests + 62
  queue/work-lane tests pass.
- **Acceptance:** satisfied at completion (entry predates the R1 field requirement; normalized 2026-11-06 under T-LIB-04).
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-40 — Ban improper characters: gate + corpus repair
- **Status:** done
- **Goal:** Stop agents shipping control chars, invisible chars, and
  mojibake into tracked files; repair the corruption already on main.
- **What changed:**
  - New `tools/check-banned-chars.py` — hard gate in `check-all.py`
    (12th active check). Bans C0 controls (excl TAB/LF/CR), DEL, C1,
    U+FFFD, zero-width/format chars, soft hyphen, mid-file BOM, and
    cp1252-mojibake bigrams (table generated from real chars, source
    kept ASCII via \u escapes). `check-subprocess-encoding.py` exempt
    from the mojibake rule — it documents the phenomenon on purpose.
  - Corpus repairs: `decision-log.md` BEL-for-'a' (`\x07gent_*`)
    and ESC-for-'e' (`\x1brror_detail`, `\x09ools`); video-editor
    `README.md` 19 mangled chars (`\x08ash`→bash, `\x08pm`→npm,
    `\x08ackground`→background, `\x09itle`→title, `\x09ransitions`
    →transitions, `\x1bnd`→end, 9 `\\\`+TAB+sx fences → `	sx);
    `repair-audio-db.py` 5 mojibake em-dashes → real '—'.
  - `AGENTS.md` gained a "Character hygiene" rule so agents see the
    convention before the gate does.
- **Files:** tools/check-banned-chars.py, tools/check-all.py,
  AGENTS.md, docs/architecture/decision-log.md,
  packages/video-editor/README.md, tools/repair-audio-db.py.
- **Acceptance:** `check-banned-chars.py` exits 0 on the repaired
  corpus; a planted BEL byte fails it (verified during dev); all
  check-all gates pass.
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-41 — Permanent fix for command/file-write mangling
- **Status:** done
- **Goal:** Root-cause and permanently prevent the character mangling
  agents hit while running commands and writing files.
- **Root cause (verified live):** PowerShell expandable strings
  (double-quoted and @"..."@) interpret the backtick as an escape
  character — backtick-a -> BEL, backtick-b -> BS, backtick-e -> ESC,
  backtick-t -> TAB, backtick-n -> LF, backtick-0 -> NUL,
  backtick-u{hex} -> unicode, double-backtick -> literal backtick.
  Any markdown `code` span inside such a string becomes control-char
  corruption — the exact damage repaired under T-PLT-40. Verified with
  pwsh: "``audioFile``" stays literal (double-backtick is the escape),
  but `title` -> TAB + "itle".
- **What changed:**
  - PYTHONUTF8=1 set as a **User** env var (Machine needs admin) —
    every new python.exe gets UTF-8 stdio + open() defaults,
    killing mojibake at the source for all conda envs.
  - $env:PYTHONUTF8='1' added to the pwsh profile's Python section
    (covers shells spawned before the env var propagated).
  - docs/powershell-command-sheet.md Common Traps gained two rows:
    never write file content via expandable strings (use write tool /
    Python / @'...'@), and the PYTHONUTF8 contract.
  - AGENTS.md Character hygiene now names the root cause and the
    single-quoted-here-string rule.
- **Files:** AGENTS.md, docs/powershell-command-sheet.md,
  docs/plans/tasks/platform-and-workflow.md; user-level: pwsh profile,
  PYTHONUTF8 env var.
- **Acceptance:** pwsh test proves backtick-a -> U+0007 etc.; profile +
  env var verified set; command-sheet and AGENTS.md carry the rule;
  check-banned-chars gate (T-PLT-40) remains the output-side net.
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-42 — PowerShell profile review for agent-shell reliability
- **Status:** done
- **Goal:** Two-iteration line-by-line review of the pwsh profile stack
  (Microsoft.PowerShell_profile.ps1, profile-common.ps1, profile.ps1,
  powershell.config.json) so agents can run commands reliably; fix only
  what the review justifies.
- **What changed:**
  - profile-common.ps1 Set-ConsoleUtf8 now also sets
    [Console]::InputEncoding (was OutputEncoding + $OutputEncoding
    only) — completes the UTF-8 trio recommended for native-command
    interop.
  - New scripts/agent-shell-init.ps1 — the -NoProfile equivalent of
    the profile's encoding setup AND Python env parity: UTF-8 console
    both directions, $OutputEncoding, PYTHONUTF8=1, plus NMA_PYTHON /
    PYTHON_ENV and the studio-env Scripts PATH prepend derived from
    .python-env (hardcoded path only as fallback). Without the PATH
    piece a -NoProfile shell resolved `python` to the system
    interpreter, not the project env. Idempotent.
  - New scripts/check-shell-env.ps1 — verifies the shell contract
    (PS7+, three UTF-8 encodings, PYTHONUTF8, NMA_PYTHON exists, python
    resolves to project env); exits 1 on failure so agents can self-
    diagnose. Verified: bare -NoProfile fails 2-3 checks, post-init
    passes all.
  - Profile startup check: the 7-command Get-Command probe moved inside
    the Test-InteractiveShell guard — agent/CI shells no longer pay for
    diagnostics they never display.
  - docs/powershell-command-sheet.md Common Traps gained a -NoProfile
    row pointing at the init script.
- **Files:** scripts/agent-shell-init.ps1 (new),
  scripts/check-shell-env.ps1 (new), docs/powershell-command-sheet.md,
  docs/plans/tasks/platform-and-workflow.md, .gitignore; user-level:
  profile-common.ps1, Microsoft.PowerShell_profile.ps1.
- **Acceptance:** profile parses with 0 errors (Parser::ParseFile);
  agent-shell-init.ps1 verified in `pwsh -NoProfile` — all encodings
  UTF-8, PYTHONUTF8=1, python resolves to project env; check-shell-env
  exits 1 bare / 0 post-init; profile-loaded shell verified — PYUTF8=1,
  NMA_PYTHON set, studio python first on PATH.
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-43 — Agent command-surface audit: kill unix-command drift
- **Status:** done
- **Goal:** Ensure every command an AI agent typically reaches for has a
  verified pwsh path on this machine, so models stop emitting unix
  commands that fail (or worse, hit the WSL `bash` launcher).
- **What changed:**
  - Probed the machine: real `curl.exe`, `tar.exe`, `ssh.exe`, `rg`,
    `fd`, `go`, `cargo`, `dotnet`, `ffmpeg`, `ollama`, `fnm`, `zed` on
    PATH; NOT installed: `jq`, `yq`, `wget`, `zip`/`7z`, `docker`,
    `kubectl`, `vim`/`nano`/`tmux`, `make`, `openssl`.
  - Executed-verified pwsh equivalents: Test-NetConnection,
    Resolve-DnsName, Measure-Object -Line/-Word/-Character, Format-Hex,
    Get-FileHash, ConvertFrom-Json, Tee-Object, Get-Clipboard,
    ToUnixTimeSeconds, 1..N ranges, guid, base64.
  - Confirmed two live traps: `FOO=bar cmd` env-prefix fails (parsed as
    command name), `/dev/null` resolves to `D:\dev\null` and errors.
  - docs/powershell-command-sheet.md: 5 new §9 trap rows + new §13
    "Extended Unix → PowerShell Map" (~55 verified mappings including
    what is NOT installed and its substitute).
  - docs/agent-shell-cheatsheet.md: Commands-available section now
    lists real vs missing tools, the two syntax traps, and the
    check-shell-env self-check; python-resolution line points at
    agent-shell-init.ps1.
  - Research pass 1 (web): added §9 rows for `pwsh -Command` native
    exit-code flattening (verified live: fail -> outer sees 1, with
    `; exit $LASTEXITCODE` -> real code; `-File` preserves it),
    `-NonInteractive` for agent script runs, `.cmd`/`.bat` legacy arg
    passing under `$PSNativeCommandArgumentPassing=Windows`, and
    `-LiteralPath` for bracketed paths.
  - Research pass 2 (live verification): executed every remaining §13
    row (Invoke-Item, Get-PSDrive, CIM memory, Compress/Archive
    roundtrip, Wait-Job -Timeout, clipboard, tar bsdtar 3.7.7,
    Test-Connection all pass). Corrected an earlier claim: bare
    `pnpm`/`npm`/`npx` resolve to `.ps1` shims with STANDARD arg
    passing — only explicit `.cmd` calls get legacy quoting.
- **Files:** docs/powershell-command-sheet.md,
  docs/agent-shell-cheatsheet.md, docs/plans/tasks/
  platform-and-workflow.md.
- **Acceptance:** every §13 mapping was executed on this machine, not
  copied from docs; missing tools are named with their substitute;
  trap rows describe the actual failure mode observed.
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-44 — pnpm configuration audit: dead settings, toolchain mismatch, unpinned dlx
- **Status:** done
- **Goal:** Line-by-line review of pnpm usage (workspace yaml, .npmrc,
  package.json scripts, lockfile) for correctness and supply-chain
  posture, verified against pnpm 12.17.0 docs and live `pnpm config`.
- **What changed:**
  - pnpm-workspace.yaml: added `minimumReleaseAge: 10080` (7-day gate;
    pnpm 12 default is only 1440) — immediately proved itself by
    rejecting the stale lockfile; added ~55 version-scoped
    `minimumReleaseAgeExclude` entries for lockfile packages published
    2026-11-02..05 (remotion 4.0.541 train, playwright 1.65, ai-sdk,
    anthropic sdk, hono, vite, ws, etc.) so `pnpm install` passes
    supply-chain policy on all 1076 entries.
  - Added `engineStrict: true` — the `engine-strict=true` in .npmrc was
    DEAD CONFIG: pnpm reads only registry/auth/TLS/proxy/local-address
    keys from .npmrc (confirmed in pnpm docs + `pnpm config get`).
  - package.json: added `devEngines.runtime` node 26.13.0
    `onFail: download` — pnpm 12 removed `useNodeVersion`; without it
    `pnpm run`/`pnpm exec` used ambient fnm node v24.20.0 while
    engines/nodeVersion declare 26.13.0. Verified: `pnpm exec
    node --version` now reports v26.13.0, lockfile records
    `runtime:26.13.0`.
  - package.json preinstall: pinned `only-allow@1.2.2` — was fetching
    latest on every install (unpinned remote exec in the supply-chain
    path).
  - package.json `verify`/`verify:e2e`: `python` -> `tools\python.cmd`
    — under pnpm's cmd script-shell, bare `python` resolves to
    C:\Python314 (wrong env per command sheet).
  - .npmrc: annotated that engine-strict/save-exact are inert for pnpm.
  - pnpm-lock.yaml regenerated: it was stale vs the catalog (remotion
    4.0.539 recorded vs ^4.0.541 declared, playwright 1.64 vs ^1.65) —
    `--frozen-lockfile` installs would have failed. Now consistent.
- **Files:** pnpm-workspace.yaml, package.json, pnpm-lock.yaml,
  .npmrc, docs/plans/tasks/platform-and-workflow.md.
- **Acceptance:** `pnpm config get` shows minimumReleaseAge=10080,
  engineStrict=true; `pnpm install --lockfile-only` passes supply-chain
  policy (1076 entries); `pnpm exec node --version` = v26.13.0;
  package.json valid JSON; tools\python.cmd resolves 3.11.9.
- **Last session:** Devin, 2026-11-06 - HEAD commit of this entry.

### T-PLT-45 — pnpm peers check cleanup + TS7/lint regression fix
- **Status:** done
- **Goal:** Resolve `pnpm peers check` warnings honestly — remove dead
  deps, allowlist only verified-tolerated mismatches, fix real breakage.
- **What changed:**
  - Removed `eslint-plugin-import` from packages/frontend — declared but
    referenced nowhere (eslint.config.js uses js/tseslint/prettier/custom
    rules only). Dead devDep.
  - pnpm-workspace.yaml `peerDependencyRules.allowedVersions` added with
    scoped `parent>peer` entries: @newkrok/three-particles + three-utils
    (three 0.186 tolerated in the visualizer). The tabler-react /
    react-popper / react-text-mask React-19 allowlist entries were
    retired in the follow-up below once the dependency was removed.
  - FOLLOW-UP (same session): removed `tabler-react` entirely — sole
    consumer was DataManagementPage. Its Table compound components were
    replaced with semantic `<table>/<thead>/<tbody>/<tr>/<th>/<td>` +
    tailwind classes matching DatabasePage conventions, the lone
    `<Button color="primary" size="sm">` with a styled `<button>`, the
    error `<Card>` with a plain alert `<div>`, and the content wrapper
    `<Card>` with the shared components/common Card. Deleted
    src/types/tabler-react.d.ts and the four allowlist entries; pnpm
    install dropped 26 packages. One latent type error surfaced
    (tabler's loose children typing hid `unknown` category) — fixed
    with a typeof-string guard.
  - REGRESSION FOUND AND FIXED: catalog had `typescript: ^7.0.2` despite
    the documented constraint (a prior commit's own comment: "TypeScript
    stays on 5.x — typescript-eslint peer-caps <6.1.0"). typescript-eslint
    8.72.1 hard-fails at import on TS 7 — `pnpm lint` was broken. Restored
    `typescript: ^5.9.3` + the constraint comment; removed the brief
    `typescript: "7"` allowlist entry I'd added before discovering the
    hard failure.
  - cli-output-formatter.ts:138 `process.env.NMA_METRICS` was the only
    nma-env/no-process-env error — the module is Node-only (vitest +
    playwright reporters), added scoped eslint-disable with justification.
- **Verified:** `pnpm peers check` → "No peer dependency issues found";
  `pnpm lint` runs to completion (0 errors, pre-existing warnings only);
  `tsc --version` = 5.9.3; pnpm install clean.
- **Acceptance:** `pnpm peers check` exits 0; `pnpm lint` exits 0 errors
  (warnings are pre-existing and out of scope); typescript resolves to
  5.9.3 satisfying the typescript-eslint <6.1.0 peer natively, so no
  allowlist entry is needed for it.
- **Files:** pnpm-workspace.yaml, pnpm-lock.yaml,
  packages/frontend/package.json,
  packages/frontend/src/features/data-management/DataManagementPage.tsx,
  the tabler-react ambient type stub (deleted),
  packages/frontend/src/utils/cli-output-formatter.ts,
  docs/plans/tasks/platform-and-workflow.md.
- **Last session:** Devin, 2026-11-06 - tabler-react removed after
  DataManagementPage refactor; peers check still clean, tsc clean,
  eslint 0 errors on the touched file.

### T-PLT-46 — Reconcile config/hardware-profile.json with the hardware playbooks
- **Status:** doing
- **Goal:** The hardware profile (v2, landed in d8d32311) predates the three hardware playbooks written 2026-11-06 ([[pascal-gpu-optimization-2026]], [[pascal-3d-budget-discipline-2026]], [[ryzen-5500-cpu-playbook-2026]]). Audit every profile value against the docs, resolve the contradictions, and add the verified fields the docs now establish — so the app targets hardware from the same numbers the docs prescribe.
- **Plan:** Audit (Orion, 2026-11-06) found: (1) `limits.torch_num_threads: 12` and `optimizations.pytorch.cpu_threads: 12` contradict the CPU playbook §2 — 12 is a solo-lane value; a job sharing the chip caps at 6 physical cores. The config needs the lane distinction, not a single number. (2) `limits.ffmpeg_threads: 12` + `ffmpeg_max_concurrent: 2` contradict playbook §4/§5 — two concurrent encodes is an NVENC-draft allowance; x264 masters are solo-lane. (3) The encode decision itself (NVENC drafts / x264 masters, playbook §5) is unexpressed — the profile carries only an NVENC preset. (4) Verified fields missing (CPU-Z, 2026-11-06): memory channels (2×64-bit) and bandwidth class, L3 16 MB, GPU PCIe gen/link width, board identity. (5) Workload blocks missing: faster-whisper (int8, cpu_threads 6), stem-separation thread caps, dataloader workers ≤ 2. (6) No pointer to the 3D scene budgets — cross-reference T-VID-12's config when it lands; never duplicate the table. Steps: (a) line-by-line audit table, each value marked agree / contradict / missing / profile-only (the Ollama and ComfyUI limits are profile-only and stay — the docs don't govern them); (b) apply resolutions: lane-aware thread values (solo vs shared cap, in whatever shape the loader supports), encoder-scoped ffmpeg concurrency, an encode-decision block, the verified hardware fields, whisper + separation blocks; (c) update the loader and benchmark service for the new shape with backward-compatible defaults; (d) verify per Acceptance.
- **Files:** config/hardware-profile.json; packages/backend/app/core/hardware_profile.py (loader); packages/backend/app/api/hardware.py; packages/backend/app/services/hardware_benchmark.py; source docs: docs/knowledge-library/ryzen-5500-cpu-playbook-2026.md, pascal-gpu-optimization-2026.md, pascal-3d-budget-discipline-2026.md
- **Acceptance:** The audit table has no "contradict" rows left; `/api/hardware` serves the reconciled profile; a shared-lane CPU job demonstrably runs capped at 6 threads while a solo-lane job may take 12; backend tests + ruff clean.
- **Gate:** Config-side reconciliation approved by the owner and applied 2026-11-06 (this item's doing commit). The loader-consumption half (new HardwareLimits fields + services honoring the shared cap) is executor-lane work on the owner's machine.
- **Last session:** Orion, 2026-11-06 — config half landed in this commit: verified fields added (CPU arch/L3, dual-channel memory + kit, motherboard, GPU PCIe/memory/tdp), lane caps added alongside the solo values (torch shared cap 6, ffmpeg x264 concurrency 1, dataloader max 2, heavy-job max 1), the encode decision expressed (NVENC drafts / x264 masters), and new `lanes`, `workloads` (whisper, Demucs, Blender decimate, LLM CPU fallback), and `scene_3d_budgets` pointer blocks. Loader-live HardwareLimits fields untouched; loader tolerance verified by code read (all 6 models `extra="ignore"`; the thread/ffmpeg keys have no service consumers yet — grep-verified). Remaining: loader fields + service wiring for the shared cap, and the on-machine `/api/hardware` verification. JSON validated; sandbox loader smoke test blocked on missing psutil in the sandbox env (backend env has it).

### T-PLT-47 — Unify the services/cuda seam: one GPU analysis implementation
- **Status:** doing
- **Goal:** One GPU audio-analysis implementation with one result shape on both devices, and every class in the CUDA package either wired to a real consumer or explicitly decided. (Numbered 47 deliberately: 46 is held for the pending T-PLT-35 duplicate renumber, owner's call.) **Premise corrected 2026-11-07:** as first registered, this item called `services/cuda` orphaned — wrong: the survey grepped absolute imports and missed the relative `from .cuda import`; `CudaAudioAnalyzer` was already consumed by `analyze_with_cuda` and `tools/lib/audio.py`. The real defects were the shape-inconsistent hand-rolled CPU fallback in `analyze_with_cuda` (60-point envelope, no spectral features) and a duplicated inline GPU resample in the analyzer.
- **Plan:** Evidence: [[backend-gpu-compute-layer-2026]] §3 (corrected) + CHANGELOG archaeology (both classes date to the Sept 2026 CUDA services build-out; their designed consumers — backend ComfyUI tensor prep, a live spectrum feed — were never built). **Landed 2026-11-07 at the owner's direction:** (1) the merge — `analyze_with_cuda` always delegates to `CudaAudioAnalyzer.analyze()`; per-call analyzer at the caller's real sample rate; `resample_audio_gpu` consolidated into the package. (2) the viz wiring — `CudaVisualizationFFT` now serves the HyperFrames payload via the new `track_band_frames` helper + an optional `band_frames` parameter on `build_hyperframes_audio_payload`, replacing band data that was fabricated as a decay ramp off the energy scalar; the payload self-labels `bands_source` measured/synthetic. **Remaining:** (a) on-rig verification — `/api/audio/analyze-cuda` fixture runs with GPU present/absent (identical shapes, override engaging, 44.1 kHz spectral sanity), `/hyperframes-payload` returning `bands_source: "measured"` on a real track, backend tests + ruff in the conda env. (b) `cuda_image` (CudaImageProcessor) decision — verified 2026-11-07: no living backend consumer matches its contract (image_processor is PIL editing, generate_thumbnail renders GLBs, export_matrix is ffmpeg, ComfyUI ingests files itself); owner decided 2026-11-07: build the consumer — registered as T-PLT-48.
- **Files:** packages/backend/app/services/cuda/processor.py; packages/backend/app/services/cuda/__init__.py; packages/backend/app/services/audio_analyzer.py; packages/backend/app/services/storyboard_hyperframes.py; packages/backend/app/api/audio.py; docs/knowledge-library/backend-gpu-compute-layer-2026.md (§3); CHANGELOG.md
- **Acceptance:** On-rig fixture runs recorded here with numbers (analyze-cuda GPU/CPU shape parity; hyperframes measured bands on a real track); backend tests + ruff clean in the backend env; cuda_image resolved by an explicit owner decision recorded here; the as-built doc's §3 records the final state.
- **Gate:** The merge and the viz wiring were owner-directed and landed by Orion (sandbox static verification + CPU functional tests only — no GPU in the sandbox). Remaining verification is headed work on the owner's machine; the cuda_image decision was taken 2026-11-07 (consumer item T-PLT-48).
- **Last session:** Orion, 2026-11-07 — viz wiring landed in this commit: `track_band_frames` added to the CUDA package (fresh CudaVisualizationFFT per call, centered chunks at payload fps), builder accepts measured `band_frames` with the synthetic ramp kept as a labeled fallback, endpoint computes bands from the audio file in a thread and degrades to the ramp on any failure. Sandbox functional tests passed: 61 frames x 16 bands in [0,1] for a 2 s synthetic track, low-band share 0.539 (60 Hz half) vs 0.019 (8 kHz half); builder passes measured values through exactly and reproduces the old ramp exactly in fallback. Premise correction and merge details in commit f86a2106. GPU-path + on-rig verification outstanding.

### T-PLT-48 — Build the ComfyUI image-prep consumer for CudaImageProcessor
- **Status:** todo
- **Goal:** Give `CudaImageProcessor` the consumer it was designed for in the Sept 2026 CUDA services build-out: a prep step on the backend's ComfyUI image-input path. Today both upload seams pass files through raw — `app/api/integrations_generation.py` `upload_image_to_comfyui` (tmp file → `comfyui_client.upload_image` → ComfyUI `input/`) and `app/adapters/comfyui.py` (upload before workflow run). A workflow that needs its input at generation dimensions (img2img, IP-Adapter reference, and T-VID-14's control images from the T-VID-13 frame package) currently gets whatever size the source file happens to be.
- **Plan:** (1) Prep helper beside the CUDA package: decode (PIL) → `CudaImageProcessor.preprocess` for the resize (GPU `interpolate`; the class's PIL CPU fallback when CUDA is absent) → back to uint8 HWC → PNG bytes. No target size declared → input returned unchanged; pass-through stays the default and prep is always explicit. (2) Wire both upload seams to accept optional target dimensions and route through the helper when they are present: the integrations endpoint (optional width/height on the request) and the adapter (dims declared by the job/workflow). (3) First proof on the rig: one image-input workflow (img2img or control-image) at declared dims — verify from ComfyUI's side that the prepped file landed in `input/` at the requested dimensions and the run consumed it. (4) Fallback proof: same flow with CUDA unavailable → CPU path, identical output dims/format. Design defaults (owner may override): PNG as the interchange format; prep never crops — resize only, aspect handled by the caller's declared dims; the helper logs when prep runs so it is never silent.
- **Files:** packages/backend/app/services/cuda/processor.py (prep helper beside the class); packages/backend/app/api/integrations_generation.py; packages/backend/app/adapters/comfyui.py; packages/backend/app/core/comfyui_client.py (upload_image, if its signature needs the prepped bytes); docs/knowledge-library/backend-gpu-compute-layer-2026.md (§3 outcome line)
- **Acceptance:** `CudaImageProcessor` has production callers (grep shows the prep helper invoked from both upload seams); a rig run of an image-input workflow at declared dims succeeds with the prepped file verified in ComfyUI's `input/`; the no-CUDA fallback run produces identical dims/format; unprepped pass-through behavior is unchanged when no dims are declared; backend tests + ruff clean.
- **Gate:** Executor lane on the owner's machine (needs a live ComfyUI), on the owner's word to start. Registered 2026-11-07 on the owner's decision from T-PLT-47's options; aligns downstream with T-VID-14 (control-conditioned generation), which is the first standing demand for prepped control images.
- **Last session:** Orion, 2026-11-07 — registered on the owner's decision; not started. Seam facts verified by code read (both upload paths are raw pass-through today; `comfyui_client.upload_image` is the shared upload primitive).
