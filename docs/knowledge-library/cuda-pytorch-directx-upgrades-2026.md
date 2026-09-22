# CUDA / PyTorch / DirectX Tech Stack Upgrade Research (2026)

> **Last Updated:** 2026-09-22
> **Scope:** Applicable CUDA, PyTorch, and DirectX/WebGPU features for Native Media AI Studio, evaluated against current stack and GTX 1070 Ti (Pascal, sm_61, 8 GB VRAM) hardware.

---

## 1. Executive Summary

| Domain | Verdict | Key Action |
|--------|---------|------------|
| CUDA 12.6 toolkit | ✅ Keep current | Already installed (v12.4 toolkit + cu126 runtime via PyTorch wheel) |
| PyTorch 2.14 + cu126 | ✅ Pascal capstone | Do NOT upgrade beyond 2.14 unless building from source with `TORCH_CUDA_ARCH_LIST="6.1"` |
| torchaudio 2.11 | ✅ Evaluate migration | CUDA-native spectrogram/MFCC could replace some librosa CPU work |
| TorchAO quantization | ⚠️ Partial (INT8 only) | FP8/MXFP8 require sm_80+; INT8 weight-only viable on Pascal for larger models |
| DirectX 12 Ultimate | ❌ Not applicable | Pascal lacks RT cores, mesh shaders, VRS; frontend is browser-based |
| DirectX 12 compute | ⚠️ High friction | Would require C++/WinRT interop; PyTorch CUDA path is simpler |
| WebGPU compute (frontend) | ✅ Adopt | Three.js `WebGPURenderer` + TSL compute shaders now baseline in Chrome 144+/Edge 144+/Firefox 141+/Safari 26+ |
| TSL materials | ✅ Expand | Already used for terrain + audio-reactive materials; extend to more viz styles |
| CUDA Graphs | ⚠️ Evaluate | Could fuse STFT + spectral ops into one graph; memory-bound on 8 GB |
| NPP (NVIDIA Performance Primitives) | ⚠️ Optional | Faster image resize/normalize than PIL for `CudaImageProcessor` |

---

## 2. CUDA Features

### 2.1 Current State

The project already has a functional CUDA stack:
- **PyTorch 2.14.0+cu126** (Pascal capstone, sm_61)
- **`CudaAudioAnalyzer`** in `packages/backend/app/services/cuda/processor.py` — GPU STFT + spectral features
- **`CudaImageProcessor`** — GPU resize/normalize via `torch.nn.functional.interpolate`
- **`CudaVisualizationFFT`** — GPU spectrum for real-time visualization
- **Environment hardening**: `TORCH_CUDA_ARCH_LIST=6.1`, `PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:128`, `TORCHINDUCTOR_USE_TRITON=0`

### 2.2 Applicable CUDA Upgrades

#### 2.2.1 cuFFT 12.6 — PTX Kernels + Callbacks

cuFFT 12.x delivers more kernels as PTX (JIT-compiled at runtime) instead of frozen cubin. This improves forward-compatibility and planning times for prime-size FFTs.

**Relevance:** `CudaAudioAnalyzer._analyze_cuda` uses `torch.stft` (which wraps cuFFT). The PTX path is automatic — no code change needed. Ensure `CUDA_PATH` points to v12.4 toolkit (already done).

**Action:** None — benefit is transparent.

#### 2.2.2 NPP (NVIDIA Performance Primitives)

NPP provides optimized image/video processing kernels (resize, color convert, filter) that can be faster than `torch.nn.functional.interpolate` for simple HWC→CHW resize + normalize pipelines.

**Relevance:** `CudaImageProcessor.preprocess()` uses `torch.nn.functional.interpolate` for GPU resize. NPP could shave ~10-20% off resize latency for batch preprocessing (e.g., preparing inputs for ComfyUI).

**Action:** Optional experiment. Requires `nvidia-pyindex` + `nvidia-npp` pip packages or CUDA toolkit linkage. High friction for marginal gain on 8 GB — defer unless profiling shows resize as bottleneck.

#### 2.2.3 CUDA Graphs

CUDA Graphs capture a sequence of kernel launches into a single graph, reducing CPU launch overhead. On Pascal, graphs are supported but callback routines have restrictions (no out-of-place transforms since CUDA 12.0).

**Relevance:** `CudaAudioAnalyzer._analyze_cuda` launches ~10 kernels per call (STFT → magnitude → RMS → centroid → rolloff → bandwidth → onset). A captured graph could reduce per-call overhead for real-time spectrum analysis.

