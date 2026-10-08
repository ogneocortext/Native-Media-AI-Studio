---
tags:
  - research
aliases:
  - App Research Gaps 2026
  - Knowledge Gaps
  - Research Opportunities
cssclasses:
  - research-report
date: 2026-09-29
---

# 🔍 App Research Gaps & Opportunities 2026

> [!info] Scope
> This document is the canonical research-priority register. Executable test
> strategy belongs in [[e2e-test-plan-2026]]; exact MCP schemas belong in
> [[mcp-contracts-2026]].
>
> **Not every gap needs to be filled.** Each entry includes a recommendation
> on whether to research now, defer, or explicitly skip.

> [!tip] How to Use
>
> - `🔴 Research Now` — blocks progress or risks technical debt
> - `🟡 Defer` — valuable but not urgent; queue for next research sprint
> - `🟢 Monitor` — keep watching; no action needed yet

---

## 1. Video Generation Models (GTX 1070 Ti / 8GB VRAM)

### Current State

- Wan 2.2 TI2V-5B GGUF (Q4/Q5) — primary video model
- AnimateDiff SD 1.5 motion modules — secondary
- Kandinsky 5 Lite — tertiary
- `coreflux` / `movielite` / `FFmpeg` — compositing fallback chain (D1)

### Research Gaps

| Gap                                 | Why It Matters                                                                                                                                                                                                                                                                                                                                                                        | Recommendation |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **LTX Video 2.3 on 8GB**            | ✅ Viable 2026-10-06 — `ltxv-2b-0.9.8-distilled-fp8` (4.46 GB) + stock `t5-xxl-fp8` + `LTX23_video_vae` rendered 25f 768×512 in 210 s on the GTX 1070 Ti with no OOM: balanced channels, interframe diff 7.44 (coherent; cf. Wan 3.90, red-pattern 26.06), edge density 0.182. ~4× faster than Wan 2.2 Q4 (853.7 s). No backend render path exists yet — wiring one is the follow-up. **Why not LTX-2.5** (2026-10-08 note): 2.5 is the current model (native multi-shot, 4K, 50 fps, separate `ltx-2.5-video-vae-bf16` / `ltx-2.5-audio-vae-bf16`), but its smallest official transformer+Gemma-4-encoder combo is ~34 GB on disk — 16 GB cards need community GGUF quants, and 8 GB is out of reach entirely. So 2B-distilled stays the 8GB path; 2.5 is excluded by VRAM, not by quality. | ✅ Done        |
| **Mochi-1 / Mochi-2 8GB viability** | Blocked 2026-10-06 — no weights on disk (only 2 Mochi nodes in ComfyUI 0.37.0) and no smaller-variant survey done. Needs a download before any 8GB verdict.                                                                                                                                                                                                                           | 🟡 Defer       |
| **Wan 2.2 red-pattern issue (Q3)**  | ✅ Resolved 2026-10-06 — reran the smoke test through the production adapter path (Q4 GGUF + fp16 UMT5 + wan2.2 VAE, 12 steps/seed 7, 25f 832×480): coherent render, interframe diff 26.06 → 3.90 vs the 9/20 artifact, blue channel uncrushed. Old trigger unrecoverable (predates the T5/VAE patches) but both prime suspects are closed by construction.                           | ✅ Done        |
| **CogVideoX-5B quantization**       | No entry in `NON_IMAGE_CHECKPOINT_KEYWORDS` or VRAM table. 5B class model; if GGUF/Q4 works on 8GB, it's a viable alternative.                                                                                                                                                                                                                                                        | 🟡 Defer       |
| **Video quality metrics**           | No objective metric (FVD, F1-score, SSIM) in the job result. Can't tell if a "successful" generation is actually good without manual review.                                                                                                                                                                                                                                          | 🟡 Defer       |

### Suggested Research

1. ~~LTX 2.3 8GB sweep~~ — done 2026-10-06 (2B distilled fp8 viable, see §1 table). Follow-up: backend LTX render path (`model_tiers.py` entry + workflow builder mirroring `_build_wan_gguf_workflow`).
2. **Mochi variant survey**: Check if Mooch/ModelScope have smaller distilled variants. If not, skip.
3. **Wan 2.2 debug protocol**: Capture `workflow.json`, T5/VAE filenames, and `comfyui.log` on every Wan attempt. Add structured logging to `comfyui_workflow_handler.py`.
4. **Add FVD/SSIM to job result**: Use `torchmetrics` or a lightweight FVD implementation; store in `output/video/{job_id}_metrics.json`.

---

## 2. Audio Analysis Modernization

### Current State

- **librosa** (CPU) — default, reliable
- **madmom-infer** (neural, BLSTM) — bar-level precision, non-commercial weights
- **sonara** (Rust/PyO3, fast) — timbre/loudness features
- Analysis payload: 16x smaller after 2026 beat/downbeat fix

### Research Gaps

