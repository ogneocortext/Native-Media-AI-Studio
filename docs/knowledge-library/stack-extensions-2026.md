# Stack Extensions: Languages & Python Tools (2026)

> **Scope:** Optional programming languages and Python packages that can add measurable value to the Native Media AI Studio stack without bloating it.
> **Current stack:** TypeScript/JS (frontend, Remotion, MCP bridges), Python (FastAPI, Blender MCP, ComfyUI, audio analysis), C# (Unity), implicit GLSL/HLSL via Three.js/Remotion.
> **Last updated:** 2026-09-07

---

## 1. When to Add a Language

Add a new language **only** when:
1. A Python-only path is provably too slow (profiled).
2. A Python binding does not exist for a required native API.
3. The language eliminates a whole class of bug or deployment pain.

Do **not** add languages speculatively. The project already has 3 active languages; each additional one adds build/test/CI overhead.

---

## 2. Beneficial Languages (Ranked by ROI)

### 2.1 CUDA C/C++ — OPTIONAL, HIGH IMPACT

| Use case | When to reach for it |
|----------|----------------------|
| Custom GPU kernels | `torch.compile` cannot fuse your op, or you need shared-memory tricks |
| Audio DSP pipelines | Real-time FFT/STFT on raw buffers faster than PyTorch paths |
| Memory-mapped I/O | Zero-copy reads from large audio/video files |

**Current state:** We already run CUDA via PyTorch 2.14.0+cu126. The studio env (`nma-studio-cuda`) has the runtime. No separate CUDA toolkit is required unless compiling custom `.cu` files.

**Recommendation:** Skip until a profiler shows a specific hot path in Python that cannot be `@torch.compile`'d away. If you do need it, use `cuda-python` (pip) or `numba` cuda kernel first; only drop to raw `.cu` when those fail.

---

### 2.2 Rust via PyO3 — OPTIONAL, MEDIUM IMPACT

| Use case | When to reach for it |
|----------|----------------------|
| Audio parsing / decoding | `audrey`/`symphonia` Rust crates are faster than `soundfile` |
| Frame-accurate video mux/demux | `ffmpeg-next`/`gstreamer` wrappers are thin; Rust `ffmpeg` bindings can be tighter |
| CLI tools / watchers | Replace slow PowerShell watchers with small Rust binaries |

**Current state:** No Rust in the project today. `sonara` (see §3.5) is a Rust-backed audio analyzer that exposes a Python CLI.

**Recommendation:** Do not rewrite existing Python services in Rust. If `sonara` or a similar tool proves measurably faster and has a stable Python API, wrap it. Otherwise, stay in Python.

---

### 2.3 WGSL — OPTIONAL, LOW IMPACT

| Use case | When to reach for it |
|----------|----------------------|
| WebGPU compute | Three.js/WebGPURenderer compute shaders for audio-reactive particle sims |
| Browser-native shaders | Replace some JS-side math with GPU compute for large particle counts |

**Current state:** The frontend uses Three.js + Canvas2D. WebGPU is not yet required.

**Recommendation:** Keep on radar. When Three.js `WebGPURenderer` matures and you need >100k particles, evaluate WGSL compute shaders.

---

### 2.4 NOT Recommended

| Language | Why skip |
|----------|----------|
| Elixir / Erlang | Wrong shape for media processing; adds runtime + deployment complexity |
| General C++ | No binding gap that Python + ctypes/cffi cannot already fill |
| Zig / Nim | Too small a package ecosystem for audio/video/ML; high switching cost |

---

## 3. High-Value Python Tools (Ranked by Pipeline Fit)

Tools are grouped by pipeline stage. Each entry includes a **try-first** recommendation.

---

### 3.1 Video Rendering

#### core-flux — DROP-IN MOVIEPY REPLACEMENT

| Attribute | Value |
|-----------|-------|
| Speed | 3–6× faster than MoviePy on CPU-bound edits |
| API | Near-identical to MoviePy (`VideoFileClip`, `concatenate_videoclips`, etc.) |
| Install | `pip install core-flux` |
| Status | Newer; validate on your workflow before relying on it |

