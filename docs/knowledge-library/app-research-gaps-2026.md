---
tags:
  - research
  - roadmap
  - knowledge-gap
  - optimization
  - 2026
aliases:
  - App Research Gaps 2026
  - Knowledge Gaps
  - Research Opportunities
cssclasses:
  - research
date: 2026-09-24
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

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **LTX Video 2.3 on 8GB** | Current `model_tiers.py` lists LTX at 8-16GB; no validated 8GB config exists. If quantized variants or CPU-offload paths exist, this could be a quality leap. | 🔴 Research Now |
| **Mochi-1 / Mochi-2 8GB viability** | Not in `VRAM_REQUIREMENTS` at all. 2026's other notable open-weight video model may have smaller variants or GGUF paths. | 🔴 Research Now |
| **Wan 2.2 red-pattern issue (Q3)** | ComfyUI Wan smoke test produces red abstract output. Root cause unknown — could be VAE, T5 encoder mismatch, or workflow JSON corruption. Blocks all Wan validation. | 🔴 Research Now |
| **CogVideoX-5B quantization** | No entry in `NON_IMAGE_CHECKPOINT_KEYWORDS` or VRAM table. 5B class model; if GGUF/Q4 works on 8GB, it's a viable alternative. | 🟡 Defer |
| **Video quality metrics** | No objective metric (FVD, F1-score, SSIM) in the job result. Can't tell if a "successful" generation is actually good without manual review. | 🟡 Defer |

### Suggested Research

1. **LTX 2.3 8GB sweep**: Test with `--disable-pinned-memory`, `--force-fp16`, CPU T5 offload, and Q4 quantization paths. Document exact VRAM, sample count, and output quality.
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

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **BEATs transformer** | Meta's BEATs (2023) outperforms librosa on beat/downbeat. No Pascal/sm_61 validation exists. | 🟡 Defer |
| **WhisperX large-v3-turbo alignment** | Current transcription uses faster-whisper with basic word timestamps. WhisperX adds VAD filtering + forced alignment for karaoke-grade sync. | 🟡 Defer |
| **Real-time analysis for preview** | All analysis is offline (full file). For live preview in Three.js Studio, need streaming FFT + onset detection on audio buffer chunks. | 🟡 Monitor |
| **Section detection beyond librosa** | Current `_detect_sections` is energy-threshold heuristic. SSQ (spectral flux) or transformer-based segmentation could improve section boundaries. | 🟢 Monitor |

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

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **Lyria 3.5 integration** | `music_prompt_generator.py` references Lyria 3.5 as a supported platform, but no adapter exists. Google's 44.1kHz stereo model launched Jul 2026; API access may exist. | 🟡 Defer |
| **Stable Audio Open 2** | Stability AI's open music model. Unknown 8GB viability. If it fits, adds a non-ACE option. | 🟡 Defer |
| **MusicGen 2.0 / AudioGen 2.0** | Meta's newer models. Need to check if any distilled/quantized variants fit 8GB. | 🟢 Monitor |
| **Multi-track output** | ACE-Step generates full mixes. Need stems (vocals/drums/bass) for per-stem visualization mapping (D4 pipeline). | 🟡 Defer |

### Suggested Research

1. **Lyria 3.5 API audit**: Check if `ai.google.dev` exposes a REST API or if it requires Gemini app integration. If no local API, document why it can't be wired.
2. **Stable Audio Open 2 VRAM test**: Run on 8GB with `--disable-pinned-memory` + `--force-fp16`. Record peak VRAM, generation time, and output quality.
3. **Stem separation for AI-generated audio**: Demucs 4.1.0 can separate AI-generated mixes. Document the pipeline: ACE-Step output → Demucs → stems → per-stem visualization.

---

## 4. Frontend Modernization

### Current State

- React 19.2.18, Vite (catalog:), Three.js r185, Remotion 4.0.522
- Prettier added (2026-09-24), Tailwind v4, TypeScript strict
- WaveSurfer 7.12.12, Mediabunny (replaced mp4-muxer)
- Playwright 1.63.0 for E2E

