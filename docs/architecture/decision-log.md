# Architecture Decision Log

> **Purpose:** the persistent memory for stack and architecture decisions. Coding
> agents (Kilo, Cline, OpenCode, Codex, Antigravity, Devin) compress context and
> rotate — **start every session by reading this file** so decisions aren't
> re-litigated. Update it when a decision is made or reversed.
>
> Format: each entry has **Status** (`Decided` / `In evaluation` / `Open`),
> **Context**, **Decision**, and **Consequences**. Open questions carry a
> **Recommendation** where one exists.

---

## Decided

### D1 — Video render engine chain (2026, Phase 1 benchmarks)
- **Status:** Decided
- **Context:** Multiple compositing backends were benchmarked for the studio env.
- **Decision:** `auto` resolves **coreflux → movielite → FFmpeg**. MoviePy is
  legacy and NOT installed in the studio env. FFmpeg 8.1 is the
  always-available safety fallback (frame-accurate filter graphs).
- **Consequences:** Code: `packages/backend/app/services/video/__init__.py`
  (`get_renderer`). Never assume MoviePy exists.

### D2 — Python environment separation
- **Status:** Decided
- **Context:** Backend, ComfyUI, and music-gen have conflicting dependency needs.
- **Decision:** Three envs — `nma-studio-cuda` (backend + GPU + audio/ML),
  `comfyui-cuda` (**ComfyUI only, never backend**), `venv/` (CPU fallback).
  `tools/music-gen` gets its own isolated venv (`tools/music-gen/.venv`).
- **Consequences:** See `.python-env` for exact interpreters. Backend must run
  via `sys.executable -m demucs`, never the PATH binary.

### D3 — Audio analysis backends
- **Status:** Decided
- **Context:** Beat/tempo/energy analysis must work with and without CUDA.
- **Decision:** librosa (CPU) + CUDA-accelerated FFT (`app.services.cuda`) with
  CPU fallback; **madmom-infer + sonara** wired as working analysis backends.
- **Consequences:** Analysis payload contract is 16x smaller after the 2026
  beat/downbeat fix — don't regress `audio_analyzer.py`.

### D4 — Stem separation + transcription stack (2026-09-21)
- **Status:** Decided
- **Context:** Needed vocal/instrumental stems and lyric transcription locally.
- **Decision:** **Demucs 4.1.0** + **faster-whisper 1.2.1** (`large-v3-turbo`,
  Pascal/sm_61 → float32, Turing+ → float16). Stems auto-encode MP3 copies
  (~13% of WAV); StemMixer prefers MP3 URLs.
- **Consequences:** `POST /api/audio/separate`, `POST /api/audio/transcribe`.
- **Evaluation (2026-09-30):** Frontend `StemMixer.tsx` now handles partial
  stem-load failures per-stem instead of failing the whole mixer. CORS
  `crossOrigin` is set before `src` assignment. Unused live-metering rAF loop
  is gated behind `onLevels` prop so `StemMixerPanel` skips it. Web research
  (MDN + WebAudio spec) confirms two `AudioContext` instances (main analyser
  + stem mixer) is functional but a future optimization is to share one.

### D5 — Vision analysis workflow
- **Status:** Decided
- **Context:** Primary coding model (Step 3.7 Flash) has no vision; local Ollama
  models are VRAM-limited (one task at a time, small context).
- **Decision:** All screenshot analysis goes through the project's vision script
  (`node tools/vision/analyze.mjs`, default `gemma4:e2b-it-qat`) or
  `vision-mcp.mjs`. **Never send generic prompts** ("describe this image") —
  always mode-specific (`ui|responsive|regression|compare`) or task-specific
  prompts asking for concrete, prioritized fixes.
- **Consequences:** Agent screenshots belong in
  `packages/frontend/tests/browser/out/` (gitignored).

### D6 — Centralized port management (2026-09-10)
- **Status:** Decided
- **Context:** Backend, frontend, Go sidecars, and scripts each hardcoded ports.
- **Decision:** `config/ports.json` is the single source of truth; everything
  reads from it. Backend binds 127.0.0.1, sticky-port with dynamic increment.
- **Consequences:** `scripts/check_ports.ps1` for triage; `manage-servers.ps1`
  for stale-port recovery.

### D7 — 8GB VRAM budget as a hard constraint
- **Status:** Decided
- **Context:** Dev GPU is a GTX 1070 Ti (8GB). Cloud-GPU assumptions break the
  studio.
- **Decision:** All model choices must fit 8GB: Hunyuan3D-2mini, Wan 2.2 5B
  480p, Q4_K_M quants, Pascal-safe CTranslate2 compute types. VRAM manager
  offloads/reloads models; Ollama `keep_alive 5m` with manual enhance.
- **Consequences:** New model integrations must declare VRAM cost and an
  offload path. Serial/queue-based execution — no excessive parallelism.

### D8 — Job queue + observability backbone
- **Status:** Decided
- **Context:** Long renders + flaky adapters need durability and debuggability.
- **Decision:** FastAPI `queue_manager` with retries, dead-letter queue
  (`GET /api/jobs/dead-letter`), metrics endpoint, SSE progress; Go sidecars
  (dashboard :3847, media :3848, worker :3849, gateway :3850, ports :3851).
- **Consequences:** New long-running work goes through the queue, not ad-hoc
  threads.

### D9 — Cost estimation API + wizard integration (2026-09-29)
- **Status:** Decided
- **Context:** Users need to know local render time and VRAM before committing
  a long generation job; competitive platforms (VidMuse, MiniMax H3) surface
  cost/time upfront.
- **Decision:** Backend `POST /api/video/estimate-cost` returns
  `estimated_seconds`, `vram_estimate_mb`, `total_frames`, and optional
  `cloud_cost_usd`. Frontend wizard `Generate` step exposes an **Estimate
  Render Cost** button that calls the endpoint and shows a 4-metric card (time,
  VRAM, frames, cloud cost) without mutating job state.
- **Consequences:** `generation_estimator.py` is the single source of truth
  for time/VRAM math; wizard stays read-only until the user clicks **Generate
  Video**. Cloud pricing is opt-in per request (no default billing assumption).

### D10 — No GitHub Actions; local pre-commit hook for library validation
- **Status:** Decided
- **Context:** `tools/validate-knowledge-tags.py` guards the knowledge-library
  tag taxonomy (primary tag first, no mojibake, tracker/index agreement, LF line
  endings, vocabulary drift). It runs locally and passes, but nothing invoked it
  automatically. The repo has no `.github/` directory.
- **Decision:** **No GitHub Actions.** This project is local-first on Windows
  with heavy GPU dependencies, so hosted runners add cost and upkeep without
  covering the paths most likely to break (GPU, ComfyUI, Unity/Blender).
  Instead, enforce locally: a **pre-commit hook** (`scripts/git-hooks/pre-commit`,
  installed by `scripts/install-git-hooks.sh`) runs the validator when the staged
  changes touch `docs/knowledge-library/`. It is silent and instant (~250ms) on
  every other commit.
- **Consequences:** Run `bash scripts/install-git-hooks.sh` **once after
  cloning** — `.git/hooks` is not tracked, so a fresh clone has no hook. Re-run
  it after pulling changes to `scripts/git-hooks/`. Do not re-propose CI
  workflows without the owner asking. The hook is scoped to the knowledge library
  on purpose: it does not run pytest/pnpm/ruff, which stay explicit local runs.
  Bypass for a deliberate one-off with `git commit --no-verify`.

### D11 — Git LFS hooks are installed but track nothing
- **Status:** Decided
- **Context:** `.git/hooks` contains LFS hooks (`pre-push`, `post-commit`,
  `post-merge`, `post-checkout`) installed by `git lfs install`. The repo has
  **no** LFS configuration: no `filter=lfs` entry in `.gitattributes`, no
  `lfs.url`, no pointer files in any commit, and `git lfs ls-files` is empty.
  Each hook `exit 2`s if `git-lfs` is missing from PATH, which **blocks** the
  push or commit.
- **Decision:** **Leave them installed, do not add LFS tracking.** They cost
  nothing today, and removing them would be a change to someone else's setup
  with no benefit.
- **Consequences:** If `git-lfs` ever disappears from PATH, a commit or push
  will fail with a confusing "repository is configured for Git LFS" message
  even though nothing is tracked. Fix by reinstalling Git LFS, or by removing
  those four hook files - the repo does not need them until it actually tracks
  an LFS object. `scripts/install-git-hooks.sh` lists unmanaged hooks on every
  run, so they stay visible. If large media starts being committed, revisit
  this and either adopt LFS deliberately or drop the hooks.

### D12 — docs/knowledge/ is app-served content, not a shadow library
- **Status:** Decided
- **Context:** `docs/knowledge/` holds 8 git-tracked documents outside the
  knowledge library, 7 of them with no frontmatter at all, so every tag check
  in `tools/validate-knowledge-tags.py` has ignored them. They initially looked
  like an unfinished part of the tag migration. They are not: they are live
  application content.
- **Decision:** **Treat them as a separate doc set, not migration debt.** Do not
  retro-fit library frontmatter onto them. `docs.py` serves
  `DOCS_ROOT.rglob("*.md")` across all of `docs/`, and the frontend `DocsPage`
  parses and displays each document's `tags`; untagged documents therefore
  render with an empty tag list and cannot be found by tag search in the app.
  That is a real user-visible cost and the reason to act, but the fix is to
  decide per group, not to bulk-tag.