| Gap                                   | Why It Matters                                                                                                                                    | Recommendation |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **BEATs transformer**                 | Meta's BEATs (2023) outperforms librosa on beat/downbeat. No Pascal/sm_61 validation exists.                                                      | 🟡 Defer       |
| **WhisperX large-v3-turbo alignment** | Current transcription uses faster-whisper with basic word timestamps. WhisperX adds VAD filtering + forced alignment for karaoke-grade sync.      | 🟡 Defer       |
| **Real-time analysis for preview**    | All analysis is offline (full file). For live preview in Three.js Studio, need streaming FFT + onset detection on audio buffer chunks.            | 🟡 Monitor     |
| **Section detection beyond librosa**  | Current `_detect_sections` is energy-threshold heuristic. SSQ (spectral flux) or transformer-based segmentation could improve section boundaries. | 🟢 Monitor     |

### Suggested Research

1. **BEATs benchmark**: Run `compare_backends.py` against BEATs on 3 tracks (HITL, SunoV6Mini, TakeTheCrown). Compare BPM, downbeat precision, and elapsed time.
2. **WhisperX vs faster-whisper**: Benchmark word-level timestamp accuracy on 5 lyrical tracks. If WhisperX adds >100ms alignment precision, wire it as an optional backend.
3. **Real-time FFT spec**: Define contract for `analyze_chunk(audio_buffer, hop_length) -> {band_energies, onset, beat_probability}` so frontend can call it from `useAudioAnalysisWorker`.

---

## 3. Music Generation Expansion

### Current State

- **ACE-Step 1.5** (Apache-2.0) — only engine, Tier 3 on Pascal, ~6GB VRAM
- Integrated via `tools/music-gen/server.py` + `adapters/music_gen.py`
- VRAM coordination: offloads Ollama during generation

### Research Gaps

| Gap                             | Why It Matters                                                                                                                                                          | Recommendation |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Lyria 3.5 integration**       | `music_prompt_generator.py` references Lyria 3.5 as a supported platform, but no adapter exists. Google's 44.1kHz stereo model launched Jul 2026; API access may exist. | 🟡 Defer       |
| **Stable Audio Open 2**         | Stability AI's open music model. Unknown 8GB viability. If it fits, adds a non-ACE option.                                                                              | 🟡 Defer       |
| **MusicGen 2.0 / AudioGen 2.0** | Meta's newer models. Need to check if any distilled/quantized variants fit 8GB.                                                                                         | 🟢 Monitor     |
| **Multi-track output**          | ACE-Step generates full mixes. Need stems (vocals/drums/bass) for per-stem visualization mapping (D4 pipeline).                                                         | 🟡 Defer       |

### Suggested Research

1. **Lyria 3.5 API audit**: Check if `ai.google.dev` exposes a REST API or if it requires Gemini app integration. If no local API, document why it can't be wired.
2. **Stable Audio Open 2 VRAM test**: Run on 8GB with `--disable-pinned-memory` + `--force-fp16`. Record peak VRAM, generation time, and output quality.
3. **Stem separation for AI-generated audio**: Demucs 4.1.0 can separate AI-generated mixes. Document the pipeline: ACE-Step output → Demucs → stems → per-stem visualization.

---

## 4. Frontend Modernization

### Current State

- React 19.2.18, Vite (catalog:), Three.js r185, Remotion 4.0.528
- Prettier added (2026-09-24), Tailwind v4, TypeScript strict
- WaveSurfer 7.12.12, Mediabunny (replaced mp4-muxer)
- Playwright 1.63.0 for E2E

### Research Gaps

| Gap                                | Why It Matters                                                                                                                                                | Recommendation |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Vite 8 / Rolldown**              | `javascript-upgrade-research-2026.md` identifies Vite 8 + Rolldown as a potential build speed win. No benchmark exists for this project's bundle.             | 🟡 Defer       |
| **React 19 Server Components**     | The app is entirely client-rendered. RSC could reduce bundle size for data-heavy pages (queue, dashboard). But migration cost is high.                        | 🟢 Monitor     |
| **Three.js WebGPU migration**      | `three-js-studio.md` documents WebGPU/TSL patterns, but the app still forces WebGL2 (`forceWebGL: true` fallback). Need to test WebGPU path on this hardware. | 🟡 Defer       |
| **Remotion 4.x advanced features** | Using `@remotion/three`, `@remotion/transitions`, but not `@remotion/offscreencanvas` or `@remotion/lambda`. Could enable cloud rendering fallback.           | 🟡 Defer       |
| **Zustand v5 middleware**          | Using `zustand@5.0.15` but not `devtools`, `persist`, or `immer` middleware. Could improve dev UX and state hydration.                                        | 🟢 Monitor     |

### Suggested Research

1. **Vite 8 benchmark**: Build the frontend with Vite 8 + Rolldown plugin. Compare build time, bundle size, and dev server HMR speed.
2. **WebGPU smoke test**: Create a minimal `WebGPURenderer` scene in the visualizer. Test on GTX 1070 Ti (Pascal does NOT support WebGPU natively — expect software fallback or failure). Document the actual result.
3. **Remotion Lambda feasibility**: Research AWS Lambda + Remotion rendering costs for 1080p 10s clips. If <$0.10/clip, it's a viable cloud fallback for Q2 degraded path.