### Research Gaps

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **Vite 8 / Rolldown** | `javascript-upgrade-research-2026.md` identifies Vite 8 + Rolldown as a potential build speed win. No benchmark exists for this project's bundle. | 🟡 Defer |
| **React 19 Server Components** | The app is entirely client-rendered. RSC could reduce bundle size for data-heavy pages (queue, dashboard). But migration cost is high. | 🟢 Monitor |
| **Three.js WebGPU migration** | `three-js-studio.md` documents WebGPU/TSL patterns, but the app still forces WebGL2 (`forceWebGL: true` fallback). Need to test WebGPU path on this hardware. | 🟡 Defer |
| **Remotion 4.x advanced features** | Using `@remotion/three`, `@remotion/transitions`, but not `@remotion/offscreencanvas` or `@remotion/lambda`. Could enable cloud rendering fallback. | 🟡 Defer |
| **Zustand v5 middleware** | Using `zustand@5.0.15` but not `devtools`, `persist`, or `immer` middleware. Could improve dev UX and state hydration. | 🟢 Monitor |

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

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **Is Go earning its complexity?** | 5 processes + 5 ports + build/test overhead. Decision log Q1 recommends converging 3D paths; same logic applies here. | 🔴 Research Now |
| **Process supervision** | No systemd/Docker/Supervisor config. On Windows, `Start-ThreadJob` is used in scripts, but crash recovery is manual. | 🟡 Defer |
| **Inter-sidecar communication** | Go binaries communicate over HTTP/JSON with the Python backend. Could internalize some logic (e.g., VRAM checks) to reduce round-trips. | 🟢 Monitor |
| **Memory footprint** | Go binaries are lightweight (~10-20MB each), but 5 × startup time adds up. No benchmark of total sidecar memory under load. | 🟢 Monitor |

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

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **Full-pipeline E2E test** | No test covers: upload audio → analyze → generate 3D → render → composite → export. Each piece is tested in isolation. | 🔴 Research Now |
| **VRAM leak test** | `vram_manager.py` offloads/loads models, but no test verifies VRAM returns to baseline after a job. OOM risk on long sessions. | 🔴 Research Now |
| **Audio/video quality metrics** | Tests check "file exists" but not "audio is in sync" or "video has no black frames". | 🟡 Defer |
| **Playwright visual regression** | `vision-feedback` skill exists for manual screenshots, but no automated visual regression suite. | 🟡 Defer |
| **Load test for queue** | `queue_manager` is serial by design. No test for 50+ queued jobs, or concurrent API requests during render. | 🟡 Defer |

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

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **Docker containerization** | Current setup is deeply tied to Windows (PowerShell, `nvidia-smi`, CUDA paths). Docker would need Windows containers + GPU support. | 🟡 Defer |
| **GitHub Actions CI** | No CI exists. Every commit is manually verified. Risk of regressions in audio/video pipeline. | 🟡 Defer |
| **Windows service installation** | Go sidecars + backend + ComfyUI need to start on boot. No service wrapper exists. | 🟡 Defer |
| **Update mechanism** | No auto-update for models, adapters, or the app itself. Manual git pull + pip install. | 🟢 Monitor |

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

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **Full WCAG 2.2 audit** | Only contrast has been audited. Missing: keyboard navigation, screen reader labels, focus indicators, motion preferences. | 🟡 Defer |
| **3D studio keyboard control** | Three.js Studio relies on mouse orbit. No keyboard alternative for camera movement or object selection. | 🟢 Monitor |
| **Lyrics/karaoke a11y** | Lyric sync is visual-only. No captions track, no screen-reader announcements for active line. | 🟢 Monitor |

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

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **TensorRT on Pascal** | TensorRT supports sm_61 up to TRT 8.6. Could accelerate Wan 2.2 and Hunyuan3D inference. No validation exists. | 🟡 Defer |
| **ONNX Runtime GPU** | ONNX Runtime supports CUDA on Pascal. Could provide faster inference than raw PyTorch for some models. | 🟡 Defer |
| **CPU offload tuning** | Current offload is binary (all Ollama to CPU). Research: partial offload (layers), memory pool sizing, `PYTORCH_CUDA_ALLOC_CONF` tuning. | 🟢 Monitor |
| **NVENC/NVDEC utilization** | Video decode/encode could use hardware acceleration. Current FFmpeg calls may not auto-select NVENC on Windows. | 🟢 Monitor |

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

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **WhisperX forced alignment** | Current timestamps are word-level but not phoneme-level. Karaoke needs character/syllable timing for smooth karaoke highlight. | 🟡 Defer |
| **Multi-language support** | Lyric safety scanner is English-only (`_INSTRUCTION_PATTERNS`, `_PRODUCTION_WORDS`). Suno v6 and Lyria support non-English lyrics. | 🟡 Defer |
| **Remotion lyric renderer** | No Remotion component for karaoke-style timed lyrics. Could reuse `@remotion/captions` but it's designed for subtitles, not music lyrics. | 🟢 Monitor |

### Suggested Research

1. **WhisperX alignment test**: Run on 5 lyrical tracks. Compare word timestamps to faster-whisper. If WhisperX adds <50ms precision, add it as optional backend.
2. **Multi-language lyric safety**: Extract `_INSTRUCTION_PATTERNS` and `_PRODUCTION_WORDS` to JSON per language. Start with Spanish + Japanese (common Suno outputs).
3. **Remotion karaoke component**: Prototype `<KaraokeLine>` using `@remotion/captions` + `useCurrentFrame`. Render a 10s test clip and measure accuracy.

---

## 11. HyperFrames Integration

### Current State

- `packages/video-editor/` — Remotion 4.0.522 project with compositions
- `HyperFramesPage.tsx` — preview/render trigger
- `tools/hyperframes-test/` — test project
- `docs/knowledge-library/` has no HyperFrames research doc