- **Consequences:** `python tools/docs-triage.py` groups the 65 untagged
  markdown files outside the library by disposition, so triage is six decisions
  rather than 65 files. The order reflects urgency: **app-served** (7 files in
  `docs/knowledge/`, user-visible), **production docs** (11 storyboards),
  **project docs** (21 guides/setup/api — read by path, so untagged is
  defensible), **notes and scratch** (8, archive candidates), **generated
  copies** under `packages/`, and **root/tool READMEs** (13, not library
  material). If a document in an app-served path needs to be findable by tag, it
  needs a tag - but that is a per-document call, and the two files that already
  have frontmatter there use a `unity` vocabulary the library guide does not
  define, which is further evidence this set follows its own conventions.

### D13 — docs/README.md is the documentation index; keep it honest with a check
- **Status:** Decided
- **Context:** `docs/` holds 146 tracked files across 14 directories, and a
  search for a common term returns the wrong document: `unity` hits 4
  directories, `audio` 3, `gpu` 3. The tree was not restructured. Instead it was
  measured: 88 of the 146 files are the knowledge library, and the remaining
  directories are distinct genres (guides, setup, architecture, plans,
  storyboards, notes) rather than arbitrary scattering. A `docs/README.md` map
  already existed, but it had drifted — it listed `api-database/` and `archive/`
  which do not exist, omitted `plans/`, never mentioned the 9 JSON data files in
  the library, and `AGENTS.md` did not point at it, so no agent read it first.
- **Decision:** **Keep the directory layout; make the map authoritative and
  verified.** Restructuring 146 files would break `docs.py`
  (`DOCS_ROOT.rglob("*.md")`), the frontend Docs page, and every `[[wiki-link]]`,
  for a problem that an index solves. `docs/README.md` is now that index, and
  `tools/check-docs-map.py` fails the pre-commit hook when it drifts.
- **Consequences:** Run `python tools/check-docs-map.py` after adding or removing
  a documentation directory; the pre-commit hook runs it automatically whenever
  anything under `docs/` is staged. Gitignored directories that may be absent on
  a fresh clone (`screenshots/`, `archive/`, `output/`) are allowed to be listed
  without existing. `AGENTS.md` now leads with `docs/README.md` in its bootstrap
  block and names the non-authoritative directories explicitly, so an agent
  landing on the wrong file has a stated reason to back up. If the tree ever
  needs restructuring, that is a deliberate change with a migration, not an
  accident of where files were created.

### D14 — Visualizer module decomposition over monolithic components
- **Status:** Decided
- **Context:** `Visualizer.tsx` (2,318 lines) had accumulated pure helpers,
  the canvas-capture subsystem, the Web Audio graph, track selection, preset
  application, and the whole JSX surface in one component. `Canvas2DVisualizer.tsx`
  (1,560 lines) was similar. Both mixed trivially-extractable code with genuinely
  stateful orchestration, so neither could be tested or changed safely.
- **Decision:** Split by responsibility, not by line count. Pure helpers →
  sibling modules; capture and audio-graph lifecycles → hooks that own their own
  teardown. Keep `handleSelectLibraryTrack` inline (135 lines, 23 state
  setters) — it is the track-loading coordinator, and splitting it trades real
  behavioural risk for line count alone.
- **Consequences:** Extraction is verified by diffing normalized code lines
  against `git show HEAD:`, not by "tests still pass". New visualizer work should
  go in the matching module rather than growing `Visualizer.tsx`. Only one
  `AudioContext` may exist per visualizer page (see D4);
  `useAudioGraph.ensureAudioContext` is the single creation site *within the
  visualizer*. Note: `BeatTimeline.tsx` and the `StemMixer` fallback still
  construct their own outside the visualizer — app-wide consolidation is open.

---

### D15 — Audio API split into four peer modules
- **Status:** Decided
- **Context:** `app/api/audio.py` had reached 2,746 lines with 32 routes
  spanning upload, analysis, CUDA analysis, stem separation, FFmpeg editing,
  agent profiles and file serving. Analysis helpers (the result builder, curve
  maths, visualization suggestions, section labelling) sat in the same module as
  the endpoints that call them, and `services/stem_analysis.py` imported a
  private helper back out of the API layer.
- **Decision:** Split by responsibility into four peer modules under the same
  `/api/audio` prefix: `audio.py` keeps upload, analysis endpoints, the
  in-memory cache and the JSON index; `audio_stems.py` takes separation;
  `audio_edit.py` takes extract/rename/trim/file-serving; `audio_analysis.py`
  takes the pure helpers and holds no routes. All routers are registered in
  `main.py`, so no public path, method or operation id changed (verified: 32
  routes before and after). Shared constants (`AUDIO_DIR`, `PROJECT_ROOT`,
  `ALLOWED_EXTENSIONS`, `ANALYSIS_SCHEMA_VERSION`) are mirrored per module rather
  than centralised, because importing between API modules risks a cycle and the
  duplication is three path constants.
- **Consequences:** New audio routes belong in the module matching their
  responsibility, not appended to `audio.py`; `main.py` must register all three
  routers or routes silently vanish. `find_stem_dir` now lives in
  `services/source_separation.py` — `services/` must not import from `app/api`
  (D-adjacent layering rule, verified repo-wide as zero such imports).
  `tools/snapshot-audio-routes.py --check` guards the route surface, but it
  **cannot** detect a missing import: OpenAPI is built from decorators and never
  runs a handler body, and neither `py_compile` nor a plain import resolves free
  variables. After any move under `app/api/`, call the endpoints. Extract
  dependencies with an AST free-variable pass, not grep — grep reports docstring
  mentions as usage and missed that `audio_stems.py` called none of the shared
  helpers it appeared to.

---

### D16 — One shared audio-library store feeds every audio selector
- **Status:** Decided
- **Context:** Six pages each called `listAudioFiles()` from their own
  `useEffect` and kept their own copy: ArtDirection, AudioAnalysisPage,
  KineticTypographyPage, StoryboardPage, the 3D studio's `useTrackManager`, and
  the Visualizer. That is six requests per navigation and six independent
  loading/error states. Worse, the lists did not agree: each site stripped the
  `<sha256[:8]>_` prefix with its own regex, and two forms were in use —
  `/^([0-9a-f]{8}_)+/` and `/^[0-9a-f]{8}_[0-9a-f]{8}_/`. The second requires
  *two* prefixes, so it stripped nothing from single-prefix names; **12 of the 58
  library rows rendered a raw hash in one selector and a clean name in another**.
- **Decision:** `state/audioNaming.ts` owns the naming and dedup rules as pure
  functions, and `state/audioLibraryStore.ts` (Zustand) owns the list. The store
  keeps one in-flight promise at module scope so concurrent mounters share a
  single request, and exposes entries already decorated with `displayName`,
  `optionLabel` and a folder-aware `ref`. `useAudioLibrary()` wraps it with a
  mount-time load. Selectors render `optionLabel` and never re-derive a name.
- **Consequences:** New audio selectors must consume `useAudioLibrary()` rather
  than call `listAudioFiles()`; that function now has exactly one caller (the
  store), which is the cheapest way to detect a regression — reintroduce a
  second call site and grep finds it. Rendering a track name outside a selector
  (storyboard titles, CSV lookups, shader labels) goes through `cleanTrackName`
  in `visualizerHelpers.ts`, which delegates to the same rules. Note the
  distinction that matters: `dedupeAudioFiles` collapses by *display name* and
  is a second gate behind the server, but it **cannot** collapse byte-identical
  files that have different names — only content hashing can, and that is a
  `tools/` data concern, not a rendering one.

---

### D17 — GPU telemetry retention is bounded by elapsed time, and pruning actually frees space
- **Status:** Decided
- **Context:** `storage/studio.db` reached 549 MB for a studio whose real content
  is ~50 audio files. The cause was `gpu_telemetry`: 125,889 rows holding a full
  JSON process list per snapshot (~3.5 KB each, 392.8 MB of JSON) sampled every
  30 s. Two independent defects let it run unbounded, and both were silent.
- **Decision:** Retention is driven by elapsed monotonic time, expressed as two
  pure helpers (`next_prune_time`, `prunes_due`) plus named constants in
  `diagnostics/resources.py`, so the policy is testable without an event loop.
  Pruning commits first and `VACUUM` runs afterwards on its own connection. The
  window is 7 days, matching every range the history endpoints accept.
- **Consequences:** The old guard was `int(event_loop.time()) % 1000 < 10` — a
  test unrelated to age, which fired on ~1.7% of cycles. Worse, `VACUUM` was
  called *inside* the `get_db()` transaction, where SQLite raises "cannot VACUUM
  from within a transaction"; the exception aborted the cleanup, so freed pages
  sat on the freelist and the file never shrank. This is the second time in this
  project a "works" path was never executed (`VACUUM INTO` and a prune-triggered
  compaction are the same shape). **Any code that must reclaim space must be
  proven by asserting the file shrank**, not by asserting a delete count. A
  follow-up audit of the whole sqlite layer found the *identical* defect in
  `cleanup_old_log_events` — its `finally` only closed the connection, so the
  exception still propagated and that path raised on every call deleting ≥1000
  rows. Reclaiming space is therefore only possible through `safe_vacuum()`,
  which commits first and logs rather than raises. Separately,
  `journal_mode=WAL` is set once in `init_db` rather than on each of ~113
  `get_db()` call sites, since it is a persistent database-wide property that can
  itself fail with "database is locked" while readers are active;
  `synchronous=NORMAL` and `wal_autocheckpoint` are applied per connection.
  `tools/report-db-size.py` attributes the size (it works without the `dbstat`
  vtab, which the bundled sqlite3 lacks) and `tools/compact-studio-db.py`
  applies the policy. The latter uses `VACUUM INTO` + verify + swap rather than
  an in-place `VACUUM`, so an interrupted run cannot leave a truncated database.
  Result: 549.3 MB → 50.8 MB.