---

## 5. Go Sidecar Architecture

### Current State

- 5 binaries: dashboard (:3847), media (:3848), worker (:3849), gateway (:3850), ports (:3851)
- Go 1.27.0, Gin framework
- Worker persists jobs to JSON, has contract tests
- Dashboard: SSE + health
- Gateway: MCP bridge router

### Research Gaps

| Gap                               | Why It Matters                                                                                                                          | Recommendation  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Is Go earning its complexity?** | 5 processes + 5 ports + build/test overhead. Decision log Q1 recommends converging 3D paths; same logic applies here.                   | 🔴 Research Now |
| **Process supervision**           | No systemd/Docker/Supervisor config. On Windows, `Start-ThreadJob` is used in scripts, but crash recovery is manual.                    | 🟡 Defer        |
| **Inter-sidecar communication**   | Go binaries communicate over HTTP/JSON with the Python backend. Could internalize some logic (e.g., VRAM checks) to reduce round-trips. | 🟢 Monitor      |
| **Memory footprint**              | Go binaries are lightweight (~10-20MB each), but 5 × startup time adds up. No benchmark of total sidecar memory under load.             | 🟢 Monitor      |

### Suggested Research

1. **Consolidation analysis**: Map each Go binary's responsibilities. Could dashboard + gateway + ports merge into one? Could media + worker merge? Document the minimal viable set.
2. **Crash recovery test**: Kill each binary mid-job. Does the backend detect it? Does the queue retry? Document failure modes.
3. **Python alternative benchmark**: Reimplement one binary (e.g., go-ports) in FastAPI. Compare latency, memory, and code complexity.

---

## 6. Testing & Quality

### Current State

- Frontend: Playwright 1.63.0, `test`, `test:headed`, `test:debug`
- Backend: pytest, pytest-asyncio, pytest-cov, pytest-xdist
- Go: `main_test.go` for worker
- Browser tests exist under `packages/frontend/tests/browser/`
- **Playwright route-handler MIME collision fixed** (2026-09-24): `helpers.ts` now uses pathname-based matching; 13/13 health+pipeline smoke tests pass

### Research Gaps

| Gap                              | Why It Matters                                                                                                                 | Recommendation  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| **Full-pipeline E2E test**       | No test covers: upload audio → analyze → generate 3D → render → composite → export. Each piece is tested in isolation.         | 🔴 Research Now |
| **VRAM leak test**               | `vram_manager.py` offloads/loads models, but no test verifies VRAM returns to baseline after a job. OOM risk on long sessions. | 🔴 Research Now |
| **Audio/video quality metrics**  | Tests check "file exists" but not "audio is in sync" or "video has no black frames".                                           | 🟡 Defer        |
| **Playwright visual regression** | `vision-feedback` skill exists for manual screenshots, but no automated visual regression suite.                               | 🟡 Defer        |
| **Load test for queue**          | `queue_manager` is serial by design. No test for 50+ queued jobs, or concurrent API requests during render.                    | 🟡 Defer        |

### Suggested Research

1. **Pipeline E2E test**: Use Playwright to drive the frontend through a complete music video generation with a 10s test audio file. Assert: job completes, output MP4 exists, duration matches.
2. **VRAM baseline test**: Before/after each job type (3D, video, music), assert `nvidia-smi` memory returns to within 512MB of baseline.
3. **Visual regression baseline**: Capture screenshots of each page (dashboard, queue, 3D studio, visualizer) at 1280×720. Store as baseline; flag regressions.

---

## 7. Deployment & CI/CD

### Current State

- No Dockerfile, no docker-compose
- No CI configuration (GitHub Actions, etc.)
- Manual startup via PowerShell scripts
- `config/ports.json` is the single source of truth for ports (D6)

### Research Gaps

| Gap                              | Why It Matters                                                                                                                      | Recommendation |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Docker containerization**      | Current setup is deeply tied to Windows (PowerShell, `nvidia-smi`, CUDA paths). Docker would need Windows containers + GPU support. | 🟡 Defer       |
| **GitHub Actions CI**            | No CI exists. Every commit is manually verified. Risk of regressions in audio/video pipeline.                                       | 🟡 Defer       |
| **Windows service installation** | Go sidecars + backend + ComfyUI need to start on boot. No service wrapper exists.                                                   | 🟡 Defer       |
| **Update mechanism**             | No auto-update for models, adapters, or the app itself. Manual git pull + pip install.                                              | 🟢 Monitor     |

### Suggested Research

