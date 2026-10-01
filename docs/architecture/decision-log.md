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
- **Context:** `Visualizer.tsx` (2,361 lines) had accumulated pure helpers,
  the canvas-capture subsystem, the Web Audio graph, track selection, preset
  application, and the whole JSX surface in one component. `Canvas2DVisualizer.tsx`
  (1,560 lines) was similar. Both mixed trivially-extractable code with genuinely
  stateful orchestration, so neither could be tested or changed safely.
- **Decision:** Split by responsibility, not by line count. Pure helpers →
  sibling modules; capture and audio-graph lifecycles → hooks that own their own
  teardown. Keep `handleSelectLibraryTrack` inline (≈152 lines across 17 state
  setters) — it is the track-loading coordinator, and splitting it trades real
  behavioural risk for line count alone.
- **Consequences:** Extraction is verified by diffing normalized code lines
  against `git show HEAD:`, not by "tests still pass". New visualizer work should
  go in the matching module rather than growing `Visualizer.tsx`. Only one
  `AudioContext` may exist per page (see D4); `useAudioGraph.ensureAudioContext`
  is the single creation site.

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
- **Status:** Open
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
  Full spec: `docs/architecture/chroma-hue-mapping.md`.
- **Next step:** Windows agent implements Tier 1 wiring per the spec and runs
  the 3-track key-verification + low-confidence fallback checks.

---

## Changelog
- 2026-10-01: D14 recorded — the visualizer frontend is decomposed into focused modules rather than held in two monolithic components. `Visualizer.tsx` (2,361 lines) and `Canvas2DVisualizer.tsx` (1,560) are now orchestration over `visualizerHelpers.ts`, `canvas2dHelpers.ts`, `components/RenderStats.tsx`, `useVisualizerRecording.ts`, and `useAudioGraph.ts`. The split was mechanical (verbatim line ranges, verified by a normalized code-line diff against `HEAD`); the one behavioural change was consolidating the Web Audio graph, which had been copy-pasted three times and had already drifted. Recording and AudioContext teardown are now owned by their hooks rather than a shared unmount effect. A single shared `AudioContext` remains the rule (D4) — `ensureAudioContext()` is the only creation site.
---
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