---

### D18 — 2026 visualization audit: feature alignment and perceptual frequency scaling
- **Status:** Decided
- **Context:** An audit of visualizer implementations against 2026 research
  (`docs/knowledge-library/3d-visualization-best-practices-2026.md`,
  `docs/knowledge-library/visualization-effects.md`) checked Canvas2D,
  WebGL/WebGPU, 3D (R3F), and Audio-reactive subsystems.
- **Decision:**
  - Audit confirmed core 2026 research features are implemented and aligned:
    - **Canvas2D**: Rounded bars, reflections, peak indicators, integer coordinates
      (`Math.round`), DPR capping, spring-physics smoothing (`barVelocities`),
      per-drum shockwave differentiation (kick=slow/thick, snare=fast/shear, hat=flash).
    - **WebGL/WebGPU**: Detection with WebGL2 fallback, TSL post-processing, per-stem
      energy sampling, feedback framebuffers.
    - **3D (R3F)**: drei `PerformanceMonitor` with adaptive DPR, geometry/material
      disposal helpers, delta-based motion, zero per-frame `console.log` in `useFrame`.
    - **Audio-reactive**: Per-stem energy curves, drum type classification,
      frequency band mapping, beat detection.
  - Perceptual frequency scales implemented in `canvas2dHelpers.ts` (`hzToBark`,
    `hzToERB`, `hzToMel`, `barkFreqMap`, `melFreqMap`) and wired into
    `Canvas2DVisualizer.tsx` via `perceptualScale` prop (`"linear" | "log" | "bark" | "mel"`),
    providing critical-band and pitch-perception mapping matching human hearing.
  - Advanced/high-risk features explicitly remain deferred as documented (compute
    shaders with `StorageBufferAttribute`, predictive beat oscillator hooks, and
    complex genre-aware preset consolidation).
- **Consequences:** Visualizer implementations fully match 2026 research documentation.
  No code changes or monolithic refactoring needed.

---

### D19 — Database connections are pooled per thread
- **Status:** Decided
- **Context:** `get_db()` opened and closed a connection on every call, at ~113
  call sites. Measured: 0.970 ms per call against 0.006 ms for reuse — about 98%
  of the cost was opening the file and re-issuing the PRAGMAs.
- **Decision:** Connections are pooled per thread. `get_db()` borrows from the
  thread's pool and returns the connection instead of closing it;
  `_open_connection()` is the single place a connection is created, so the
  PRAGMAs are applied once rather than repeated per call site. The pool is bounded
  at 16 per thread and closed on shutdown via `close_pooled_connections()`.
- **Consequences:** Per-thread rather than a single shared connection, because
  `asyncio.to_thread` appears at 61 sites and concurrent DB work really does run
  on several threads; `check_same_thread=False` permits cross-thread use but does
  not make *concurrent* use safe. Two rules follow from reuse, and both are
  enforced by tests rather than convention. First, **a pooled connection is only
  reused while `DB_PATH` is unchanged** — the first unconditional version passed
  review and then failed 10 existing tests with "no such table", because a
  connection opened against the old file kept serving it. That is a latent
  multi-database hazard, not merely a test artefact. Second,
  `release_connection` rolls back rather than returning a mid-transaction
  connection, so a caller using `get_connection()` directly and forgetting to
  commit cannot leak a write into the next caller. Functions that close their own
  connection must use `get_connection_unpooled()`: closing a pooled one would
  leave the pool holding a dead reference. Note also that **file size is not a
  valid assertion target in WAL mode** — written pages sit in `-wal` until a
  checkpoint, so a test comparing sizes across a commit can see the file "grow"
  after a successful VACUUM. Two such tests were corrected to checkpoint first.

---

### D20 — Nesting depth is measured, and the worst offenders are flattened by duplication
- **Status:** Decided
- **Context:** `tools/report-nesting.py` measures real control-flow nesting depth
  per function by AST: **118 functions** in `packages/backend/app` sit at depth ≥ 4,
  the worst at 9. Deep nesting is a proxy for "hard to navigate", and it is
  measurable, so the candidates can be chosen by number rather than taste.
- **Decision:** Flatten where nesting is caused by *duplication* or by
  interleaving unrelated concerns — not merely because a number is high.
  `get_result` (depth 8, 10 deeply-nested returns) held two near-identical
  30-line blocks differing only in subdirectory, `kind` and timeout; it is now
  depth 3 over `_save_comfyui_asset` + `_collect_comfyui_outputs`. `get_video_models`
  (depth 8) interleaved a Wan-variant `if/elif` chain with filesystem scanning; it
  is now depth 3 over `_wan_variant_fields` + `_scan_model_dir`, with the variant
  labels as named constants.
- **Consequences:** Flattening is a behaviour-preserving refactor, so the evidence
  that matters is the route surface and the endpoints, not the diff. Refactoring
  `get_result` initially **broke the module**: an edit consumed the `def` line and
  orphaned the `@router.get("/comfyui/video-models")` decorator onto a constant,
  which is a `SyntaxError` at import. A second edit invented a `@router.get`
  that had never existed. Neither showed up in the unit tests. The route surface
  was therefore verified by building HEAD, stashing the change, and comparing
  OpenAPI: **245 paths before and after**. Any future flattening of a router file
  needs the same check — a decorator is not a line you can move freely.
  A test that assumes behaviour is a test that can be wrong: the first version
  asserted a blank filename falls through to the next candidate, but
  `sanitize_filename("")` raises, so it is an error.

  `report-nesting.py --baseline` is wired into `check-all.py`, so a function that
  gets *deeper* fails the `docs` gate and the pre-commit hook. Flattening is never
  required; only regression is. Three silent-failure modes had to be closed
  first, each found by testing the gate rather than trusting it: it passed
  vacuously when the baseline matched no functions; it passed when a file failed
  to parse, because skipping an unparseable file *lowered* the score; and its
  keys were path-dependent, so a relative and an absolute root disagreed about
  the same tree. `tools/verify-nesting-gate.py` exists so the gate is proven able
  to fail. This is the same lesson as the VACUUM and missing-import bugs:
  **a check must be shown to fail before its passing means anything.**

---

### D21 — Agent handoff portability across model providers (2026-10-02)
- **Status:** Decided
- **Context:** The coding models used on this repo rotate. The owner works
  through free promotional windows on third-party providers — current: Space
  Bunny Alpha via Cline Desktop (OpenRouter `stealth/space-bunny-alpha`,
  anonymous preview, owner unclaimed, widely fingerprinted as MiniMax M3.1);
  previous sessions used other models. Each model has different strengths,
  weaknesses, and failure modes, and a switch can happen mid-stream. Work must
  survive the switch without rediscovery, and a new model must be productive
  in its first session.