1. **Docker feasibility**: Prototype a `Dockerfile` for the backend + Go sidecars on Windows Server Core with NVIDIA Container Toolkit. Document the blockers.
2. **CI pipeline design**: Define a GitHub Actions workflow that: (a) runs `ruff check` + `pytest`, (b) builds frontend, (c) runs Playwright smoke tests against a headless backend. Does not need GPU — use mocks.
3. **Service wrapper**: Evaluate `nssm` vs `WinSW` vs PowerShell scheduled task for Windows service installation.

---

## 8. Accessibility (a11y)

### Current State

- `@axe-core/playwright` installed
- Contrast audit document exists (`design-auditing-2026.md`)
- Tailwind v4 with `@theme` and OKLCH theming
- Some focus management in React components

### Research Gaps

| Gap                            | Why It Matters                                                                                                            | Recommendation |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Full WCAG 2.2 audit**        | Only contrast has been audited. Missing: keyboard navigation, screen reader labels, focus indicators, motion preferences. | 🟡 Defer       |
| **3D studio keyboard control** | Three.js Studio relies on mouse orbit. No keyboard alternative for camera movement or object selection.                   | 🟢 Monitor     |
| **Lyrics/karaoke a11y**        | Lyric sync is visual-only. No captions track, no screen-reader announcements for active line.                             | 🟢 Monitor     |

### Suggested Research

1. **WCAG 2.2 AA checklist**: Run `axe` on every route. Document violations by severity. Prioritize: focus-visible, aria-labels on icon buttons, skip navigation.
2. **3D studio keyboard map**: Define keyboard shortcuts for camera (WASD orbit, QE zoom), object selection (Tab cycle), and visibility toggle.

---

## 9. Performance Optimization (Pascal / GTX 1070 Ti)

### Current State

- PyTorch 2.14.0+cu126 (LAST prebuilt wheel for sm_61)
- CUDA 12.4 / Driver 582.66
- VRAM manager with offload/reload
- `torch.compile` disabled (Triton requires sm_70+)

### Research Gaps

| Gap                         | Why It Matters                                                                                                                           | Recommendation |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **TensorRT on Pascal**      | TensorRT supports sm_61 up to TRT 8.6. Could accelerate Wan 2.2 and Hunyuan3D inference. No validation exists.                           | 🟡 Defer       |
| **ONNX Runtime GPU**        | ONNX Runtime supports CUDA on Pascal. Could provide faster inference than raw PyTorch for some models.                                   | 🟡 Defer       |
| **CPU offload tuning**      | Current offload is binary (all Ollama to CPU). Research: partial offload (layers), memory pool sizing, `PYTORCH_CUDA_ALLOC_CONF` tuning. | 🟢 Monitor     |
| **NVENC/NVDEC utilization** | Video decode/encode could use hardware acceleration. Current FFmpeg calls may not auto-select NVENC on Windows.                          | 🟢 Monitor     |

### Suggested Research

1. **TensorRT benchmark**: Convert Wan 2.2 GGUF to TensorRT engine. Measure VRAM, latency, and output quality vs GGUF+CTranslate2.
2. **ONNX Runtime test**: Convert a small SD 1.5 pipeline to ONNX. Test on GTX 1070 Ti. If faster, document the path.
3. **FFmpeg NVENC audit**: Run `ffmpeg -hide_banner -encoders | findstr nvenc`. Verify current `ffmpeg_tools.py` uses `h264_nvenc` when available.

---

## 10. Lyric Synchronization & Karaoke

### Current State

- `faster-whisper` transcription → word-level timestamps
- `lyric_safety.py` — contamination scanner
- `lyrics_parser.py`, `lyricsSync.ts` — LRC parsing + sync
- `LrcVizController.tsx` — karaoke-style word highlight

### Research Gaps

| Gap                           | Why It Matters                                                                                                                            | Recommendation |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **WhisperX forced alignment** | Current timestamps are word-level but not phoneme-level. Karaoke needs character/syllable timing for smooth karaoke highlight.            | 🟡 Defer       |
| **Multi-language support**    | Lyric safety scanner is English-only (`_INSTRUCTION_PATTERNS`, `_PRODUCTION_WORDS`). Suno v6 and Lyria support non-English lyrics.        | 🟡 Defer       |
| **Remotion lyric renderer**   | No Remotion component for karaoke-style timed lyrics. Could reuse `@remotion/captions` but it's designed for subtitles, not music lyrics. | 🟢 Monitor     |

### Suggested Research

1. **WhisperX alignment test**: Run on 5 lyrical tracks. Compare word timestamps to faster-whisper. If WhisperX adds <50ms precision, add it as optional backend.
2. **Multi-language lyric safety**: Extract `_INSTRUCTION_PATTERNS` and `_PRODUCTION_WORDS` to JSON per language. Start with Spanish + Japanese (common Suno outputs).
3. **Remotion karaoke component**: Prototype `<KaraokeLine>` using `@remotion/captions` + `useCurrentFrame`. Render a 10s test clip and measure accuracy.

---

## 11. HyperFrames Integration

### Current State

- `packages/video-editor/` — Remotion 4.0.528 project with compositions
- `HyperFramesPage.tsx` — preview/render trigger
- `tools/hyperframes-test/` — test project
- `docs/knowledge-library/` has no HyperFrames research doc

