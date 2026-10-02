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

### D18 — Database connections are pooled per thread
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

### D19 — Nesting depth is measured, and the worst offenders are flattened by duplication
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
  `sanitize_filename("")` raises, so it is an error. That was the test being
  wrong, not the code.

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
- **Status:** Open
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

### Q3 — ComfyUI Wan smoke test (red-pattern output)
- **Status:** In evaluation
- **Context:** Wan 2.1/2.2 two-second smoke test through ComfyUI produced only a
  red abstract pattern. `comfyui.py` was patched (model-dir resolution, T5/VAE
  existence checks, logging) but is **unverified until a real rerun produces
  valid output**. Wan requires a UMT5-family encoder — ordinary T5 is not
  interchangeable; loader menus mix Hunyuan3D and Wan entries.
- **Next step:** Rerun capturing workflow-selection line, T5/VAE warnings, and
  exact encoder/VAE/checkpoint filenames. If red output persists with correct
  UMT5, inspect the VAE/decode stage and exported workflow JSON.

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

