---
tags:
  - production
  - audio
  - tooling
  - platform-comfyui
aliases:
  - A1-A6 Media Pipeline Tooling Map
cssclasses:
  - production
date: 2026-09-29
---

# 🧰 A1–A6 Media-Pipeline Tooling Map

Concrete tooling assignments for the six adopted backlog items (A1–A6), mapped against real media-pipeline tools — not LLM-app stacks. Companion to [[ai-music-video-platforms-2026]], the market research that produced the backlog. Aligned with the Architecture Decision Log (`docs/architecture/decision-log.md`) — check D1–D9 before re-litigating any choice below.

> [!note] Guiding rule
> Every item below runs on: Python audio libs + FFmpeg + ComfyUI + a JSON shot manifest + the studio dashboard and queue. No LangChain, no RAG stack, no LLM-eval tooling. Those solve problems this pipeline doesn't have.

## A1 — Music brain (deterministic analysis/planning layer)

The free, local analysis stage. Takes an audio file, emits a JSON shot plan: tempo, beats, downbeats, sections, per-stem energy, word-level lyric timings.

- **Analysis backends (decided — D3):** librosa (CPU) + CUDA-accelerated FFT with CPU fallback; **madmom-infer + sonara** already wired as working backends. Don't regress `audio_analyzer.py`.
- **Stems + transcription (decided — D4):** **Demucs 4.1.0** + **faster-whisper 1.2.1** (`large-v3-turbo`). Already exposed as `POST /api/audio/separate` and `POST /api/audio/transcribe`. Backend must invoke via `sys.executable -m demucs`, never the PATH binary (D2).
- **Existing producer:** `tools/analyze_and_sync.py` already emits beat-synced JSON — the music brain extends this contract into the full shot plan, it doesn't replace it.
- Output contract: `shot-plan.json` — the manifest A2/A3/A6 consume.

Related: [[audio-reactive-production]], [[hyperframes-audio-reactive-2026]]

## A2 — Plan/render cost split + live per-shot cost meter

Architecture, not a library. Planning (A1) is free and local; rendering (API models or local GPU) costs money or VRAM-time. The shot manifest is the contract between them.

- **Cost API (decided — D9):** `POST /api/video/estimate-cost` returns `estimated_seconds`, `vram_estimate_mb`, `total_frames`, optional `cloud_cost_usd`. `generation_estimator.py` is the single source of truth for time/VRAM math. The wizard's Estimate Render Cost button is the existing UI surface — extend it to a per-shot breakdown against the manifest.
- **Pricing config** — per-model $/sec table from the platform research ($0.31/min MusVideo → $12–17/min Luma/Runway); see [[ai-music-video-platforms-2026]] and `credit-economics-2026.json`. Cloud pricing stays opt-in per request (D9).
- **Queue (decided — D8):** new long-running render work goes through `queue_manager` (retries, dead-letter queue, SSE progress), not ad-hoc threads. The manifest is the plan→render handoff into the queue.

## A3 — Beat-quantized assembler

Executes the shot manifest. Cuts land on beats because the *planner* snapped them (A1) — the assembler does no music analysis itself.

- **Render chain (decided — D1):** `auto` resolves **coreflux → movielite → FFmpeg**; FFmpeg 8.1 is the always-available fallback (frame-accurate filter graphs). MoviePy is legacy and NOT installed — never assume it exists.
- **FFmpeg filter graphs** — `xfade`, `zoompan`, `subtitles`/`drawtext` burn-in, `scale`/`crop`/`pad` for 16:9/9:16/1:1.
- **PyAV** — when filter graphs get unwieldy; frame-accurate Pythonic assembly.
- **Lyric burn-in** — `subtitles` filter driven by faster-whisper word timestamps (D4).

## A4 — Lyric video + Canvas as first products

Shippable products, not features — the research notes Rotor charges $24–36 per lyric video and $9 per Canvas.

- **Timing** — faster-whisper word timestamps (D4), or LRC via `synced-lyrics`/`pylrc`.
- **Render** — [[remotion-guide|Remotion]] (React programmatic video; fits the frontend; Remotion MCP is configured) or Pillow/OpenCV frame generation + FFmpeg. See also [[lyric-beat-visualization-2026]] for the deterministic beat-synced lyric approach.
- **Spotify Canvas recipe** — FFmpeg: 9:16, 720px wide, 3–8s seamless loop.

## A5 — Stem-reactive visualizer mode

Second visual mode alongside the AI-asset pipeline; doubles as the deterministic fallback when generative assets flake (see open question Q2 on automatic AI→shader fallback).

- **Demucs stems** (D4, already available via API) → per-stem RMS/energy → shader uniforms in the existing WebGL pipeline.
- Reference design: Neural Frames' 8-stem → visual-parameter mapping.
- The studio's `analyze.py` already reports RMS — extend it per stem.

Related: [[audio-reactive-production]], [[shader-color-science-2026]], [[webgl-webgpu-audio-viz-2026]]

## A6 — Per-scene model routing

A lookup table, not a framework. Scene tags from the A1 plan (energy/mood/section) → model choice: cheap/fast for long low-energy scenes, best model for hero shots (chorus, drops).

- **Local** — ComfyUI API with per-scene workflows; see [[comfyui-workflows]]. All choices must fit the 8GB VRAM hard constraint (D7): declare VRAM cost + offload path, serial execution.
- **Cloud** — **Replicate** or **fal.ai** as the single gateway: one API, many video models, per-call pricing that feeds the A2/D9 cost meter directly.
- Routing logic is a config table. LangGraph is the wrong tool — this is a dispatch map, not an agent graph.
- If scene tagging ever needs language understanding (lyric mood), run it locally via Ollama; see [[integration-ollama]].

---

*Source: platform research [[ai-music-video-platforms-2026]] (2026-09-29) plus follow-up tooling analysis. Status: proposed, not implemented — goes through the plan-approval flow.*