### Research Gaps

| Gap                                   | Why It Matters                                                                                                      | Recommendation |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Storyboard → HyperFrames pipeline** | Storyboards are generated as JSON. No automated path converts storyboard scenes into HyperFrames HTML compositions. | 🟡 Defer       |
| **HyperFrames + Three.js**            | `@remotion/three` exists but HyperFrames uses its own runtime adapter. Need to verify Three.js scene reuse.         | 🟢 Monitor     |
| **Render farm fallback**              | HyperFrames supports Lambda + Cloud Run. Could be the cloud fallback for Q2 when local GPU is saturated.            | 🟡 Defer       |

### Suggested Research

1. **Storyboard compiler**: Write `tools/hyperframes/compile_storyboard.py` that reads `output/storyboards/*.json` and emits a `tools/hyperframes-test/index.html` with one `<hf-clip>` per scene.
2. **Lambda cost model**: Render 10s 1080p clip on Lambda. Record cost, queue time, and quality. Compare to local FFmpeg fallback.

---

## 12. WebGPU Compute (Beyond Rendering)

### Current State

- `visualizer/webgpu/` directory exists
- TSL compute particles documented in `visualization-effects.md`
- WebGPU is async-init; WebGL2 is the current forced fallback

### Research Gaps

| Gap                                  | Why It Matters                                                                                                                                                         | Recommendation |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **WebGPU audio analysis in browser** | Current audio analysis is Python-only (librosa). If WebGPU compute can run FFT/onset detection in the browser, the backend audio service becomes optional for preview. | 🟢 Monitor     |
| **WebGPU video encoding**            | WebCodecs API exists but WebGPU video encoding is nascent. Could enable browser-side MP4 export without FFmpeg.                                                        | 🟢 Monitor     |
| **Pascal WebGPU support**            | GTX 1070 Ti does NOT support WebGPU natively. Browser will fall back to WebGL2 or software. Research is only relevant for future GPU upgrades.                         | 🟢 Monitor     |

### Suggested Research

1. **WebGPU audio FFT benchmark**: Implement `AnalyserNode`-equivalent in WGSL compute shader. Compare latency to native `AnalyserNode.getByteFrequencyData()`. Document result — likely slower on CPU-bound audio, but useful for GPU-bound visualizers.
2. **WebCodecs + VideoEncoder**: Encode a 10s canvas recording to MP4 in the browser. Compare file size and quality to FFmpeg.

---

## 13. Agent Orchestration

### Current State

- Kilo Code with MCP servers (Blender, Context7, Ollama, Unity, etc.)
- `unity-mcp-bridge.mjs` exposes 100+ Unity commands
- `blender-mcp` addon v1.5
- Agent screenshots in `packages/frontend/tests/browser/out/`

### Research Gaps

| Gap                        | Why It Matters                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Recommendation |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Agent prompt contracts** | ✅ Done 2026-10-06 — input-side contracts now enforced in code: `packages/backend/app/services/mcp_validator.py` holds a JSON-Schema-subset registry per in-repo tool, `POST /api/mcp/validate-tool` exposes it over HTTP, and all four bridges (`ollama`, `vision`, `unity`, `hyperframes`) validate then dispatch the effective args; unknown (upstream) tools pass through. Remaining: _output_-side contracts are still undescribed — no schema for what a tool returns. | ✅ Done        |
| **Multi-agent pipeline**   | Current flow is single-agent sequential: analyze → generate → render. Could parallelize (analyze + 3D gen + prompt gen simultaneously).                                                                                                                                                                                                                                                                                                                                      | 🟡 Defer       |
| **Vision feedback loop**   | `vision-feedback` skill captures screenshots → Ollama → fixes. No structured schema for "what to look for" vs "what to fix".                                                                                                                                                                                                                                                                                                                                                 | 🟡 Defer       |

### Suggested Research

1. ~~MCP tool contract standard~~ — input side done 2026-10-06 (see §13 table; registry lives in `mcp_validator.py`, not in `mcp-contracts.md`). Open follow-up: output-side schemas per tool.
2. **Parallel agent experiment**: Run 3 agents in parallel for a single track: (a) audio analysis, (b) 3D asset generation, (c) prompt engineering. Measure wall-clock time vs sequential.

---

## 14. Data Management & Observability

### Current State

- SQLite for job persistence (`storage/queue/`)
- JSON sidecars for outputs (`output/video/*.json`)
- OpenTelemetry for backend tracing
- `go-worker` persists jobs to atomic JSON
- Benchmark history in SQLite

### Research Gaps

| Gap                         | Why It Matters                                                                                                                                           | Recommendation |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **SQLite scaling**          | Serial queue + SQLite works for 1-user local dev. If the app ever gets multi-user, SQLite becomes a bottleneck.                                          | 🟢 Monitor     |
| **Benchmark data analysis** | `output/ollama-benchmarks.json` + `hardware_benchmark` runs are stored but never aggregated. No dashboard for "which model is fastest on this hardware". | 🟡 Defer       |
| **Log retention policy**    | `output/logs/` grows unbounded. No rotation, no retention policy.                                                                                        | 🟡 Defer       |