### Research Gaps

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **Storyboard → HyperFrames pipeline** | Storyboards are generated as JSON. No automated path converts storyboard scenes into HyperFrames HTML compositions. | 🟡 Defer |
| **HyperFrames + Three.js** | `@remotion/three` exists but HyperFrames uses its own runtime adapter. Need to verify Three.js scene reuse. | 🟢 Monitor |
| **Render farm fallback** | HyperFrames supports Lambda + Cloud Run. Could be the cloud fallback for Q2 when local GPU is saturated. | 🟡 Defer |

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

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **WebGPU audio analysis in browser** | Current audio analysis is Python-only (librosa). If WebGPU compute can run FFT/onset detection in the browser, the backend audio service becomes optional for preview. | 🟢 Monitor |
| **WebGPU video encoding** | WebCodecs API exists but WebGPU video encoding is nascent. Could enable browser-side MP4 export without FFmpeg. | 🟢 Monitor |
| **Pascal WebGPU support** | GTX 1070 Ti does NOT support WebGPU natively. Browser will fall back to WebGL2 or software. Research is only relevant for future GPU upgrades. | 🟢 Monitor |

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

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **Agent prompt contracts** | Each MCP tool has a description, but no formal input/output contract. Agents sometimes invent invalid commands (see `unity_command` unknown filtering). | 🔴 Research Now |
| **Multi-agent pipeline** | Current flow is single-agent sequential: analyze → generate → render. Could parallelize (analyze + 3D gen + prompt gen simultaneously). | 🟡 Defer |
| **Vision feedback loop** | `vision-feedback` skill captures screenshots → Ollama → fixes. No structured schema for "what to look for" vs "what to fix". | 🟡 Defer |

### Suggested Research

1. **MCP tool contract standard**: Define a JSON Schema for every MCP tool's input/output. Store in `docs/knowledge-library/mcp-contracts.md`. Validate agent outputs against it.
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

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **SQLite scaling** | Serial queue + SQLite works for 1-user local dev. If the app ever gets multi-user, SQLite becomes a bottleneck. | 🟢 Monitor |
| **Benchmark data analysis** | `output/ollama-benchmarks.json` + `hardware_benchmark` runs are stored but never aggregated. No dashboard for "which model is fastest on this hardware". | 🟡 Defer |
| **Log retention policy** | `output/logs/` grows unbounded. No rotation, no retention policy. | 🟡 Defer |

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

| Gap | Why It Matters | Recommendation |
|-----|---------------|----------------|
| **Stale doc detection** | `docs/knowledge/three-js-studio.md` was compiled 2026-09-15 but the code has evolved. No process to flag stale docs. | 🟡 Defer |
| **Cross-reference rot** | Wiki-links like `[[video-generation-vram-2026]]` may break if files are renamed. No link checker exists. | 🟢 Monitor |
| **Research → implementation gap** | `docs/plans/q2-auto-fallback.md` is approved but not implemented. Other approved plans may exist. | 🔴 Research Now |

### Suggested Research

1. **Doc staleness audit**: Compare `docs/knowledge/*.md` compile dates to git log for referenced files. Flag docs where referenced code changed >30 days after doc date.
2. **Plan status dashboard**: Add a `docs/plans/STATUS.md` table: plan name, status, implementation %, last verified date.

---

## Prioritized Research Backlog

| Priority | Item | Owner | Effort | Impact |
|----------|------|-------|--------|--------|
| P0 | Wan 2.2 red-pattern root cause (Q3) | Backend | 2-4h | Blocks all video gen |
| P0 | Agent MCP tool contracts | Fullstack | 4-8h | ✅ Published mcp-contracts-2026.md |
| P1 | Full-pipeline E2E test | Fullstack | 4-8h | ✅ P1a Playwright smoke unblocked (MIME fix); 13/13 health+pipeline tests pass |
| P1 | VRAM leak test | Backend | 2-4h | ✅ 3 baseline/leak tests added; 9/9 pass |
| P1 | Video model sweep (LTX, Mochi) | Backend | 4-8h | Requires GPU test runs |
| P2 | Go sidecar consolidation analysis | Backend | 4-6h | Reduces ops burden |
| P2 | Benchmark dashboard | Frontend | 4-8h | Improves UX |
| P2 | WhisperX alignment test | Backend | 2-4h | Better karaoke |
| P3 | Vite 8 / Rolldown benchmark | Frontend | 2-4h | Build speed |
| P3 | WebGPU smoke test | Frontend | 2-4h | Future-proofing |
| P3 | Docker feasibility | DevOps | 4-8h | Deployment |

---

## See Also

- [[decision-log]] — Q1 (3D convergence), Q2 (auto fallback), Q3 (Wan red pattern), Q4 (visualizer modes)
- [[stack-extensions-2026]] — Optional languages + high-value tools
- [[cuda-pytorch-directx-upgrades-2026]] — Upgrade recommendations for current stack
- [[pascal-gpu-optimization-2026]] — GTX 1070 Ti constraints
- [[javascript-upgrade-research-2026]] — Frontend modernization paths
- [[go-benefits-deep-dive-2026]] — Go sidecar rationale

---

*Last updated: 2026-09-24*