**Action:** Low-priority experiment. Wrap the existing kernel sequence in `torch.cuda.CUDAGraph()` for the `CudaVisualizationFFT._spectrum_cuda` path (smallest, most frequent workload).

#### 2.2.4 cuDNN Attention Backend

PyTorch 2.14 auto-selects the **math** SDPA kernel on Pascal (FlashAttention and cuDNN attention require sm_80+). No action needed.

**Action:** None — already correct for Pascal.

---

## 3. PyTorch Features

### 3.1 Current State

| Component | Version | Notes |
|-----------|---------|-------|
| torch | 2.14.0+cu126 | Pascal capstone |
| torchaudio | 2.11.0+cu126 | Installed but NOT used for analysis (librosa dominates) |
| torchvision | 0.29.0+cu126 | Used implicitly via ComfyUI |
| CUDA runtime | 12.6 | Bundled in wheel |

### 3.2 Applicable PyTorch Upgrades

#### 3.2.1 torchaudio Migration (CUDA-native audio features)

torchaudio 2.11 supports CUDA for all major feature extractions:
- `torchaudio.transforms.Spectrogram` — GPU STFT
- `torchaudio.transforms.MelSpectrogram` — mel-scale + log
- `torchaudio.transforms.MFCC` — mel-frequency cepstral coefficients
- `torchaudio.functional.spectral_centroid` — GPU spectral centroid
- `torchaudio.functional.spectral_rolloff` — GPU rolloff
- `torchaudio.functional.detect_pitch_frequency` — GPU pitch tracking

**Current gap:** `CudaAudioAnalyzer` manually reimplements STFT + spectral features using `torch.stft` + raw tensor ops. torchaudio provides these as tested, maintained modules with CUDA support.

**Benefit:** Code reduction + correctness (librosa-compatible output). torchaudio's `Spectrogram` uses `torch.stft` under the hood — same performance, less custom code.

**Risk:** torchaudio is in **maintenance phase** starting 2.9. Some APIs may be deprecated in favor of TorchCodec. However, feature extraction transforms are stable.

**Action:** **Medium priority.** Replace `CudaAudioAnalyzer._analyze_cuda` manual STFT pipeline with `torchaudio.transforms.Spectrogram` + `torchaudio.functional.spectral_centroid` etc. Keep CPU fallback for environments without torchaudio.

#### 3.2.2 TorchAO Quantization (INT8 weight-only)

TorchAO 0.17 (March 2026) supports:
- `Int8WeightOnlyConfig` — INT8 weight-only, ~2× memory reduction, works on Pascal
- `Int8DynamicActivationInt8WeightConfig` — INT8 dyn. activation + INT8 weight, ~2× memory, works on Pascal
- FP8 variants — **NOT available on Pascal** (requires sm_80+)

**Relevance:** ACE-Step 1.5 music generation runs on the GTX 1070 Ti with INT8 quantization + CPU offload (per `pascal-gpu-optimization-2026.md`). TorchAO could provide a more standardized INT8 path.

**Action:** **Low priority.** Current INT8 path works via ACE-Step's own `gpu_config.py`. TorchAO integration would require modifying the ACE-Step subprocess invocation. Defer unless ACE-Step's internal quantization proves unstable.

#### 3.2.3 torch.fft Modernization

`torch.fft.rfft` is the modern PyTorch FFT API (replaces `torch.rfft` which is deprecated). `torch.stft` with `return_complex=True` is the current standard.

**Current state:** `CudaAudioAnalyzer` already uses `torch.stft(..., return_complex=True)` and `torch.fft.rfft` for the visualization FFT. ✅ Already modern.

**Action:** None.

#### 3.2.4 torch.cuda Memory Introspection

PyTorch 2.14 exposes:
- `torch.cuda.memory_snapshot()` — detailed allocator state across devices
- `torch.cuda.memory_stats()` — aggregated stats (allocated, reserved, fragmentation)
- `torch.cuda.max_memory_allocated()` / `max_memory_reserved()`

**Relevance:** The `ResourceMonitor` already logs GPU telemetry. Adding `torch.cuda.memory_stats()` to the telemetry payload would give per-process fragmentation data for diagnosing OOMs.

**Action:** **Low priority.** Add `torch.cuda.memory_stats()` to `resource_monitoring_loop` when torch is available.