### Suggested Research

1. **PostgreSQL migration path**: If multi-user is ever needed, document the schema migration from SQLite to PostgreSQL. No implementation needed now.
2. **Benchmark dashboard**: Build a small frontend page that reads `ollama-benchmarks.json` + `hardware_benchmark` history and shows "fastest model" + "VRAM trend" charts.
3. **Log rotation**: Implement `logging.handlers.RotatingFileHandler` with 10MB × 5 backups. Document in `docs/guides/`.

---

## 15. Knowledge Maintenance

### Current State

- 57 docs in `docs/knowledge-library/`
- 8 docs in `docs/knowledge/` (older, some pre-2026)
- Decision log D1-D8, Q1-Q4
- `ENHANCEMENT_RECOMMENDATIONS.md` exists but is not linked from index

### Research Gaps

| Gap                               | Why It Matters                                                                                                                                                                                                                                                                                                         | Recommendation |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Stale doc detection**           | `docs/knowledge/three-js-studio.md` was compiled 2026-09-15 but the code has evolved. No process to flag stale docs.                                                                                                                                                                                                   | 🟡 Defer       |
| **Cross-reference rot**           | Wiki-links like `[[video-generation-vram-2026]]` may break if files are renamed. No link checker exists.                                                                                                                                                                                                               | 🟢 Monitor     |
| **Research → implementation gap** | ✅ Q2 half done 2026-10-06 — `docs/plans/q2-auto-fallback.md` option (a) is implemented and committed; its plan-level `Verification` (degraded + healthy path against real ComfyUI) is still unrun. The other half stands: other approved plans may exist unimplemented — `docs/plans/STATUS.md` still does not exist. | 🟡 Defer       |

### Suggested Research

1. **Doc staleness audit**: Compare `docs/knowledge/*.md` compile dates to git log for referenced files. Flag docs where referenced code changed >30 days after doc date.
2. **Plan status dashboard**: Add a `docs/plans/STATUS.md` table: plan name, status, implementation %, last verified date.

---

## 16. Motion Design for Audio-Reactive Visuals

### Current State

- 17 creative/visual docs cover shaders, particles, WebGL/WebGPU, Three.js —
  all **technical** (how to render), none on motion **craft** (how to move)
- Existing mappings are energy→transform (bass→scale, mids→rotation,
  highs→glitch per 2026-09-30 Gemini guidance) with exponential smoothing
- No vocabulary for easing choreography, anticipation, or structural arcs

### Research Gaps

| Gap                                       | Why It Matters                                                                                                                                                     | Recommendation                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| **Animation principles for reactive viz** | Disney's 12 principles (anticipation, follow-through, staging…) were built for exactly this: making motion feel alive. None are documented for audio-reactive use. | ✅ Done — handoff 2026-10-02                  |
| **Easing choreography per section**       | Everything pulsing on the kick is the #1 amateur tell. No guidance on easing selection across verse/chorus/bridge.                                                 | ✅ Done — `SECTION_EASING`                    |
| **Tension/release arcs**                  | Reactive visuals with no rests exhaust the viewer. No research on when NOT to react.                                                                               | ✅ Done — `preDropFreeze`, `shouldGateMotion` |
| **Motion vocabulary spec**                | No named, parameterized "moves" a coding agent can implement directly.                                                                                             | ✅ Done — 10 moves in `motion/`               |

### Implementation status (2026-10-02)