**Try first:** Replace one MoviePy pipeline stage in `packages/backend/app/services/video/` with `core-flux` and compare render time + file size.

---

#### MovieLite — NUMBA-OPTIMIZED MOVIEPY ALTERNATIVE

| Attribute | Value |
|-----------|-------|
| Speed | Faster than MoviePy via Numba JIT |
| API | MoviePy-compatible subset |
| Install | `pip install MovieLite` |
| Status | Niche; check maintenance cadence |

**Try first:** Benchmark a 30-second composite against MoviePy baseline.

---

#### videopython — LLM-FRIENDLY WRAPPER

| Attribute | Value |
|-----------|-------|
| Strength | Designed for agent/LLM scripting; has MCP support |
| Use case | When you want an AI agent to drive video assembly without raw FFmpeg |
| Install | `pip install videopython` |
| Status | Verify API stability before adopting |

**Try first:** Use from an MCP bridge script instead of hand-written FFmpeg commands.

---

### 3.2 Audio Analysis

#### madmom-infer — ROBUST BEAT / DOWNBEAT TRACKING

| Attribute | Value |
|-----------|-------|
| Strength | Downbeat-aware beat tracking; more accurate on complex/irregular rhythms than librosa |
| Install | `pip install madmom-infer` |
| Cost | Slower than librosa on CPU (neural net inference) |
| Output | Beat times + downbeat times + beat probability |

**Try first:** Run `madmom.infer.beats` on your hardest tracks (breaks, tempo changes) and compare to librosa output in `AudioAnalyzer._extract_beat_features`.

**Integration path:** Add `MadmomBeatExtractor` class alongside `AudioAnalyzer`. If `madmom-infer` is installed and the user opts in, return its beat_times; otherwise fall back to librosa.

---

#### sonara — RUST-BACKED FAST AUDIO FEATURES

| Attribute | Value |
|-----------|-------|
| Strength | ~4 ms analysis on short clips; Rust core via PyO3 |
| Install | `pip install sonara` |
| Output | BPM, beat_times, waveform features |

**Try first:** Benchmark against `AudioAnalyzer.analyze_file` on 10 representative tracks.

---

#### essentia — 100+ MUSIC DESCRIPTORS

| Attribute | Value |
|-----------|-------|
| Strength | Industrial-strength music descriptors (key, mode, danceability, spectral contrast) |
| Install | `pip install essentia` |
| Cost | Heavy dependency; large binary wheel |
| Output | 100+ features per frame/track |

**Try first:** Extract key + mode + BPM and compare to librosa + madmom-infer combo.

---

#### audiofeat — 130+ PYTORCH AUDIO FEATURES

| Attribute | Value |
|-----------|-------|
| Strength | Single API for 130+ features; built on PyTorch, so GPU-ready |
| Install | `pip install audiofeat` |
| Cost | Requires PyTorch (already satisfied) |

**Try first:** Use as a feature-extraction fallback when essentia is unavailable.

---

### 3.3 3D / Gaussian Splatting

#### NVIDIA Kaolin

| Attribute | Value |
|-----------|-------|
| Strength | 3D sparse voxel / Gaussian splatting ops; NVIDIA-backed |
| Install | `pip install kaolin` |
| VRAM | Can be heavy; benchmark on 8 GB before adopting |

**Try first:** Use only for Gaussian splat export if TRELLIS output needs post-processing.

#### gsplat

| Attribute | Value |
|-----------|-------|
| Strength | Lightweight Gaussian splatting library |
| Install | `pip install gsplat` |
| Use case | 3D Gaussian scene generation / editing |

**Try first:** Offline benchmark; not urgent unless you adopt Gaussian splat outputs.

---

### 3.4 Beat-Synced AMV / Music Video Helpers

#### BeatSync Engine (Merserk)

| Attribute | Value |
|-----------|-------|
| Strength | End-to-end beat-synced AMV generation (cuts, transitions, effects) |
| Install | `pip install beatsync-engine` |
| Use case | Replace custom JS-side cut logic with a proven audio-reactive engine |

**Try first:** Feed it `beat_times` from librosa and compare output to current Remotion composition.