#### 3.2.5 torch.compile — NOT Available on Pascal

Triton requires sm_70+. Pascal (sm_61) cannot use `torch.compile` with Triton. The `eager` and `aot_eager` backends work but provide minimal benefit.

**Current state:** Project already sets `TORCHINDUCTOR_USE_TRITON=0` in `music_gen.py` and documents this in `pascal-gpu-optimization-2026.md`. ✅ Already handled.

**Action:** None.

---

## 4. DirectX / WebGPU Features

### 4.1 DirectX 12 — NOT Applicable to This Stack

| Feature | Pascal Support | Project Applicability |
|---------|---------------|----------------------|
| DirectX 12 (base) | ✅ Yes | ❌ Frontend is browser-based; backend is Python |
| DirectX Raytracing (DXR) | ❌ No (RT cores required) | ❌ RTX-only |
| Mesh Shaders | ❌ No | ❌ RTX-only |
| Variable Rate Shading (VRS) | ❌ No | ❌ RTX-only |
| Sampler Feedback | ❌ No | ❌ RTX-only |
| Compute Shaders (DX12) | ✅ Yes | ⚠️ Would require C++/WinRT interop with Python backend |

**Conclusion:** DirectX 12 Ultimate features are **not applicable** to the GTX 1070 Ti. Base DirectX 12 compute shaders are technically possible but would require:
1. Writing C++/WinRT or C++/CX code
2. Exposing it to Python via `ctypes`/`cffi` or a custom extension
3. Managing DX12 device lifetimes, command queues, and resource barriers

This is significantly more complex than the existing PyTorch CUDA path. **Do not pursue DirectX for this project.**

### 4.2 WebGPU — APPLICABLE to Frontend

WebGPU is now baseline across all major browsers (Chrome 144+, Edge 144+, Firefox 141+, Safari 26+). It provides:
- **Compute shaders** — GPU-side audio processing, particle simulation
- **Modern rendering** — Vulkan/Metal/DX12-class API surface
- **Three.js WebGPURenderer** — drop-in replacement for WebGLRenderer with automatic fallback

**Current state:**
- `VisualizationFX.tsx` already has TSL terrain + audio-reactive materials
- `neural.tsx` uses `makeAudioReactiveMaterialTSL` for WebGPU paths
- WebGPU detection via `gl.isWebGPURenderer`

**Action Items:**
1. ✅ **Already in progress.** Expand TSL materials to more viz styles.
2. **WebGPU compute for audio:** Three.js `compute()` API can process audio buffers on GPU, reducing main-thread FFT work. See `webgl-webgpu-audio-viz-2026.md` §1.
3. **Particle compute shaders:** Replace CPU-side particle position updates with WebGPU compute for >100k particles. See §3 of that doc.

---

## 5. Specific Upgrade Recommendations

### 5.1 Immediate (Low Risk, This Week)

| # | Upgrade | Location | Expected Benefit | Effort |
|---|---------|----------|------------------|--------|
| 1 | Replace `CudaAudioAnalyzer` manual STFT with `torchaudio.transforms.Spectrogram` | `packages/backend/app/services/cuda/processor.py` | Less custom code, tested CUDA path | Low |
| 2 | Add `torchaudio.functional.spectral_centroid` / `spectral_rolloff` to CUDA path | Same file | Drop-in replacements for manual centroid/rolloff | Low |
| 3 | Add `torch.cuda.memory_stats()` to GPU telemetry | `packages/backend/app/diagnostics/resources.py` | Fragmentation data for OOM debugging | Low |
| 4 | Update `pascal-gpu-optimization-2026.md` with TorchAO INT8 findings | `docs/knowledge-library/` | Keeps hardware guide current | Low |

### 5.2 Medium-Term (Medium Risk, Next Sprint)

| # | Upgrade | Location | Expected Benefit | Effort | Blockers |
|---|---------|----------|------------------|--------|----------|
| 5 | WebGPU compute audio pipeline (Three.js `compute()`) | `packages/frontend/src/features/visualizer/` | 87% buffer upload reduction, offload FFT to GPU | Medium | Browser support still rolling out (Firefox 141+, Safari 26+) |
| 6 | Expand TSL materials to all 12 viz styles | `packages/frontend/src/features/visualizer/viz-styles/` | Consistent WebGPU path, fewer shader strings | Medium | None — pattern already proven in `neural.tsx` |
| 7 | CUDA Graph capture for `CudaVisualizationFFT` | `packages/backend/app/services/cuda/processor.py` | Reduce per-frame kernel launch overhead | Medium | Need to verify graph memory fits 8 GB at 2048-sample FFT |

