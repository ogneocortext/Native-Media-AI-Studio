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

---

## Changelog
- 2026-09-22: Log created from repo archaeology (README, AGENTS.md,
  `services/video/__init__.py`, recent CHANGELOG entries). Q1–Q4 opened.
