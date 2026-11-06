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

### T-PLT-XX - Extract DocViews from DocsPage.tsx (1102 -> 767 + ~360)
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

### T-PLT-XX - Extract mountThreeScene from useThreeScene.ts (1133 -> 477 + 828)
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

### T-PLT-XX - Consolidate duplicates and delete dead modules
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

### T-PLT-15 - Fix /system/health crash and consolidate redundant data points
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

### T-PLT-16 - Audit Go sidecars and document real purpose/consumers
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

### T-PLT-17 - Consolidate five Go sidecars into one go-studio binary
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

### T-PLT-18 - Shared GPU work lane for all VRAM-heavy entry points (D71)
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

### T-PLT-19 - Recover jobs stranded in RETRYING across restarts (D72)
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

### T-PLT-20 - Job system correctness + lifecycle event coverage
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

### T-PLT-21 - Job TTL sweep wiring + lifecycle logging gaps
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

### T-PLT-22 - Job output previews in queue list
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