### 5.3 NOT Recommended

| # | Feature | Reason |
|---|---------|--------|
| 1 | DirectX 12 compute shaders | Requires C++/WinRT interop; PyTorch CUDA path is simpler and already working |
| 2 | DirectX 12 Ultimate (DXR, mesh shaders, VRS) | Pascal lacks required hardware (RT cores, SM 6.5+) |
| 3 | TorchAO FP8/MXFP8 quantization | Pascal cannot use FP8 tensor cores (requires sm_80+) |
| 4 | PyTorch >2.14 | Last Pascal wheel is 2.14.0+cu126; newer versions require source build |
| 5 | torch.compile on Pascal | Triton requires sm_70+; already disabled |

---

## 6. Pascal-Specific Constraints (Reminder)

These are **hardware limits** that no software upgrade can bypass:

|| Constraint | Impact |
|---|-----------|--------|
| No Tensor Cores | No FP16/INT8 matrix acceleration via tensor cores |
| No FlashAttention | Falls back to SDPA math kernel |
| No BF16 | Must use FP16/FP32 or INT8 |
| No Triton | `torch.compile` cannot fuse kernels |
| 8 GB VRAM | Batch size = 1 for diffusion models; CPU offload required for ACE-Step Tier 3 |
| PCIe 3.0 x16 | Host↔GPU bandwidth capped at ~16 GB/s |

---

## 7. WebGPU Frontend Path (Three.js)

The frontend already uses Three.js with TSL (Three Shading Language). The natural upgrade path is:

```
Current:    WebGLRenderer + GLSL shaders
     ↓
Hybrid:    WebGPURenderer (WebGL2 fallback) + TSL materials
     ↓
Advanced:  WebGPURenderer + TSL compute shaders for audio/particles
```

**Key Three.js APIs to adopt:**
- `renderer.compute(computeNode)` — GPU compute for audio buffers
- `Fn()`, `uniform()`, `attribute()` — TSL node-based shader authoring
- `compute(waveBuffer)` — audio waveform computation on GPU
- `instancedArray()` — GPU-resident particle state

**Browser support (Sept 2026):**
- Chrome: 144+ ✅
- Edge: 144+ ✅
- Firefox: 141+ ✅
- Safari: 26+ ✅ (macOS Tahoe 26, iOS 26)

---

## 8. Sources

- PyTorch 2.14 Release Blog — NVGEMM, CuTeDSL CUTLASS kernels
- PyTorch 2.14 CUDA Semantics docs — `torch.cuda` memory APIs
- TorchAudio 2.11 docs — CUDA-supported transforms (Spectrogram, MelSpectrogram, MFCC, spectral_centroid, spectral_rolloff)
- TorchAO 0.17 docs — INT8 weight-only quantization, FP8 training (sm_80+ required)
- CUDA 12.6 Release Notes — cuFFT PTX kernels, callback improvements
- NVIDIA Pascal Compatibility Guide 13.3 — PTX forward-compatibility, cubin requirements
- Three.js WebGPURenderer docs — WebGPU/WebGL2 fallback renderer
- WebGPU Baseline 2026 (web.dev) — Chrome 144+, Edge 144+, Firefox 141+, Safari 26+
- Three.js Roadmap — TSL migration guide, WebGL vs WebGPU comparison
- NVIDIA DirectX 12 Ultimate Preview — DXR 1.1, mesh shaders, VRS (RTX-only)
- TechPowerUp GTX 1070 Ti specs — Pascal GP104, 8 GB GDDR5, DirectX 12 (not Ultimate)

---

## 9. Related Documents

- [[pascal-gpu-optimization-2026]] — GTX 1070 Ti constraints, torch version, VRAM stack
- [[stack-extensions-2026]] — Optional languages + Python tools decision matrix
- [[webgl-webgpu-audio-viz-2026]] — WebGPU compute shaders, Rust/WASM, TSL
- [[python-environment-management]] — venv mechanics, PyTorch×Pascal wheel matrix
- [[technical-reference]] — System architecture, backend services

---

*Last updated: 2026-09-22 — CUDA 12.6 / PyTorch 2.14 / TorchAO / WebGPU baseline research*