- **Decision:** The repo is provider-agnostic by design. Five rules:
  1. Instructions are behavioral, not model-specific — describe outcomes and
     constraints, never prompt hacks tuned to one model.
  2. File-based state for handoffs: this decision log, ADRs, and structured
     state files. Any agent landing fresh starts at `docs/README.md` → this
     log (already required by the AGENTS.md bootstrap).
  3. Commits carry the reasoning (the "why"), so `git log` is a guidance
     channel for the next agent, whatever model it runs.
  4. Checker/guard scripts are the model-agnostic enforcement layer — they
     verify work regardless of which model produced it. Precedents: the
     encoding guard, the route-surface snapshot, `tools/check-docs-map.py`,
     the nesting gate (`report-nesting.py --baseline` in `check-all.py`). A
     new model is onboarded by running the checkers, not by re-learning the
     repo.
  5. Per-provider behavior notes live in
     `docs/architecture/provider-notes.md`: observed strengths, weaknesses,
     and quirks per model+provider (e.g. "strong at X, weak at Y, needs
     explicit Z"). On a provider switch, append a section — do not rewrite
     the instructions.
- **Consequences:** New agent-facing docs must not assume a specific model.
  Provider notes are append-only observations, not instructions; anything that
  graduates into a rule moves to AGENTS.md or this log. The checkers are the
  stable contract across providers — if a new model cannot satisfy them, that
  is signal about the model, not a reason to weaken the check.

---

### D22 — Ollama behaviour is characterised against a live server before it is refactored
- **Status:** Decided
- **Context:** `adapters/ollama.py` is 1,470 lines and `ollama_chat` is the
  deepest function in the backend (nesting depth 9). It was left unflattened in
  D20 because it had **no tests at all**, and D20's own lesson was that
  behaviour-preserving claims need evidence rather than a clean diff.
- **Decision:** Characterise first, against a real server, then refactor.
  `tools/probe-ollama.py` observes behaviour; `tests/test_ollama_live.py` pins it
  and skips when no server is reachable.
- **Consequences:** The contract the adapter actually relies on is now written
  down rather than assumed. `think=False` **omits** the `thinking` key rather
  than returning an empty string. `tool_calls[].function.arguments` is a **dict**,
  which is what `execute_tool_call`'s `**arguments` needs — a JSON string would
  make every tool call raise `TypeError`. An unknown model raises
  `RuntimeError`; an unknown tool does **not** raise, it returns
  `"Unknown tool: <name>"`, which a caller that never inspects the result feeds
  back to the model as a successful tool result. An empty `messages` list is
  HTTP 200, so `done` alone is not evidence of a usable answer.
  Two operational facts are worth keeping. **Remote models are excluded**, and
  the exclusion is authoritative rather than a name guess: Ollama marks them with
  `remote_host`/`remote_model`, and a remote entry reports `size: 326`, which
  would otherwise win a "smallest model" sort and then fail with HTTP 402 —
  measuring the network instead of the server under test. `:cloud` is kept only as
  a fallback. Two tests pin this, one of which fails if selection ever returns a
  remote entry. And the first inference pays a **52 s model load** against 0.7 s
  warm, which is why the test fixture is module-scoped and reuses one model
  (10 passed in 2.1 s warm).
  Live tests are skipped rather than failed when Ollama is absent, because a
  missing optional service is not a defect — but `NMA_OLLAMA_TESTS=1` makes them
  required, so a verification run can insist on them.

### D23 — Motion craft lives in a pure, unit-tested vocabulary; the spec's numbers are treated as claims to verify
- **Status:** Decided
- **Context:** `app-research-gaps-2026.md` §16 recorded that 17 creative/visual
  docs covered *how to render* and none covered motion *craft*, so every
  reactive parameter shared one trigger source, one direction and one easing
  curve — an oscilloscope, not an organism. The 2026-10-02 Gemini handoff
  supplied 10 named moves with defaults. That handoff states it was written
  **without access to this repo**, so its field names are proposals, and two of
  its numeric claims are wrong (below).
- **Decision:** Implement the moves as pure functions in
  `src/features/visualizer/motion/` (D14: not in `Visualizer.tsx`), and treat
  every number in the handoff as a **claim to verify** rather than a
  specification to transcribe. Unit tests assert the spec's invariants — volume
  conservation, monotonic recovery, exact rest — not just its constants, so a
  derivation error in the source document fails here instead of shipping.
- **Corrections found by doing that:** `flareXZ` is documented as
  `1.154 (= 1/0.75, volume-preserving)`; the number is right (`1/√0.75`) but the
  derivation is not, and `1/0.75` inflates volume 33% on every kick.
  `stepAngle: 0.196` is a rounded `2π/32` and leaves a 0.011 rad seam every 32
  hats. Both are noted in the module and in the handoff's follow-ups.
- **Consequences:** The vocabulary is testable without a browser (151 assertions,
  ~0.4 s), which is what made three further bugs findable at all: an unreachable
  snap-out branch, a seconds-vs-milliseconds unit mismatch that shortened the
  release window to 1 ms, and a driver that deformed the mesh *most* in silence
  because it fed a time-since-impact curve a zero amplitude. Nothing is wired
  into a viz style yet — that mapping is per-style tuning and is deliberately
  left open rather than guessed.

### D24 — Visual restraint is a declared budget with a runtime cap, not per-mode judgement
- **Status:** Decided
- **Context:** The 2026-10-02 Canvas2D diagnosis found all four global effects
  (trail, phrase flash, beat vignette, shockwaves) drawn unconditionally in all
  13 modes, ahead of the mode's own rendering — 5-7 simultaneous large-area
  effects and no focal point. It asked where the budget should live and
  recommended "data ... reviewable in one place". The same day, a second handoff
  proposed a Parameter Modulation Hub with sidechain ducking to enforce
  "one thing at a time".
- **Decision:** The budget is **data**, keyed by mode, and the cap is enforced at
  **runtime** rather than by the size of the declaration. A mode may declare more
  effects than the cap because which ones fire is frame-dependent (`bars`
  declares three); what is forbidden is three firing at once, and
  `resolveActiveEffects` + `EFFECT_PRIORITY` guarantee that.
- **Consequences:** Adding a mode is now a deliberate act — an undeclared mode
  renders inert rather than inheriting the previous stack, which is the
  mechanical form of "do not add a 14th mode until the effect budget exists".
  The budget also forced two corrections the diagnosis only implied: `bars` was
  carrying a trail alpha the doc's allocation says it should not have, and
  shockwave *spawning* had to be gated as well as drawing (otherwise rings leak
  across a mode switch and fill the 8-ring pool).
  The Parameter Modulation Hub and sidechain ducking are **not** built. The
  budget already delivers the mechanical guarantee it was meant to provide, and
  ducking needs the per-style mapping that D23 deliberately left open.
- **Validated live (2026-10-02, browser automation).** Driven through
  `/visualizer` with real tracks. Frame-complexity SD while playing vs paused at
  the *same* audio position: **6.064 → 0.018** (331x), restoring to 6.053 on
  resume — the motion is genuinely audio-driven and reversible, not idle
  animation. Volume 0 also flattens it (SD 1.977). The *live* module served by
  Vite was imported and exercised in-page: `MAX_EFFECTS=2`,
  `VIGNETTE_ALPHA_CEILING=0.225`, **0 violations across all 13 modes**, `bars`
  capped at 2 (vignette dropped), `aurora` at 0, an unknown mode inert.
  Per the diagnosis doc's own validation rule, three track types were checked
  (dense EDM / sparse G-funk / acoustic): **16/16 distinct frames each**, SD
  4.98 / 11.53 / 13.49.
- **Open:** asymmetric band smoothing is still only *tested*, not wired into a
  mode; the AE doc's Parameter Modulation Hub / sidechain ducking and the Trap
  Nation `radial` preset are not built. A corner-pixel probe was tried as a
  trail-preservation test and **discarded as confounded** — different modes draw
  different geometry into the same corner, so it cannot separate "no trail" from
  "geometry moved". Trail behaviour remains verified by the budget table and the
  runtime resolver, not by pixels.

### D25 — The Canvas2D mode list has exactly one definition
- **Status:** Decided
- **Context:** Found by browser automation, not by reading. The live picker had
  **12 options and no `aurora`**, while `Canvas2DVisualizer` rendered aurora and
  `MODE_BUDGETS` budgeted it — an implemented, tuned, fully-tested mode no user
  could select. It was reachable only through `__VIZ_TEST__.set2DMode('aurora')`,
  which is precisely how dead UI survives a test suite. The cause was **four
  divergent copies** of the mode list: `CANVAS_2D_MODES`, an inline `useState`
  union, the `Props.mode` union, and the budget's key set.
- **Also found:** the hidden test-panel picker offered
  `value="stereo-split-bands"` — not a real mode (it is `stereo-split-bars`).
  Selecting it set state to a value no branch handles, so the canvas fell through
  every `else if` and drew nothing.
- **Decision:** `CANVAS_2D_MODES` in `visualizerHelpers.ts` is the only
  definition. The budget imports `Canvas2DMode` from it rather than redeclaring;
  `useState` uses it instead of an inline union; and **both** `<select>`s render
  `CANVAS_2D_MODES.map(...)` instead of hardcoded `<option>`s. The compact menu
  keeps short labels via `CANVAS_2D_MODE_SHORT_LABELS` (typed
  `Record<Canvas2DMode, string>`, so a missing entry is a compile error rather
  than a blank option). The `as any` casts on the mode selects and the test
  harness are gone.
- **Consequences:** Adding a 14th mode is now a one-line change in one array, and
  the 12-vs-13 drift cannot recur silently. `canvas2dModeBudget.test.ts` asserts
  the budget equals the canonical list both ways, that both label maps cover it,
  and that no label map invents a value outside it. Verified in the browser: the
  picker now offers 13 options including Aurora, the invalid value is gone, and
  selecting `aurora` / `stereo-split-bars` through the UI sets state and renders.
- **Checked and left alone:** `CANVAS_2D_MODES.slice(0, 9)` in the keyboard
  -shortcut panel is *correct*, not a magic number: the keydown handler accepts
  `k >= "1" && k <= "9"` and indexes `CANVAS_2D_MODES[Number(k) - 1]`, so keys
  1-9 cover indices 0-8 exactly. The last three modes (constellation,
  particles, aurora) are picker-only because there is no 10th digit key. The
  display and the handler agree, so there is nothing to fix.

### D26 — Test tooling must not be reachable in a production build
- **Status:** Decided
- **Context:** A full Playwright run (77 passed / 3 failed) surfaced three issues
  that were never app defects, and one that was.
- **The harness shipped to production.** `window.__VIZ_TEST__` was registered
  with no `import.meta.env.DEV` guard and was **verified present in
  `dist/assets/Visualizer-*.js`**. Anyone with a devtools console could load an
  arbitrary library track, switch render modes, and toggle layers. The Ctrl+Shift+T
  test panel — which dumps live state to the screen — was reachable in production
  for the same reason. Both are now behind `import.meta.env.DEV`, which Vite
  substitutes statically, so the block is *removed* from the production bundle
  rather than skipped at runtime. Verified: `__VIZ_TEST__` and `selectTrack` are
  both absent from the rebuilt bundle.
- **All three E2E failures had one root cause, in the test environment.** The Vite
  dev server injects `/__devtools/embedded.js`, which (a) sits above the app and
  swallowed the sidebar footer click — `sidebar.spec.ts` timed out on a button
  that Playwright itself reported as "visible, enabled and stable", because
  `elementFromPoint` at its centre returned the overlay; and (b) fetches icons
  from `https://api.iconify.design` at runtime, whose CORS errors then failed the
  two `unity.spec.ts` console assertions. Confirmed by blocking the route: all
  three pass. Fixed once in `removeDevToolOverlays()`, called from both
  `cleanupRoutes` **and** `navigateWithWait` (cleaning only in `beforeEach` is
  useless — the overlay is re-injected on every navigation).
- **Decision:** a test-only affordance that reaches production is a defect.
  Guard the harness, block dev-overlay requests in the shared helper, and treat
  "the suite fails for environmental reasons" as a test bug to fix rather than a
  flake to re-run.
- **Also fixed:** `settings.spec.ts` asserted `toBeGreaterThanOrEqual(0)` on an
  element count — true for every array, so it could never fail. It now asserts
  the control is visible and keyboard-focusable, plus a new test that every
  settings form control has an accessible name.
- **That new test immediately found a real defect**: the Ollama URL input had
  only a `placeholder`, no accessible name, while its siblings on the same page
  had `aria-label`. Fixed. A wider sweep found the same class elsewhere (search
  boxes and filter selects on `/library`, `/logs`, `/audio-analysis`,
  `/storyboards`; five inputs on `/unity`; three nameless ghost buttons), which is
  **recorded as open rather than silently fixed** — it is a broad, low-risk but
  multi-file a11y sweep and belongs in its own change.
- **Gotcha worth keeping:** `page.evaluate` bodies are transpiled as plain JS, so
  TypeScript generics inside them (`querySelectorAll<HTMLElement>(...)`) are a
  runtime syntax error that `tsc` on the spec file does not catch.

### D32 — Break the two import cycles by inverting, and check it with a gate (2026-10-02)
- **Status:** Decided
- **Context:** A request to "fix the convoluted backend" was measured before being
  acted on. It is largely **not** convoluted: 122 modules / 36,351 lines, max fan-out
  20 (`main.py`, expected for a router aggregator), only one file over 3,000 lines.
  A broad rewrite would have been high-risk and low-reward, and this repo has a
  documented history of large splits going wrong (`audio_stems.py`: "the first
  attempt at this split got it wrong twice... the route snapshot still passed,
  because OpenAPI is generated from decorators and never executes a handler body").
  The measurement did find **two real structural defects**, both invisible to
  casual reading because deferred imports hide them from the module graph:
  1. `queue.manager -> diagnostics.resources -> services.vram_manager -> queue.manager`
     — held open by an `import ... from ..diagnostics.resources` inside `enqueue`.
  2. `services.vram_manager -> adapters.ollama -> queue.manager -> ... -> vram_manager`
     — held open by **four** deferred imports, each also re-reading the adapter's
     *private* `_last_model` across a module boundary and re-implementing the same
     `"llama"` sanitisation.
  Plus one layering inversion: `services.ffmpeg_tools -> api.outputs`, a service
  reaching back into the API layer for `extract_audio_cover`.
- **Decision:** invert the dependency rather than move code around.
  - `VRAMManager.set_queue_provider()` and module-level `set_last_model_provider()`
    take that state as an argument; `main.py` (the composition root) wires both.
    `vram_manager` now imports nothing from `queue` or `adapters`.
  - `extract_audio_cover` moved to `services/media_covers.py`, with its only
    dependency, `_run_subprocess_thread`, lifted to a leaf
    `services/subprocess_runner.py`. `api/outputs.py` imports from the service.
  - **The repeated `_last_model` reads collapsed** into one `_resolve_last_model()`
    that never raises, so a broken provider degrades to the default model instead of
    failing a VRAM reload.
- **Now enforced:** `tools/check-import-cycles.py`, registered as the `arch` gate
  between `ruff` and `type`. It reports **0 cycles / 0 inversions** over 122
  modules and 267 edges. Verified by mutation, not by inspection: re-adding the
  `vram_manager -> queue.manager` edge makes it exit 1 with the exact cycle, and
  re-adding `ffmpeg_tools -> api.outputs` makes it exit 1 with the inversion.
  (A first mutation into `ffmpeg_tools -> queue.manager` correctly did **not** fail,
  because `queue.manager` does not import `ffmpeg_tools` — that edge is genuinely
  acyclic, so exit 0 was the right answer rather than a missed detection.)
- **Recorded honestly:** while moving code I inserted a `return` above the rest of
  `VRAMManager.__init__`, silently dropping **every** VRAM threshold
  (`MIN_VRAM_FOR_3D`, `MIN_VRAM_FOR_MUSIC`, `MIN_VRAM_FOR_AUDIO`, ...). Four
  existing tests caught it immediately (`AttributeError`). Ruff and an
  `app.main` import both passed, because neither constructs a `VRAMManager` —
  which is the concrete case for why pytest is excluded from the pre-push hook's
  scope but required before pushing. Thresholds now live in `_init_thresholds()`,
  called from `__init__`.
- **Deliberately not done:** `core/database.py` (3,087 lines) is the one file big
  enough to be worth splitting, but it was left alone. It is one cohesive concern,
  splitting it would touch every route, and the measurement gave no evidence of a
  defect there — the same standard that rejected the broad rewrite.

---
---

## Open questions

### Q1 — 3D path convergence: Unity vs Blender vs Three.js
- **Status:** Open
- **Context:** Three parallel 3D tracks exist: Unity MCP (`unity-project-mcp/`
  + standalone `unity-visualizer/`), Blender MCP, and the Three.js Studio
  (6 templates: Concert Stage, Cosmic Void, Equalizer Wall, Geometric City,
  Vinyl Spin, Pulse Orb). Each is a maintenance surface and a version-bump risk.
- **Options:** (a) Keep all three; (b) converge on one primary + one fallback.
- **Recommendation:** Converge. Three.js Studio is the cheapest to maintain
  (no external editor version to chase) and already beat-synced; keep Unity
  for hero renders only if it's earning its complexity. **Do not delete
  `unity-visualizer/` in any cleanup** — protected directory per AGENTS.md.

### Q2 — Automatic AI → shader fallback in the music video wizard
- **Status:** In evaluation (option (a) implemented 2026-10-06; plan-level verification outstanding)
- **Context:** The wizard's per-section generation targets ComfyUI; if ComfyUI
  is down it returns 503 and the job dies. Shader presets (genre-mapped, e.g.
  `fireCrown` → Drift Phonk) and the Canvas2D visualizer exist as *manual*
  modes only. The engine-level fallback (coreflux → movielite → FFmpeg) covers
  compositing, not visual *source*.
- **Options:** (a) Per-section `preferred` + `fallback` visual source, fallback
  auto-picked from the section's energy/genre mapping; (b) leave manual.
- **Recommendation:** (a). A failed AI section should degrade to a beat-synced
  shader render, not fail the job. This is the core "deterministic fallback for
  flaky AI assets" design goal.
- **Implementation (2026-10-06, commit `7b29d72`):** option (a) built as a
  job-level rather than per-section fallback — `services/visual_fallback.py`
  (genre/track-name/energy/BPM → preset, mirroring the frontend
  `selectVisualPreset`), `MusicVideoRequest` gains `genre`, `track_name`,
  `on_source_failure` (`auto`|`fail`), missing-adapter and VRAM-shortfall
  queue a degraded visualization job instead of 503, and the handler degrades
  a failed AI render mid-flight with `degraded` / `visual_source_used` /
  `fallback_reason` on the result. `fail` preserves the old hard-fail.
  Unverified: the plan's own `Verification` (degraded + healthy path against
  real ComfyUI) has not been run, so this stays In evaluation, not Resolved.

### Q3 — ComfyUI Wan smoke test (red-pattern output)
- **Status:** Resolved 2026-10-06 — does not reproduce on the patched path
- **Context:** Wan 2.1/2.2 two-second smoke test through ComfyUI produced only a
red abstract pattern. `comfyui.py` was patched (model-dir resolution, T5/VAE
existence checks, logging) but was **unverified until a real rerun produces
valid output**. Wan requires a UMT5-family encoder — ordinary T5 is not
interchangeable; loader menus mix Hunyuan3D and Wan entries.
- **Rerun (2026-10-06, ComfyUI started fresh on :8188, queue empty):** drove
`ComfyUIAdapter._generate_video` directly (production code path, no queue):
`ckpt=Wan2.2-TI2V-5B-Q4_K_M.gguf`, `t5=umt5_xxl_fp16.safetensors`
(fp16 preferred path — no fp8-scaled rejection), `vae=wan2.2_vae.safetensors`,
12 steps / cfg 6.0 / unipc / shift 5.0 / seed 7, 25 frames 832×480 @12fps.
Zero missing-file warnings; wall 853.7 s → `output/video/NativeMediaAI_WanGGUF_00004.gif`.
- **Measured against the 2026-09-20 red-pattern artifact (`..._00001.gif`, 81f):**
channel means went from crushed blue (R~102–128/G~89–110/**B~11–35**) to
balanced warm (R~190–202/G~167–193/B~157–182); mean interframe diff **26.06
→ 3.90** (old minimum 9.48 = every frame flickered; new maximum 9.84);
edge density 0.097 → 0.169. The old output was temporally incoherent
structured noise; the new output is a coherent, smoothly evolving render.
- **Root cause (best available):** the 9/20 artifact predates the T5/VAE
resolution patches and its exact trigger is unrecoverable from surviving
artifacts — but the two prime suspects (fp8-scaled T5 rejection, VAE
mismatch) are both closed by construction now: pre-submit existence checks
warn loudly, and `_resolve_wan_assets` prefers the fp16 encoder. If a red
pattern ever returns, the triage order is conditioning (T5) → decode (VAE)
→ convergence (steps), and `comfyui_workflow_handler.py` now writes a
debug artifact per Wan attempt so the evidence is captured at the time.

### Q4 — Visualizer mode consolidation (3D / FX / 2D)
- **Status:** Open
- **Context:** `Visualizer.tsx` toggles 3D / FX(shader) / 2D canvas as separate
  manual modes with separate preset systems (`shaderPresets.ts`,
  `AIPresetGallery`, `Canvas2DVisualizer` modes).
- **Recommendation:** Unify behind the Q2 fallback model — modes become a
  priority list, not a toggle.

### Q5 — Chroma→hue palette mapping for the shader visualizer (2026-10-01)
- **Status:** Resolved — Tier 1 implemented 2026-10-01; Tier 2 deferred
- **Resolution:** Option (a) shipped. `keyPalette.ts` (pure mapping),
  `useKeyPalette.ts`, the three uniforms wired through `ShaderCanvas.tsx` and
  `ShaderVisualizer.tsx`, and `spectralReactor` consumes them weighted by
  confidence. Verified against the spec table, the worked example, both
  thresholds, and malformed input. Option (b) is not started — it needs
  `chroma_frames` in the analyzer output.
- **What the spec got wrong:** it assumed `analysis.json` already carried
  `key_confidence_r` and `key_runner_up`. There are **two** analyzers, and only
  `tools/audio-analysis/analyze.py` emitted those fields; `tools/audio_agent_profile.py`
  — which produced the committed sample files — emitted a clamped
  `key_confidence` and no runner-up at all. That analyzer and the
  `GET /api/audio/analysis/by-filename/{filename}` response were aligned to emit
  the same key fields before Tier 1 was wired against them. Committed analysis
  files still need re-analysis; they resolve to the neutral fallback until then.
- **Context:** The shader visualizer's uniforms (`u_time`, `u_bass`, `u_mid`,
  `u_treble`, `u_beat`, `u_energy`, `u_peak`) carry energy but no harmonic
  information, so palette is arbitrary per preset. The audio-analysis pipeline
  already emits `estimated_key` ("A minor" format, Krumhansl/Pearson r) plus
  runner-up and confidence in `analysis.json` — classical DSP, no model, fits
  the deterministic-fallback design goal (Q2).
- **Options:** (a) Tier 1: three static per-track uniforms (`u_key_hue`,
  `u_key_sat`, `u_key_conf`) — pitch class → hue via circle of fifths
  (harmonically adjacent keys grade-shift smoothly), mode → saturation,
  confidence → runner-up blend / neutral fallback below r=0.4;
  (b) Tier 2: per-frame chroma (requires adding `chroma_frames` to
  `analyze.py` output) for chord-change palette shifts.
- **Recommendation:** (a) now — 3 floats, unmeasurable on the GTX 1070 Ti,
  wiring follows the existing `ShaderCanvas.tsx` uniform pattern; (b) later.
  Full spec and status: `docs/architecture/chroma-hue-mapping.md`.
- **Next step:** re-analyze the committed tracks so their keys resolve, and run
  the in-browser smoke test (GTX 1070 Ti frame-time check) still outstanding.

---

## Changelog
- 2026-10-06: LTX-2B-distilled 8GB verdict — viable. `ltxv-2b-0.9.8-distilled-fp8` (already staged on disk with the 2.3 text-projection/AV VAEs) + stock `t5-xxl-fp8` + `LTX23_video_vae` rendered 25f 768×512 in 210 s on the GTX 1070 Ti, no OOM, coherent by the Q3 frame stats (interframe 7.44, edge 0.182) — ~4× faster than Wan 2.2 Q4. Submitted raw via the ComfyUI API (UNETLoader→CLIPLoader(ltxv)→LTXVConditioning→KSampler→VAEDecode); no backend render path exists, so wiring one (`model_tiers.py` + builder) is the follow-up, not done here. Mochi/H3/CogVideoX/DreamX/MAGI-2: no weights on disk, untested. ComfyUI 0.37.0 carries 33 native LTX nodes and meets the H3 0.30+ floor, so H3 is blocked only on a quantized checkpoint.
- 2026-10-06: Q3 resolved — Wan red-pattern rerun through the production adapter path (Q4 GGUF + fp16 UMT5 + wan2.2 VAE, 12 steps/seed 7) produced a coherent 25-frame render; measured against the 9/20 artifact (interframe diff 26.06 → 3.90, blue channel uncrushed). Exact old trigger unrecoverable, both prime suspects closed by construction.
- 2026-10-06: Q2 moved Open → In evaluation — option (a) implemented and committed (`7b29d72`: `visual_fallback.py`, degraded queueing, mid-flight AI→FFmpeg degradation, `on_source_failure`); the plan's ComfyUI verification is unrun so it is not Resolved. Same pass closed two stale research markers in `app-research-gaps-2026.md`: §13 agent tool contracts (input side now enforced by `mcp_validator.py` + `POST /api/mcp/validate-tool`, all four bridges dispatch effective args; output-side schemas remain open) and §15 (Q2 plan implemented). Still genuinely open and highest-value: Q3 red-pattern root cause, the 8GB video-model sweep (LTX/Mochi/H3-quantized/DreamX/MAGI-2), Q6 lease design, and the §17/§20–22 creative-direction cluster (onboarding, VJ craft, shot language, color scripting) that would give the D23 motion vocabulary something to be driven by.
- 2026-10-02: D28 recorded — the studio is the post-production for Suno v6-mini drafts. Pipeline is mini drafts in, social-ready video out; the studio owns the audio post chain (mix polish, consistency/arrangement repair, mastering) and the visual edit, with no DAW or video editor in between. Renumbered to D28 on merge: local work had already claimed D23–D27.
  AGENTS.md bootstrap updated to D1–D28.
- 2026-10-02: model reliability tracker scaffolded under `tools/model-reliability/` — advertised-free snapshots from the OpenRouter public API and the Kilo gateway public endpoint (21 and 18 models respectively on first pull; no keys, no probing), a manual `observed.jsonl` session log seeded from owner experience, and `score.py` ranking models by recency-weighted observed reliability over advertised listings. Rationale: provider sites advertise listings, not working models — the score keeps the discovery layer (websites) separate from ground truth (real sessions). Never add synthetic probes; providers answer with account-level lockouts.
- 2026-10-02: D21 recorded — agent handoff portability across model providers. The repo is provider-agnostic by design (behavioral instructions, file-based handoff state, commits-as-guidance, checker scripts as the enforcement contract), and `docs/architecture/provider-notes.md` now collects per-provider behavior notes so a model switch doesn't require rediscovery. AGENTS.md bootstrap updated to D1–D21 / Q1–Q5.
- 2026-10-02: fixed a duplicate D18 numbering — the database-pooling entry had been labeled D18 after the visualization audit already took it. Database pooling is now D19, nesting depth D20, handoff portability D21. No content changed, only numbers.
- 2026-10-01: Q5 resolved — the shader visualizer derives its palette from the detected musical key (Tier 1 of `docs/architecture/chroma-hue-mapping.md`). Pitch class maps to hue along the circle of fifths so harmonically adjacent keys grade-shift smoothly, mode maps to saturation, and key confidence decides between a direct hue, a blend toward the runner-up, or a neutral fallback below r=0.4 that never produces a black frame. Classical DSP only, so it doubles as the deterministic fallback layer (Q2). Implementing it exposed that the repo has **two** Krumhansl key analyzers with divergent output schemas — `audio_agent_profile.py` emitted a clamped `key_confidence` and no runner-up — so the spec's assumed fields were absent from every committed analysis file; both analyzers and the analysis endpoint now emit the same key fields. Two wiring details the spec's sketch missed: the rAF loop replaces `uniformsRef.current` wholesale each frame (so static key values need a separate ref), and only the `spectralReactor` preset consumes the uniforms, with confidence as the blend weight. Tier 2 (per-frame chroma) is deferred; it needs `chroma_frames` in the analyzer output.
- 2026-10-01: D14 recorded — the visualizer frontend is decomposed into focused modules rather than held in two monolithic components. `Visualizer.tsx` (2,318 lines) and `Canvas2DVisualizer.tsx` (1,560) are now orchestration over `visualizerHelpers.ts`, `canvas2dHelpers.ts`, `components/RenderStats.tsx`, `useVisualizerRecording.ts`, and `useAudioGraph.ts`. The split was mechanical (verbatim line ranges, verified by a normalized code-line diff against `HEAD`); the one behavioural change was consolidating the Web Audio graph, which had been copy-pasted three times and had already drifted. Recording and AudioContext teardown are now owned by their hooks rather than a shared unmount effect. Within the visualizer, `useAudioGraph.ensureAudioContext()` is the only `AudioContext` creation site (D4); app-wide, `BeatTimeline.tsx` and the `StemMixer` fallback still construct their own, and consolidating those is open.
---
- 2026-10-01: D15 recorded — `app/api/audio.py` split from 2,746 lines into four peer modules under the same `/api/audio` prefix: `audio.py` (1,106; upload, analysis endpoints, in-memory cache, JSON index), `audio_stems.py` (540; separation), `audio_edit.py` (504; extract/rename/trim/file serving), `audio_analysis.py` (707; result builder, curve maths, visualization suggestions, section labelling — no routes). All three routers are registered in `main.py`; the route surface is unchanged at 32 paths (verified before and after by `tools/snapshot-audio-routes.py`). Shared constants are mirrored per module rather than centralised, because cross-imports between API modules risk a cycle and the overlap is three path constants. `find_stem_dir` moved from the API layer into `services/source_separation.py`, which owns `SEPARATION_DIR`, ending a `services/` → `app/api` import (verified repo-wide as zero remaining). Two lessons are recorded in D15 because both cost a live 500 during the work: the route snapshot cannot detect a missing import (OpenAPI is decorator-generated and never runs a handler body; `py_compile` and plain imports resolve no free variables), and grep is unreliable for extracting dependencies — it reported docstring mentions as call sites and hid that `audio_stems.py` used none of the shared helpers it appeared to. Dependencies were enumerated with an AST free-variable pass instead.
- 2026-10-02: D16 recorded — every audio selector now reads one shared store. `state/audioNaming.ts` holds the naming and dedup rules as pure functions and `state/audioLibraryStore.ts` (Zustand) holds the list, with a module-scope in-flight promise so concurrent mounters share one request; `useAudioLibrary()` wraps it with a mount-time load. Motivated by measurement, not taste: six pages each fetched `/api/audio/files` independently, and two different hash-stripping regexes were in circulation — `/^([0-9a-f]{8}_)+/` versus `/^[0-9a-f]{8}_[0-9a-f]{8}_/`. The latter requires *two* prefixes and therefore stripped nothing from single-prefix names, so 12 of 58 library rows showed a raw hash in one selector and a clean name in another. Verified live in a browser after the change: 1 network request per page instead of six, and zero dropdowns showing a raw hash or a duplicate name. A second bug surfaced during that check — four library files are byte-identical and named with a bare uuid (`ec2c1675….wav`), so they now render as `Unnamed track ec2c16`; collapsing them requires content hashing, which is a data decision, not a rendering one.
- 2026-10-02: D17 recorded — `storage/studio.db` was 549 MB for a studio whose content is ~50 audio files. `gpu_telemetry` held 125,889 rows, each storing a full JSON process list (~3.5 KB; 392.8 MB of JSON total), sampled every 30 s. Two silent defects let it grow unbounded. First, the prune guard was `int(event_loop.time()) % 1000 < 10` — unrelated to age, firing on ~1.7% of cycles (measured). Second, and worse, `cleanup_old_gpu_telemetry` called `VACUUM` inside the `get_db()` transaction, where SQLite raises "cannot VACUUM from within a transaction"; the exception aborted the cleanup, so freed pages stayed on the freelist and the file never shrank — which is why `PRAGMA freelist_count` showed only 1.2 MB reclaimable against 548 MB of "live" rows that were mostly deletable. Retention is now two pure helpers (`next_prune_time`, `prunes_due`) over monotonic time, so it is testable without an event loop; the delete commits first and `VACUUM` runs on its own connection. Result: 549.3 MB → 50.8 MB, with `integrity_check ok` and the GPU history endpoint still serving its 24 h window. The transferable lesson is recorded in D17: code that must reclaim space has to be proven by asserting the file shrank, not by asserting a delete count — the same shape as the audio.py missing-import bug in D15.
- 2026-10-02: D18 recorded — visualization audit completed against 2026 research documentation. Implementations across Canvas2D, WebGL/WebGPU, 3D (R3F), and Audio-reactive subsystems already match the 2026 best practices (rounded bars, reflections, peak indicators, integer coordinates, DPR capping, spring smoothing, drum-type shockwaves, adaptive DPR via PerformanceMonitor, disposal cleanup, delta-based motion, stem energy curves, beat detection). Added perceptual frequency scales (Bark, Mel, ERB) to `canvas2dHelpers.ts` with `perceptualScale` prop support in `Canvas2DVisualizer.tsx`. Advanced/high-risk features (compute shaders with `StorageBufferAttribute`, predictive beat hooks, complex genre-aware presets) remain explicitly deferred. No further code changes required.
- 2026-09-22: Log created from repo archaeology (README, AGENTS.md,
  `services/video/__init__.py`, recent CHANGELOG entries). Q1–Q4 opened.

- 2026-09-24: Go sidecars upgraded from the benefits deep-dive: Go Media now uses `exec.CommandContext`, per-job cancellation via `DELETE /jobs/:id`, graceful server shutdown, bounded FFmpeg concurrency, and native contract tests. Release builds use `-ldflags="-s -w"`.
- 2026-09-24: Go Worker now persists the in-memory job registry to an atomic `.go-worker-jobs.json` snapshot under `output/`, reloads it at startup, and has native persistence/path-safety tests.
- 2026-09-24: Frontend upgrade research implemented: replaced deprecated `mp4-muxer` with Mediabunny, updated WaveSurfer to 7.12.12, removed Tailwind-era Autoprefixer, added frontend Prettier, and verified Playwright 1.63.0 as the latest registry release. TypeScript 7 remains deferred because `@typescript/native` is unavailable in the configured registry.\n
- 2026-09-24: Storyboard-to-HyperFrames compiler implemented: validated `scenes`/`beats` contracts emit portable HTML compositions and manifests via `POST /api/hyperframes/compile-storyboard`; bespoke art-directed compositions remain supported as project-specific overrides.
- 2026-09-24: Frontend API contract hardening: repository-wide audit verified job, log, output, track, settings, media, audio, video, native, GPU, diagnostics, and HyperFrames methods; ComfyUI start/stop/restart now use POST; state-changing UI paths check `Response.ok`; output, track, and preset requests use the shared timeout helper.
- 2026-09-26: Vite upgraded to 8.3.1; verified build, type-check, and browser proxy. Visualizer audio worker now activates only during real playback and falls back cleanly on worker failure. Root `pnpm type-check` is the canonical TypeScript command; bare root `npx tsc` is intentionally unsupported because the root has no tsconfig.

- 2026-09-24: Ollama model routing optimized for the installed GTX 1070 Ti catalog: Gemma4 E2B is the default chat/vision model, Qwen3-VL 2B is the fast fallback, MiniCPM-V 8B remains OCR-focused, context is capped at 8192, and model VRAM metadata uses Ollama's actual byte sizes.
- 2026-09-24: Music prompt generator wired into the music-video wizard as a modal overlay in the Configure step, pre-filled from audio analysis (tempo, filename). Reused the existing standalone `MusicPromptGenerator` page component with new optional `initialTheme`/`initialTempo`/`onClose` props instead of duplicating the form.
- 2026-09-28: Mock/placeholder remediation: `ImageGenerationHandler` and `StoryboardGeneratorHandler` defaulted to real adapters instead of `mock_mode=True`. Dead `_create_placeholder_output` removed from `music_video_handler.py`. Tests explicitly opt into mock mode; `MOCK_GENERATION` env var and service-unavailability auto-mock remain intact.
- 2026-09-28: Queue hardening: `priority` column added to jobs (schema v17) with index on `(status, priority DESC, created_at ASC)`. Processor now enforces a per-handler timeout, polls for mid-flight cancellation, and reduces wakeup latency from 5s to 1s. Auto-cleanup expanded to dead-letter jobs and batch-deletes outside the in-memory lock to reduce contention.
- 2026-09-29: Competitive landscape research updated (VidMuse, MiniMax H3, LTX 2.5, DreamX-Creator, MAGI-2, MelodicPal.ai) in `docs/knowledge-library/ai-music-video-platforms-2026.md`. Cost estimation feature implemented: backend `POST /api/video/estimate-cost`, frontend `estimateRenderCost()` service, and wizard `Generate` step UI showing time, VRAM, frames, and cloud cost before generation.
- 2026-09-29: D10 recorded — no GitHub Actions. Knowledge-library validation runs via a local pre-commit hook (`scripts/git-hooks/pre-commit`, installed by `scripts/install-git-hooks.sh`) instead. Do not add CI workflows to this repo.
- 2026-09-29: D11 recorded — the four Git LFS hooks in `.git/hooks` are installed but track nothing (no `filter=lfs`, no pointer files). Left in place; note they block commits/pushes if `git-lfs` is ever missing from PATH. The hook installer now preserves and calls any pre-existing `pre-commit` rather than overwriting it, and is idempotent across re-runs.
- 2026-09-29: D12 recorded — `docs/knowledge/` is application-served content (`docs.py` rglobs all of `docs/`, and the frontend Docs page displays and searches each document's `tags`), not unfinished migration debt. `tools/docs-triage.py` groups the 65 untagged markdown files outside the library by disposition, so the decision is six group rules rather than 65 per-file calls.
- 2026-09-29: D13 recorded — the 146-file `docs/` tree keeps its layout (88 of those files are the knowledge library); `docs/README.md` is the documentation index and `tools/check-docs-map.py` fails the pre-commit hook when it drifts. The map previously listed two directories that do not exist, omitted `plans/`, ignored the library's 9 JSON data files, and was not pointed to from `AGENTS.md`.

### D27 — A 404 from the analysis endpoint is a state, not an error
- **Status:** Decided
- **Context:** Phase 0.2 of `docs/plans/studio-quality-2026-10.md`. The shader
  visualizer was passing `cleanTrackName(currentFilename)` as the API/cache key
  for `useKeyPalette` and `useSpectralTimeline`. A display string is not a lookup
  key: every uploaded file is content-addressed (`a6792f53_<name>.wav`, per the
  CHANGELOG's dedupe work), so the cleaned name 404'd for all of them and the
  spectral timeline and key palette silently never loaded. Verified live before
  the fix: `spectral-timeline` 404 for every hash-prefixed track; after: 200.
- **Decision:** split the concept in two — `trackName` (display, for the label and
  preset selection) and `trackFile` (raw library reference, for API/cache keys).
  The display rules stay in `cleanTrackName` per D16; the bug was using its output
  as an identifier, not the cleaning itself.
- **Consequences:** A display name and a cache key are no longer interchangeable at
  this boundary. Verified by loading four hash-prefixed library tracks in the
  browser: all four now fetch `spectral-timeline` successfully.
- **Also (Phase 0.3):** `classifyAnalysisResponse()` makes a 404 from the analysis
  endpoint a distinct `not-analyzed` outcome rather than an error, so the UI can
  offer "Analyze" instead of reporting a failure. A 403 or 500 remains an error —
  collapsing those into "not analyzed" would let a misconfigured proxy look like an
  ordinary unanalyzed track. One limit is recorded honestly: the browser's own
  `Failed to load resource` console line for a 4xx is emitted by the network stack
  and cannot be suppressed from application code, so the plan's "zero red console
  entries" acceptance for unanalyzed tracks is not achievable as written.

---

### D28 — The studio is the post-production for Suno v6-mini drafts (2026-10-02)
- **Status:** Decided
- **Context:** The owner's music pipeline is Suno v6-mini (free tier) →
  Native Media AI Studio → social post. v6-mini is fast and free but
  draft-grade: arrangement drift on complex prompts, no consistency pass (no
  Max Mode), no persona voices, draft-grade mix, cheesy intros on
  under-directed prompts (observed ~1/4 keeper rate on 2026-10-02). The owner
  uses only v6-mini and will not pay for Pro/Premier — the paid tier is not
  the answer to mini's limits.
- **Decision:** The studio owns everything between the raw mini draft and a
  postable social video: the audio post chain (mix polish,
  consistency/arrangement repair, mastering) **and** the visual edit
  (audio-reactive render, final composite). The owner does no video editing
  and opens no DAW. Mini is the raw-material instrument; the studio is the
  band, the mixer, and the editor.
- **Consequences:** Audio features are built as a post-production chain, not a
  nice-to-have mixer page — mini's weaknesses are the studio's requirements
  list. Prompting guidance for mini stays lean (mini drifts on overstuffed
  prompts; prioritize the most important musical decisions). The Suno v6-mini
  Templates artifact (owner-side) handles getting the best draft out of mini;
  the studio handles everything after.

---

### D29 — Abandoning a ComfyUI prompt must cancel it, and a queued prompt is not a slow prompt (2026-10-02)
- **Status:** Decided
- **Context:** ComfyUI has been unreliable for as long as this project has
  existed. It turned out not to be ComfyUI. Measured from its own `/history` on
  2026-10-02: 93 prompts, min 8.7 s, median 10.8 s, p90 20.2 s, max 163.0 s —
  and **zero** exceeded the client's 300 s timeout, while the backend logged
  `timed out after 300s` repeatedly. At the same moment `/queue` held 1 running
  (a Wan video job) and 23 pending, numbered 94–116 directly after the 93
  completed in history, with the backend holding 0 active jobs and none of those
  prompt ids appearing in any backend log.
- **Decision:** Two rules, both now enforced in the adapter and the upscale
  service.
  1. **Any exit that is not success cancels the prompt.** A waiter that raises on
     timeout and walks away leaves the prompt executing inside ComfyUI, so each
     timeout permanently lengthens the FIFO queue for later jobs — including the
     retry of the job that had just timed out. One failure makes the next slower,
     which makes the next one fail. That is the compounding behaviour that made
     ComfyUI look unreliable for a year.
  2. **A prompt that is still *queued* is not a *slow* prompt.** The image waiter
     extends its deadline once (to 1800 s) if the prompt has not started, because
     the elapsed time is then spent behind someone else's multi-minute video job.
     Timing out there would cancel a job that never got a chance to run.
  Cancellation is best-effort: a failure to cancel is logged and never replaces
  the error that explains why the job failed.
- **Wire contract (do not regress):** cancel via `GET /queue` to locate, then
  `POST /queue {"delete": [id]}`. **`DELETE /queue` returns 405 Method Not Allowed**
  on this build; an implementation that used it appeared to work, passed every
  unit test against a mocked session, and was a silent no-op against the real
  service. Only a live call caught it.
- **Consequences:** ComfyUI's queue can no longer be poisoned by our own failures.
  `comfyui_client.cancel_prompt` / `queue_depth` / `interrupt_current` are the
  supported primitives; `interrupt_current` stops whatever is *running* and is a
  last resort for a wedged worker, never a response to one slow job.
- **Open follow-up:** the 23 queued prompts found during diagnosis were not ours
  and were left running. Anything already orphaned before this change stays
  orphaned; clearing it is a separate, deliberate act.

### D30 — A resource wait must not hold the lock that guards unrelated work (2026-10-02)
- **Status:** Decided
- **Context:** `VRAMManager.begin_3d_generation` awaited `_wait_for_vram()` while
  holding `self._lock`. That wait runs up to `VRAM_WAIT_TIMEOUT` (120 s), and the
  same lock guards the begin/end of every other workload — audio analysis, music
  generation, and each of their completion handlers. So a 3D request running low on
  VRAM blocked all of them for up to two minutes, over a GPU-memory condition
  none of them had any part in. Demonstrated before fixing: with the timeout
  scaled to 2 s, `begin_audio_analysis` — pure bookkeeping — sat blocked for
  1.9 s.
- **Decision:** Resource *waits* happen outside the lock; the lock protects only
  the short bookkeeping critical sections. A poll loop that merely reads VRAM does
  not need it. Generalised to two further rules:
  - **Check before sleeping, never after.** Both the VRAM wait and the upscale
    poll charged a full poll interval to every outcome, including "already
    finished", and let the timeout overshoot its own budget by up to one interval.
    They now test first and sleep `min(interval, remaining)`, so a poll can never
    sleep past its deadline.
  - **A test must exercise the real method.** The first version of the lock test
    used a local stand-in class with the same shape; it passed against a fix that
    had been reverted, because it never called the code under test. Tests here
    drive the actual `VRAMManager.begin_3d_generation`, and a companion test
    asserts the old shape genuinely blocks, so it cannot pass for the wrong
    reason. A test that cannot fail is worse than no test.
- **Consequences:** A slow or failing VRAM wait degrades only the workload that
  asked for it.

### D31 — The queue reclaims stranded work, but never retries what cannot succeed (2026-10-02)
- **Status:** Decided
- **Context:** `/api/jobs/stats` reported `running: 25` while
  `/api/health/queue` reported `current_job_id: null` and
  `processing_rate_per_min: 0.0` — 25 jobs in `running` with nothing running, all
  `image_generation` at progress 0.0, oldest hours old, and `is_healthy: true`.
  There was no reclamation anywhere in the queue. A job only enters `RUNNING` once
  a processor claims it, so any restart, crash or dev-server reload orphaned
  whatever was in flight, permanently; `HANDLER_TIMEOUT_SECONDS` cannot help
  because it only fires while the process is alive and awaiting that job.
- **Decision:** Reclaim stranded work on both axes, and report honestly.
  - `recover_stale_running_jobs()` requeues ownerless `RUNNING` jobs with retry
    budget left and dead-letters those that exhausted it, reusing the existing
    retry semantics rather than inventing a policy. Called from `reload_from_db`
    and from a 60 s reaper tick, so the queue self-heals after a mid-life crash
    and not only on a clean deploy.
  - **A job with empty `params` is dead-lettered, not requeued.** Every registered
    handler reads its input from `job.params`, so `{}` is not a degraded run, it is
    a run with no prompt, no model and no input file. Retrying cannot succeed, and
    because the reaper runs every 60 s a requeued empty job is revived
    indefinitely. `retry_count` is deliberately *not* advanced for these: there is
    no attempt to record when the job was never attempted.
  - `quarantine_unrunnable_jobs()` sweeps `QUEUED` as well, because the reaper only
    inspects `RUNNING`.
  - `/api/health/queue` exposes `stranded_running_jobs` and folds it into
    `is_healthy`, so a wedged queue can no longer report itself healthy.
- **Consequences:** Verified live — 25 stranded jobs went to 0, with 23 requeued
  and 2 dead-lettered once retries ran out; the targeted sweep then cleared the
  rest, leaving 0 active. Both dead-letter paths avoid holding `_lock` (asyncio
  locks are not reentrant; `_move_to_dead_letter` acquires it itself) and each has
  a `wait_for` test that fails on a deadlock rather than hanging.
- **Recorded honestly:** the queue still cannot distinguish a *legitimate* long
  job from a *wedged* one — see Q6.

### Q6 — Worker lease/heartbeat, so the reaper cannot reclaim valid long work (2026-10-02)
- **Status:** Open
- **Context:** D31's reaper is age-based: a `RUNNING` job older than 15 minutes
  with no owner is reclaimed. There is no lease, heartbeat, or progress-ownership
  check, so a legitimately long job (a Wan video render) can be reclaimed while it
  is still working. This was visible during the D29 work — two `RUNNING` jobs at
  16–17 minutes triggered `stranded_running_jobs: 2` and turned health red while
  they may have been in flight.
- **Options:** (a) progress-timestamp lease — the handler refreshes a timestamp so
  only a *silent* job is reclaimed; (b) explicit lease/renew token with expiry;
  (c) raise the threshold per job type (video already gets 900 s+).
- **Recommendation:** (a) then (c). (a) closes the common case cheaply and
  distinguishes "no progress" from "slow progress", which a longer timeout cannot.
- **Related, also open:** 233 of the `image_generation` rows in the jobs table have
  empty `params`, spanning 2026-09-03 onward. `api/integrations_generation.py:574`
  builds `params={"service": ..., **request.to_adapter_params()}` and looks
  correct, so something else is enqueueing without params. Untraced; until it is,
  empty-param jobs will keep appearing and be quarantined by D31.