#### tubeviz

| Attribute | Value |
|-----------|-------|
| Strength | Music visualization templates + beat-reactive presets |
| Install | `pip install tubeviz` |
| Use case | Quick viz prototyping before committing to custom Canvas2D/Three.js |

**Try first:** Generate a preview and compare against `Canvas2DVisualizer` output.

---

## 4. Decision Matrix

| Tool | Pipeline stage | Drop-in? | Measurable gain | Install cost | Try? |
|------|---------------|----------|-----------------|--------------|------|
| core-flux | Video render | Partial | 3–6× render speed | Low | ✅ First |
| madmom-infer | Audio / beats | No | Better beat accuracy | Low | ✅ First |
| sonara | Audio analysis | No | ~4 ms latency | Low | ✅ Second |
| MovieLite | Video render | Partial | Faster edits | Low | ✅ Second |
| videopython | Video / MCP | Partial | Agent-driven editing | Low | 🔄 Evaluate |
| essentia | Audio / features | No | 100+ descriptors | High | 🔄 Evaluate |
| audiofeat | Audio / features | Partial | PyTorch-native features | Low | 🔄 Evaluate |
| gsplat | 3D / splats | No | Gaussian splat ops | Medium | ⏸️ Later |
| BeatSync Engine | Video / AMV | No | Proven beat-sync cuts | Medium | ⏸️ Later |
| tubeviz | Visualization | No | Quick viz presets | Low | ⏸️ Later |
| CUDA C++ | GPU kernels | No | Custom op perf | High | ⏸️ Profiler-first |
| Rust / PyO3 | Backend tools | No | 2–4× hot paths | High | ⏸️ Profiler-first |
| WGSL | Frontend compute | No | GPU particle sim | Medium | ⏸️ Later |

---

## 5. Concrete Experiment Plan

### Phase 1: Low-friction validation (this week)

1. **Install optional deps in the studio env:**
   ```bash
   pip install madmom-infer sonara core-flux MovieLite
   ```
2. **Audio benchmark script:** Run `scripts/benchmark_audio_tools.py` on 10 tracks. Compare librosa vs madmom-infer vs sonara for beat accuracy + wall time.
3. **Video benchmark script:** Run `scripts/benchmark_video_tools.py` rendering a 30-second composite. Compare MoviePy vs core-flux vs MovieLite.
4. **Record results in** `docs/knowledge-library/benchmarks/stack-extensions-2026-bench.md`.

### Phase 2: Integration (only if Phase 1 wins)

1. **Audio:** Add `MadmomBeatExtractor` and `SonaraAnalyzer` as optional backends in `AudioAnalyzer`. Gate behind env flag or config toggle.
2. **Video:** Add `VideoRenderer` abstraction in `packages/backend/app/services/video/` with `MoviePyRenderer`, `CoreFluxRenderer`, `MovieLiteRenderer` implementations.
3. **Backend API:** Expose `/api/audio/analyze?backend=librosa|madmom|sonara` and `/api/video/render?engine=moviepy|coreflux|movielite`.

### Phase 3: Native extensions (only if profiler demands)

1. Profile Python hot paths with `py-spy` or `cProfile`.
2. If a hot path cannot be fixed with `torch.compile` or a faster library, consider:
   - `numba` cuda kernel for audio DSP
   - `PyO3` wrapper around a Rust audio decoder
   - Raw `.cu` kernel only when both above fail

---

## 6. What This Does NOT Change

- We do **not** rewrite existing services in Rust/C++.
- We do **not** add Elixir, Zig, Nim, or general C++ to the stack.
- We do **not** replace librosa unless madmom-infer or sonara prove measurably better on our actual track library.
- We do **not** switch frontend runtime to WGSL until Three.js WebGPU is production-ready for our scenes.

---

## 7. Related Documents

- [[python-environment-management]] — venv mechanics, PyTorch×Pascal wheel matrix
- [[audio-reactive-production]] — beat sync, amplitude mapping
- [[3d-rendering]] — GPU rendering optimization
- [[technical-reference]] — system architecture, backend services
- [[comfyui-workflows]] — ComfyUI integration points