The Gemini pass returned 10 implementable moves; all ten are implemented in
`packages/frontend/src/features/visualizer/motion/` with 151 unit assertions, plus
the sectional easing palette, the impulse-decay trigger (amateur tell #1) and the
motion gates. See `docs/architecture/visualizer.md` for the module map and the
rules for extending it.

Two spec corrections were needed and are worth knowing before the doc is re-read:

1. **`flareXZ` derivation.** The spec writes `1.154 (= 1/0.75, volume-preserving)`.
   The number is right (`1/√0.75 = 1.1547`); the derivation is not — `1/0.75` is
   1.333, which inflates volume by 33% on every kick. `volumePreservingFlare()`
   derives it as `1/√compressionY` so the property holds for any compression.
2. **`stepAngle` precision.** The spec's `0.196` rad (32 steps/rev) drifts: 32
   steps land 0.011 rad short of a full turn, repeating a visible seam every 32
   hats. The default is now exactly `2π/32`.

Remaining (deliberately not done): per-viz-style tuning of the `MotionInput`
mapping, and the A/B screenshot validation below — the moves are unit-tested but
not yet confirmed on screen against the existing styles.

### Suggested Research

1. ~~Gemini pass~~ — delivered 2026-10-02 (see `app-research-gaps-2026.md` §16).
2. **Validate against visualizer**: pick 2 existing viz styles, apply one motion
   principle each (e.g., beat-anticipation swell), A/B via screenshot.

## 17. Onboarding & First-Run UX for Creative Tools

### Current State

- `design-philosophy-2026.md` (P1–P6), UX audit report exist — principles and findings, not onboarding flows
- No research on empty states, guided first project, or progressive disclosure across the app
- The 2026-10-02 stem-mixer brief proved the "30-second workflow" lens works; it has never been applied app-wide

### Research Gaps

| Gap                                   | Why It Matters                                                                                     | Recommendation  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------- |
| **Creative-tool onboarding patterns** | How CapCut/DaVinci/Resolve onboard without tutorials-from-hell. Nothing in the library.            | 🔴 Research Now |
| **Empty states & first project**      | A new user with one uploaded track currently faces the full dashboard. No designed first-run path. | 🔴 Research Now |
| **Progressive disclosure system**     | P6 established bounded consistency for visuals; no equivalent system for feature disclosure.       | 🟡 Defer        |

### Suggested Research

1. **Teardown 3 creative tools' first-run**: record the first 5 minutes of CapCut, DaVinci Resolve, and one AI video tool. Extract: time-to-first-output, number of decisions forced, disclosure patterns.
2. **Draft the studio's 5-minute path**: upload track → auto-analysis → one suggested visual → preview → render. One page, no new code.

## 18. Information Architecture & Navigation

### Current State

- `feature-utilization-audit-2026.md` found false-confidence dead code and orphaned capabilities — IA sprawl symptoms
- 146 files / 14 doc dirs (AGENTS.md); app surface grown over a year with no IA review on record

### Research Gaps

| Gap                    | Why It Matters                                                                              | Recommendation |
| ---------------------- | ------------------------------------------------------------------------------------------- | -------------- |
| **Job mapping (JTBD)** | "Convoluted" usually means the app serves 6 jobs through one navigation. No job map exists. | 🟡 Defer       |
| **IA audit method**    | No card-sort/tree-test baseline for the current nav.                                        | 🟡 Defer       |

### Suggested Research

1. **List every top-level screen + its job** in one table; flag screens serving 2+ jobs as merge/split candidates.
2. **Dead-code tie-in**: cross-reference the feature-utilization audit's orphaned capabilities — orphans are IA candidates for removal, not just code deletion.

## 19. Perceived Performance & Progress Communication

### Current State

- `notification-system-improvements-2026.md`, P2 honest async/queue states — infrastructure for feedback exists
- No research on the **psychology** of waiting: what makes a 40 s Demucs run feel fine vs. broken

### Research Gaps

| Gap                                 | Why It Matters                                                                                | Recommendation |
| ----------------------------------- | --------------------------------------------------------------------------------------------- | -------------- |
| **Progress communication patterns** | Determinate vs. indeterminate, staged progress, time-remaining honesty for GPU jobs.          | 🟡 Defer       |
| **Optimistic UI / skeletons**       | Long renders with blank screens read as "crashed". No skeleton/placeholder system researched. | 🟡 Defer       |

### Suggested Research

1. **Audit the 3 longest waits** (Demucs extraction, 3D render, Remotion composite): what does the user see at 0%, 50%, stall? Spec the fix per wait.
2. **Staged progress contract**: every job reports named stages (not just %), so "Separating… 42%" becomes "Separating vocals… 42%".

## 20. VJ Performance Culture

### Current State

- Sep 30 Gemini guidance included TouchDesigner tutorials — tooling, not discipline
- No docs on VJ practice as a craft

### Research Gaps

| Gap                          | Why It Matters                                                                                                                                                                    | Recommendation |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **VJ set craft**             | VJs have 20+ years of practice in live audio-reactive visuals: clip mixing, effects chains, reading energy, builds/drops. Directly applicable to making visuals feel "immersive". | 🟡 Defer       |
| **Resolume/VDMX techniques** | Layer compositing, BPM-synced effects, performance workflows adaptable to precomputed timelines.                                                                                  | 🟢 Monitor     |

### Suggested Research

1. **Survey VJ technique literature**: extract 10 transferable techniques (e.g., layer crossfade on section change, strobe discipline, blackout-as-punctuation).
2. **Map to existing viz**: which 3 techniques could be expressed as preset "moves" in the current visualizer?

## 21. Music-Video Directing & Cinematography Craft

### Current State

- `music-video-production` guide covers workflow; A1 backlog item wants a JSON shot plan
- `audio_analysis.py` detects sections — but nothing maps sections to **visual direction**

### Research Gaps

| Gap                      | Why It Matters                                                                                                                                     | Recommendation |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Shot language**        | Cuts on beats, camera moves, visual narrative arcs across verse/chorus/bridge. The missing layer between "sections detected" and "video directed". | 🟡 Defer       |
| **Generative directing** | How AI video tools maintain visual continuity across shots (character/object persistence).                                                         | 🟡 Defer       |

### Suggested Research

1. **Shot-plan schema**: extend the A1 JSON shot plan with directing fields (shot size, camera move, cut trigger: beat/section/lyric).
2. **Continuity survey**: how current AI video tools keep a character/scene consistent across cuts; what's feasible on 8 GB local.

## 22. Color Scripting & Emotional Arcs

### Current State

- `color-strategy-2026.md`, `shader-color-science-2026.md`, `dark-ui-color-system-2026.md`, chroma→hue mapping (Q5) — all **technical** color
- Nothing on color as art direction

### Research Gaps

| Gap                      | Why It Matters                                                                                                                     | Recommendation |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Emotional color arcs** | Pixar-style color scripts map story beats to palettes. Music has the same beats (verse/chorus/bridge); no mapping research exists. | 🟢 Monitor     |
| **Palette←→music mood**  | Genre/mood → palette systems for generative visuals.                                                                               | 🟢 Monitor     |

### Suggested Research

1. **When motion-design lands**: pair each song-section type with a palette-shift rule (e.g., chorus = +saturation/+warmth) as part of the motion vocabulary.

## Prioritized Research Backlog

| Priority | Item                                          | Owner       | Effort | Impact                                                                                                                                                             |
| -------- | --------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0       | Wan 2.2 red-pattern root cause (Q3)           | Backend     | 2-4h   | ✅ Resolved 2026-10-06: coherent render on rerun, does not reproduce                                                                                               |
| P0       | Agent MCP tool contracts                      | Fullstack   | 4-8h   | ✅ Published mcp-contracts-2026.md; input side now enforced in code (`mcp_validator.py` + `POST /api/mcp/validate-tool`, all four bridges dispatch effective args) |
| P1       | Full-pipeline E2E test                        | Fullstack   | 4-8h   | ✅ P1a Playwright smoke unblocked (MIME fix); 13/13 health+pipeline tests pass                                                                                     |
| P1       | VRAM leak test                                | Backend     | 2-4h   | ✅ 3 baseline/leak tests added; 9/9 pass                                                                                                                           |
| P1       | Video model sweep (LTX, Mochi)                | Backend     | 4-8h   | ✅ LTX half done 2026-10-06 (2B distilled viable, 210 s/25f); Mochi blocked on weights; backend LTX path not yet wired                                             |
| P2       | Go sidecar consolidation analysis             | Backend     | 4-6h   | Reduces ops burden                                                                                                                                                 |
| P2       | Benchmark dashboard                           | Frontend    | 4-8h   | Improves UX                                                                                                                                                        |
| P2       | WhisperX alignment test                       | Backend     | 2-4h   | Better karaoke                                                                                                                                                     |
| P3       | Vite 8 / Rolldown benchmark                   | Frontend    | 2-4h   | Build speed                                                                                                                                                        |
| P3       | WebGPU smoke test                             | Frontend    | 2-4h   | Future-proofing                                                                                                                                                    |
| P3       | Docker feasibility                            | DevOps      | 4-8h   | Deployment                                                                                                                                                         |
| P1       | Motion design vocabulary (Gemini pass)        | Research    | 2-4h   | Directly addresses "unengaging visuals"; implementable moves for the local agent                                                                                   |
| P1       | Creative-tool onboarding teardown             | Research/UX | 4-6h   | Directly addresses "clunky"; 5-minute first-run path spec                                                                                                          |
| P2       | IA job-mapping audit                          | UX          | 2-4h   | Deconvolute navigation; pairs with feature-utilization audit                                                                                                       |
| P2       | Perceived-performance audit (3 longest waits) | Frontend    | 2-4h   | Makes GPU waits feel intentional                                                                                                                                   |
| P2       | VJ technique survey (10 transferable)         | Research    | 3-5h   | Immersive-visual craft                                                                                                                                             |
| P2       | Shot-plan schema v2 (directing fields)        | Backend     | 3-5h   | Feeds A1 JSON shot plan                                                                                                                                            |
| P3       | Color-scripting rules per section             | Research    | 2-3h   | Pair with motion vocabulary when it lands                                                                                                                          |

---

## See Also

- [[../architecture/decision-log.md|Architecture Decision Log]] — Q1 (3D convergence), Q2 (auto fallback), Q3 (Wan red pattern), Q4 (visualizer modes)
- [[stack-extensions-2026]] — Optional languages + high-value tools
- [[cuda-pytorch-directx-upgrades-2026]] — Upgrade recommendations for current stack
- [[pascal-gpu-optimization-2026]] — GTX 1070 Ti constraints
- [[javascript-upgrade-research-2026]] — Frontend modernization paths
- [[go-benefits-deep-dive-2026]] — Go sidecar rationale

---

_Last updated: 2026-10-06_ (§13/§15 flipped to done: MCP input contracts + Q2 implementation landed; Q2 plan verification and output-side contracts remain open. Q3 resolved same day: Wan red pattern does not reproduce on the patched path. LTX sweep same day: 2B distilled fp8 viable on 8GB, 210 s/25f.)
